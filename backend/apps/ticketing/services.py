"""Ticketing business rules: organizer tier CRUD (including the named
sale-phase schedule), plus the reservation primitives (`reserve` /
`release` / `confirm_sold`) that the `booking` module calls.

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
- `reserve` also decides the PRICE under that same lock (the active sale
  phase, or face price) and returns it as `ReservationOutcome.
  unit_price_minor` + `phase_name`. That is the number to bill — see
  `pricing.py`.

Schedule edits and reserves share the same serialisation point: EVERY tier
edit — including a phases-only one — goes through the version-bump UPDATE on
the tier row, and the phase delete+recreate runs in that same transaction.
The UPDATE waits on any in-flight reserve's row lock, and any later reserve
waits on the edit's — so a locked reserve can never price against a
half-replaced schedule.

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
    InvalidGroupBandsError,
    InvalidPhaseScheduleError,
    InvalidReservationQuantityError,
    NotTicketTypeOwnerError,
    PhasePriceAbovePriceError,
    QuantityBelowCommittedError,
    SlotNotFoundError,
    StaleTicketTypeVersionError,
    TicketTypeNotFoundError,
)
from .models import TicketType
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
    # Content, not inventory. None of these three can affect what is sold —
    # they are what the panel READS — so they ride the same optimistic-locked
    # UPDATE as everything else here with no extra rule.
    "description",
    "perks",
    "position",
    # GROUP BANDS. Unlike the three above, this one DOES affect what is sold —
    # it is a price. It rides the same optimistic-locked UPDATE, and the
    # validation below is what stands between an organiser's form and an
    # amount somebody is charged.
    #
    # A field absent from this tuple is silently dropped by the `applied`
    # comprehension in `update_ticket_type`: the organiser saves, sees no
    # error, and nothing is written. That is the exact failure CLAUDE.md
    # records under "four organizer controls wrote NOTHING".
    "group_bands",
)

MAX_PHASES = 5

#: The same handful `MAX_PHASES` allows, for the same reason: group pricing is
#: a few named steps ("pairs", "groups of four"), not a curve.
MAX_GROUP_BANDS = 5


def _validate_group_bands(
    bands: list[dict], *, face_price_minor: int, max_per_order: int | None
) -> None:
    """The band list's structural rules, enforced in the SERVICE.

    A JSON column cannot carry a CHECK constraint comparing a band's price to
    the tier's own `price_minor`, so — exactly as with the phase schedule —
    this is the only writer-side guard, and `pricing._eligible_bands` repeats
    the never-overcharge floor at the charge path because a guard one writer
    honours is not defense in depth.

    - max 5 bands, per `MAX_GROUP_BANDS`;
    - `min_quantity` at least 2 — a band at 1 is the face price wearing a
      label, and would apply to every single-ticket order;
    - each price at or below the face price — a "discount" dearer than the
      normal price would OVERCHARGE every group that hit it;
    - `min_quantity` strictly increasing, so the "largest band the order
      reaches" rule has exactly one answer per order size;
    - prices NON-INCREASING as the group grows — a bigger group paying more
      per head is not a group discount, and would make buying six cost more
      than buying four;
    - every `min_quantity` within `max_per_order` — a band nobody can reach
      because the tier refuses that many tickets is a control that can never
      fire, and both numbers live on the same row so this is checkable.
    """
    if len(bands) > MAX_GROUP_BANDS:
        raise InvalidGroupBandsError(
            f"A ticket type can have at most {MAX_GROUP_BANDS} group prices."
        )
    previous_min: int | None = None
    previous_price: int | None = None
    for band in bands:
        minimum = band["min_quantity"]
        price = band["price_minor"]
        if minimum < 2:
            raise InvalidGroupBandsError(
                "A group price starts at 2 tickets or more — one ticket is the normal price."
            )
        if price > face_price_minor:
            raise InvalidGroupBandsError(
                "A group price cannot be higher than the ticket's normal price."
            )
        if previous_min is not None and minimum <= previous_min:
            raise InvalidGroupBandsError(
                "Each group price has to start at a larger group than the one before it."
            )
        if previous_price is not None and price > previous_price:
            raise InvalidGroupBandsError(
                "A larger group cannot pay more per ticket than a smaller one."
            )
        if max_per_order is not None and minimum > max_per_order:
            raise InvalidGroupBandsError(
                f"This ticket allows at most {max_per_order} per order, so a group price "
                f"starting at {minimum} could never apply."
            )
        previous_min = minimum
        previous_price = price


def _validate_phase_schedule(phases: list[dict], *, face_price_minor: int) -> None:
    """The schedule's structural rules, enforced HERE (not only in the
    serializer) because a service caller deserves the domain error. Each
    phase dict carries `name` / `price_minor` / `ends_at` / `quantity`; array
    order is position.

    - max 5 phases — a schedule is a handful of named steps, not a curve;
    - names non-blank — an unnamed phase can't be shown or recorded;
    - each price at or below the face price — a "phase" dearer than the
      normal price would silently OVERCHARGE every buyer who hits it;
    - prices NON-DECREASING across positions — earlier is cheaper; a later
      cheaper phase would mean the straddle rule (see pricing.py) bills a
      straddling order MORE than the phase it fell out of promised;
    - at least one bound per phase — a phase with no deadline and no
      threshold never ends, so everything after it is unreachable decoration.
    """
    if len(phases) > MAX_PHASES:
        raise InvalidPhaseScheduleError(f"A ticket type can have at most {MAX_PHASES} sale phases.")
    previous_price: int | None = None
    for phase in phases:
        if not str(phase.get("name") or "").strip():
            raise InvalidPhaseScheduleError("Every sale phase needs a name.")
        price = phase["price_minor"]
        if price > face_price_minor:
            raise PhasePriceAbovePriceError()
        if previous_price is not None and price < previous_price:
            raise InvalidPhaseScheduleError(
                "Sale phase prices can't decrease from one phase to the next."
            )
        previous_price = price
        if phase.get("ends_at") is None and phase.get("quantity") is None:
            raise InvalidPhaseScheduleError(
                "Every sale phase needs an end time or a seat threshold (or both)."
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
        phases: list[dict] | None = None,
        slot_id: uuid.UUID | str | None = None,
        description: str = "",
        perks: list[str] | None = None,
        position: int = 0,
        group_bands: list[dict] | None = None,
    ) -> TicketType:
        event = self._events.get_active_for_write(event_id)
        if event is None:
            raise EventNotFoundError(str(event_id))
        if str(event.organization.owner_id) != str(actor_id):
            raise NotTicketTypeOwnerError()
        if phases:
            _validate_phase_schedule(phases, face_price_minor=price_minor)
        if group_bands:
            _validate_group_bands(
                group_bands, face_price_minor=price_minor, max_per_order=max_per_order
            )
        if slot_id is not None:
            # Scoped by EVENT, not just by id. Without this an organiser could
            # attach their tier to somebody else's session — and every counter
            # on this row would then be sold against a show they do not run.
            from apps.events.repositories import EventSlotRepository

            if EventSlotRepository().get_for_event(event.id, slot_id) is None:
                raise SlotNotFoundError(str(slot_id))

        with UnitOfWork() as uow:
            tt = self._ticket_types.create(
                event_id=event_id,
                name=name,
                price_minor=price_minor,
                quantity=quantity,
                sale_start=sale_start,
                sale_end=sale_end,
                max_per_order=max_per_order,
                slot_id=slot_id,
                description=description.strip(),
                perks=perks or [],
                position=position,
                group_bands=group_bands or [],
            )
            if phases:
                self._ticket_types.set_phases(ticket_type_id=tt.id, phases=phases)
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

        # `phases` is not a tier column — it is the schedule replacement,
        # applied in the SAME transaction as the version-bump UPDATE below.
        # `None` means "not in this PATCH"; an empty list clears the schedule.
        phases: list[dict] | None = changes.get("phases")
        applied = {k: v for k, v in changes.items() if k in _EDITABLE_TIER_FIELDS}
        # Fast pre-check against the currently-known committed count; the CHECK
        # constraint is the race-proof backstop for a reserve that sneaks in
        # between this read and the update below.
        if "quantity" in applied and applied["quantity"] < (tt.sold + tt.reserved):
            raise QuantityBelowCommittedError()
        # Face price and schedule are both editable and either may be absent
        # from this PATCH, so the price rules are checked against the MERGED
        # row — cutting the face price below an existing phase's price is the
        # same error as submitting a phase priced above it.
        merged_price = applied.get("price_minor", tt.price_minor)
        merged_phases = (
            phases
            if phases is not None
            else [
                {
                    "name": p.name,
                    "price_minor": p.price_minor,
                    "ends_at": p.ends_at,
                    "quantity": p.quantity,
                }
                for p in tt.phases.all()
            ]
        )
        if merged_phases:
            _validate_phase_schedule(merged_phases, face_price_minor=merged_price)

        # ── THE BANDS ARE CHECKED AGAINST THE MERGED ROW TOO ──────────────
        #
        # Three things this rule depends on are independently editable and any
        # of them may be absent from this PATCH: the bands themselves, the
        # face price, and `max_per_order`. Validating the submitted bands
        # against the STORED price would let "cut the face price to 300" pass
        # while leaving a 400 band above it — the same error as submitting
        # that band directly, arrived at from the other side. `max_per_order`
        # matters for the identical reason: lowering it can strand a band
        # nobody can reach any more.
        merged_bands = (
            applied["group_bands"] if "group_bands" in applied else list(tt.group_bands or [])
        )
        merged_max = applied.get("max_per_order", tt.max_per_order)
        if merged_bands:
            _validate_group_bands(
                merged_bands, face_price_minor=merged_price, max_per_order=merged_max
            )

        with UnitOfWork() as uow:
            try:
                ok = self._ticket_types.update_if_version_matches(
                    ticket_type_id=ticket_type_id,
                    expected_version=expected_version,
                    changes=applied,
                )
            except IntegrityError as exc:
                # The no_oversell CHECK fired between the pre-check above and
                # this UPDATE: a concurrent reserve pushed committed tickets
                # above the new quantity.
                raise QuantityBelowCommittedError() from exc
            if not ok:
                raise StaleTicketTypeVersionError()
            if phases is not None:
                # AFTER the version-bump UPDATE on purpose: that UPDATE is the
                # statement that waits on any in-flight reserve's row lock, so
                # the schedule swap lands strictly between two locked reserves,
                # never interleaved with one.
                self._ticket_types.set_phases(ticket_type_id=ticket_type_id, phases=phases)

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

    # --- reservation primitives (booking calls these) ----------------------

    def reserve(self, *, ticket_type_id: uuid.UUID | str, quantity: int) -> ReservationOutcome:
        """Hold `quantity` tickets: quantity moves into `reserved`. Raises
        SaleNotStarted/SaleClosed/ExceedsMaxPerOrder/SoldOut/TicketTypeNotFound.
        Atomic; decided under the tier's row lock.

        The outcome carries `unit_price_minor` (+ `phase_name`) — the price
        this locked decision actually settled on, a sale phase or face price.
        Callers that bill for the hold MUST use it rather than a price they
        read off the tier separately: that read wasn't serialised with anyone
        else's, so under contention it can quote a phase this reserve did not
        get.
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
