"""Ticketing business rules: organizer tier CRUD, plus the reservation
primitives (`reserve` / `release` / `confirm_sold`) that the future
`booking` module will call.

THE RESERVATION CONTRACT (see CLAUDE.md for the canonical version):

- Each primitive is ONE transaction that takes a per-tier row lock, checks
  the invariant + sale window + max-per-order against the freshly locked
  row (never a cache), writes the counters back, and commits. The DB CHECK
  constraint backstops the invariant even against a buggy caller.
- They open a `UnitOfWork` internally, so a caller (booking) that wraps them
  in its own `UnitOfWork` gets them as savepoints — reserve rolls back with
  the caller's order if that fails. The caller MUST keep its transaction
  short (no payment call while the lock is held).
- `release`/`confirm_sold` clamp to the currently-reserved amount, so a
  retry is a safe no-op; exactly-once accounting is the caller's job.
- `reserve` also decides the PRICE under that same lock (early bird or
  normal) and returns it as `ReservationOutcome.unit_price_minor`. That is
  the number to bill — see `pricing.py`.

Availability display (cache + the event's denormalized from_price/
tickets_available) is refreshed AFTER commit, outside the lock — display is
allowed to lag by a cache TTL; the reserve decision never is.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from django.db import IntegrityError, transaction

from apps.events.exceptions import EventNotFoundError
from apps.events.repositories import EventRepository
from core.audit import record_audit
from core.events import TICKET_TYPE_ADDED, TICKET_TYPE_SOLD_OUT, TICKET_TYPE_UPDATED
from core.unit_of_work import UnitOfWork

from .exceptions import (
    EarlyBirdPriceAbovePriceError,
    InvalidReservationQuantityError,
    NotTicketTypeOwnerError,
    QuantityBelowCommittedError,
    StaleTicketTypeVersionError,
    TicketTypeNotFoundError,
)
from .models import EARLY_BIRD_PRICE_CONSTRAINT, TicketType
from .repositories import TicketTypeRepository
from .strategies import ReservationOutcome, ReservationStrategy

logger = logging.getLogger(__name__)

_EDITABLE_TIER_FIELDS = (
    "name",
    "price_minor",
    "quantity",
    "sale_start",
    "sale_end",
    "max_per_order",
    "early_bird_price_minor",
    "early_bird_ends_at",
    "early_bird_quantity",
)


class TicketingService:
    def __init__(
        self,
        *,
        ticket_types: TicketTypeRepository,
        events: EventRepository,
        reservation: ReservationStrategy,
    ) -> None:
        self._ticket_types = ticket_types
        self._events = events
        self._reservation = reservation

    # --- display-refresh helpers (run AFTER commit, outside the lock) -------

    def _sync_event_denormals(self, event_id: uuid.UUID | str) -> None:
        """Recompute the event's from_price / tickets_available from the
        authoritative tier rows and invalidate the event's public caches so
        the fast events read path reflects the change."""
        from apps.events.selectors import invalidate_event_caches

        agg = self._ticket_types.aggregate_event_availability(event_id)
        self._events.set_ticketing_fields(
            event_id=event_id,
            from_price_minor=agg["from_price_minor"],
            tickets_available=agg["tickets_available"],
        )
        invalidate_event_caches(event_id)

    def _invalidate_tiers_display(self, event_id: uuid.UUID | str) -> None:
        from .selectors import invalidate_event_tiers_cache

        invalidate_event_tiers_cache(event_id)

    def _after_availability_change(self, event_id: uuid.UUID | str) -> None:
        self._sync_event_denormals(event_id)
        self._invalidate_tiers_display(event_id)

    # --- organizer commands ------------------------------------------------

    def create_ticket_type(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        name: str,
        price_minor: int,
        quantity: int,
        sale_start: datetime | None = None,
        sale_end: datetime | None = None,
        max_per_order: int = 10,
        early_bird_price_minor: int | None = None,
        early_bird_ends_at: datetime | None = None,
        early_bird_quantity: int | None = None,
    ) -> TicketType:
        event = self._events.get_active_for_write(event_id)
        if event is None:
            raise EventNotFoundError(str(event_id))
        if str(event.organization.owner_id) != str(actor_id):
            raise NotTicketTypeOwnerError()
        # The rule lives here, not only in the serializer: the DB CHECK is the
        # backstop, but a service caller deserves the domain error, not an
        # IntegrityError.
        if early_bird_price_minor is not None and early_bird_price_minor > price_minor:
            raise EarlyBirdPriceAbovePriceError()

        with UnitOfWork() as uow:
            tt = self._ticket_types.create(
                event_id=event_id,
                name=name,
                price_minor=price_minor,
                quantity=quantity,
                sale_start=sale_start,
                sale_end=sale_end,
                max_per_order=max_per_order,
                early_bird_price_minor=early_bird_price_minor,
                early_bird_ends_at=early_bird_ends_at,
                early_bird_quantity=early_bird_quantity,
            )
            uow.publish(
                TICKET_TYPE_ADDED,
                {"ticket_type_id": str(tt.id), "event_id": str(event_id), "name": tt.name},
                aggregate_id=str(tt.id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="ticket_type.created",
                target_type="ticket_type",
                target_id=str(tt.id),
            )
            transaction.on_commit(lambda: self._after_availability_change(event_id))

        logger.info("ticket_type_created", extra={"ticket_type_id": str(tt.id)})
        return tt

    def update_ticket_type(
        self,
        *,
        ticket_type_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        expected_version: int,
        changes: dict,
    ) -> TicketType:
        tt = self._ticket_types.get_with_event_owner(ticket_type_id)
        if tt is None:
            raise TicketTypeNotFoundError(str(ticket_type_id))
        if str(tt.event.organization.owner_id) != str(actor_id):
            raise NotTicketTypeOwnerError()

        applied = {k: v for k, v in changes.items() if k in _EDITABLE_TIER_FIELDS}
        # Fast pre-check against the currently-known committed count; the CHECK
        # constraint is the race-proof backstop for a reserve that sneaks in
        # between this read and the update below.
        if "quantity" in applied and applied["quantity"] < (tt.sold + tt.reserved):
            raise QuantityBelowCommittedError()
        # Both prices are editable and either may be absent from this PATCH, so
        # the rule is checked against the MERGED row — cutting the face price
        # below an existing early-bird price is the same error as raising the
        # early-bird price above it.
        merged_price = applied.get("price_minor", tt.price_minor)
        merged_early_bird = applied.get("early_bird_price_minor", tt.early_bird_price_minor)
        if merged_early_bird is not None and merged_early_bird > merged_price:
            raise EarlyBirdPriceAbovePriceError()

        with UnitOfWork() as uow:
            try:
                ok = self._ticket_types.update_if_version_matches(
                    ticket_type_id=ticket_type_id,
                    expected_version=expected_version,
                    changes=applied,
                )
            except IntegrityError as exc:
                # A CHECK fired between the pre-checks above and this UPDATE.
                # Which one matters: they tell the organizer to do different
                # things, so the constraint name (the only thing that
                # distinguishes them at this point) picks the message.
                if EARLY_BIRD_PRICE_CONSTRAINT in str(exc):
                    # A concurrent edit moved the other price under us.
                    raise EarlyBirdPriceAbovePriceError() from exc
                # no_oversell CHECK fired: a concurrent reserve pushed committed
                # tickets above the new quantity between the pre-check and here.
                raise QuantityBelowCommittedError() from exc
            if not ok:
                raise StaleTicketTypeVersionError()

            uow.publish(
                TICKET_TYPE_UPDATED,
                {"ticket_type_id": str(ticket_type_id), "event_id": str(tt.event_id)},
                aggregate_id=str(ticket_type_id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="ticket_type.updated",
                target_type="ticket_type",
                target_id=str(ticket_type_id),
            )
            transaction.on_commit(lambda: self._after_availability_change(tt.event_id))

        refreshed = self._ticket_types.get_active_by_id(ticket_type_id)
        if refreshed is None:  # pragma: no cover — just deleted mid-request
            raise TicketTypeNotFoundError(str(ticket_type_id))
        return refreshed

    # --- reservation primitives (booking will call these) ------------------

    def reserve(self, *, ticket_type_id: uuid.UUID | str, quantity: int) -> ReservationOutcome:
        """Hold `quantity` tickets: quantity moves into `reserved`. Raises
        SaleNotStarted/SaleClosed/ExceedsMaxPerOrder/SoldOut/TicketTypeNotFound.
        Atomic; decided under the tier's row lock.

        The outcome carries `unit_price_minor` — the price this locked decision
        actually settled on, early bird or normal. Callers that bill for the
        hold MUST use it rather than a price they read off the tier separately:
        that read wasn't serialised with anyone else's, so under contention it
        can quote a discount this reserve did not get.
        """
        if quantity < 1:
            raise InvalidReservationQuantityError()

        with UnitOfWork() as uow:
            outcome = self._reservation.reserve(ticket_type_id=ticket_type_id, quantity=quantity)
            if outcome.became_sold_out:
                uow.publish(
                    TICKET_TYPE_SOLD_OUT,
                    {
                        "ticket_type_id": str(outcome.ticket_type_id),
                        "event_id": str(outcome.event_id),
                    },
                    aggregate_id=str(outcome.ticket_type_id),
                )
            transaction.on_commit(lambda: self._after_availability_change(outcome.event_id))

        return outcome

    def release(self, *, ticket_type_id: uuid.UUID | str, quantity: int) -> ReservationOutcome:
        """Free a hold: up to `quantity` moves out of `reserved` back to
        available. Safe to retry (clamped to what's reserved)."""
        if quantity < 1:
            raise InvalidReservationQuantityError()

        with UnitOfWork():
            outcome = self._reservation.release(ticket_type_id=ticket_type_id, quantity=quantity)
            transaction.on_commit(lambda: self._after_availability_change(outcome.event_id))

        return outcome

    def confirm_sold(self, *, ticket_type_id: uuid.UUID | str, quantity: int) -> ReservationOutcome:
        """Convert a hold to a sale: up to `quantity` moves from `reserved` to
        `sold`. Availability is unchanged, so only the display cache (which
        shows the sold count) is refreshed. Safe to retry."""
        if quantity < 1:
            raise InvalidReservationQuantityError()

        with UnitOfWork():
            outcome = self._reservation.confirm_sold(
                ticket_type_id=ticket_type_id, quantity=quantity
            )
            # Availability didn't change → no event-denormal recompute needed,
            # just refresh the tier display (its sold count moved).
            transaction.on_commit(lambda: self._invalidate_tiers_display(outcome.event_id))

        return outcome
