"""Booking business rules — the money-path core.

Lifecycle: **reserved → (paid | cancelled | expired)**. Every reserved ticket
ends up either paid (confirmed, tickets issued, tier `reserved`→`sold`) or
released (tier `reserved` freed) — never stuck, never leaked, never
double-issued.

Two non-negotiable rules, both enforced here:

1. **All-or-nothing reserve.** CreateBooking reserves every item inside ONE
   UnitOfWork; if any single reserve fails, the whole transaction rolls back,
   which *automatically* releases everything already reserved. A partial
   reservation can never persist.
2. **No DB lock across an external call.** The payment-order call to
   PaymentPort happens AFTER the reserve transaction commits — never while a
   tier row (or the booking row) is locked. Locks are held only for the tiny
   reserve/confirm/release windows.

The authoritative hold is the DB (`status == reserved AND hold_expires_at`
in the future); the `ReleaseExpired` sweeper is the reliability backstop that
frees inventory even if every best-effort signal is missed.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import timedelta

from django.contrib.auth.models import BaseUserManager
from django.db import IntegrityError
from django.utils import timezone

from apps.events.repositories import EventRepository
from apps.ticketing.repositories import TicketTypeRepository
from apps.ticketing.services import TicketingService
from core.audit import record_audit
from core.events import (
    BOOKING_CANCELLED,
    BOOKING_CONFIRMED,
    BOOKING_CREATED,
    TICKET_ASSIGNED,
    TICKET_ISSUED,
)
from core.ports.cache_port import CachePort
from core.ports.payment_port import OrderTransfer, PaymentPort
from core.unit_of_work import UnitOfWork

from .exceptions import (
    BookingNotAssignableError,
    BookingNotCancellableError,
    BookingNotFoundError,
    EventNotBookableError,
    InvalidAttendeeAssignmentsError,
    InvalidBookingItemsError,
    NotBookingOwnerError,
)
from .models import Booking, BookingItem, BookingStatus, Ticket, TicketStatus
from .qr import sign_ticket
from .repositories import BookingRepository, TicketRepository

logger = logging.getLogger(__name__)

_CURRENCY = "INR"


@dataclass(frozen=True)
class BookingCreationResult:
    booking: Booking
    payment_order_id: str
    amount_minor: int
    currency: str


@dataclass(frozen=True)
class ConfirmResult:
    booking: Booking
    issued: bool
    reason: str  # "issued" | "already_confirmed" | "hold_expired"
    tickets: list[Ticket]


class BookingService:
    def __init__(
        self,
        *,
        bookings: BookingRepository,
        tickets: TicketRepository,
        ticket_types: TicketTypeRepository,
        ticketing: TicketingService,
        events: EventRepository,
        payments: PaymentPort,
        cache: CachePort,
        qr_secret: str,
        hold_minutes: int,
        platform_fee_per_ticket: int,
    ) -> None:
        self._bookings = bookings
        self._tickets = tickets
        self._ticket_types = ticket_types
        self._ticketing = ticketing
        self._events = events
        self._payments = payments
        self._cache = cache
        self._qr_secret = qr_secret
        self._hold_minutes = hold_minutes
        self._platform_fee_per_ticket = platform_fee_per_ticket

    # --- CreateBooking -----------------------------------------------------

    def create_booking(
        self,
        *,
        user_id: uuid.UUID | str,
        event_id: uuid.UUID | str,
        items: list[dict],
        idempotency_key: str | None = None,
    ) -> BookingCreationResult:
        if not items:
            raise InvalidBookingItemsError("At least one item is required.")

        event = self._events.get_published_by_id(event_id)
        if event is None:
            raise EventNotBookableError()

        # Read (no lock): validate every requested tier belongs to this event.
        # Deliberately NOT the price — nothing read here may reach the money.
        # The price comes from the locked reserve decision below, and there is
        # no face price carried forward for a later line to bill by mistake.
        tiers = {str(t.id): t for t in self._ticket_types.list_for_event(event_id)}
        requested = self._validate_items(items, tiers)

        if idempotency_key:
            existing = self._bookings.get_by_idempotency_key(user_id, idempotency_key)
            if existing is not None:
                return self._creation_result(self._ensure_payment_order(existing))
            # Serialise concurrent same-key creates so a double-click doesn't do a
            # second (doomed) reserve. Correctness doesn't depend on this — the DB
            # unique constraint + transaction rollback below are the real guard —
            # it just avoids the wasted reserve+rollback.
            with self._cache.lock(
                f"booking:idem:{user_id}:{idempotency_key}",
                timeout_seconds=15,
                blocking_timeout_seconds=5,
            ):
                existing = self._bookings.get_by_idempotency_key(user_id, idempotency_key)
                if existing is not None:
                    return self._creation_result(self._ensure_payment_order(existing))
                booking = self._reserve_and_insert(user_id, event_id, requested, idempotency_key)
        else:
            booking = self._reserve_and_insert(user_id, event_id, requested, None)

        # OUTSIDE the transaction/lock: the external payment-order call.
        return self._creation_result(self._ensure_payment_order(booking))

    def _validate_items(self, items: list[dict], tiers: dict) -> list[tuple[uuid.UUID | str, int]]:
        seen: set[str] = set()
        requested: list[tuple[uuid.UUID | str, int]] = []
        for item in items:
            tier_id = item["ticket_type_id"]
            quantity = item["quantity"]
            if quantity < 1:
                raise InvalidBookingItemsError("Quantity must be positive.")
            key = str(tier_id)
            if key in seen:
                raise InvalidBookingItemsError("Each ticket type may appear only once.")
            seen.add(key)
            tier = tiers.get(key)
            if tier is None:
                raise InvalidBookingItemsError(
                    "A requested ticket type doesn't belong to this event."
                )
            requested.append((tier_id, quantity))
        return requested

    def _reserve_and_insert(
        self,
        user_id,
        event_id,
        requested: list[tuple[uuid.UUID | str, int]],
        idempotency_key: str | None,
    ) -> Booking:
        booking_id = uuid.uuid4()
        hold_expires_at = timezone.now() + timedelta(minutes=self._hold_minutes)
        total_quantity = sum(q for _, q in requested)
        platform_fee = self._platform_fee_per_ticket * total_quantity

        try:
            with UnitOfWork() as uow:
                # Reserve every item under its per-tier lock. All-or-nothing: any
                # failure (SoldOut / SaleClosed / ExceedsMaxPerOrder / …) rolls the
                # whole transaction back, releasing everything reserved so far.
                #
                # ── BILL THE PRICE THE LOCK DECIDED, NOT THE ONE WE READ ─────
                #
                # `reserve` returns `unit_price_minor` — the price that locked
                # decision actually settled on, early bird or normal. The price
                # in `requested` came off an UNLOCKED read a moment earlier, and
                # under contention those two disagree in both directions: the
                # last early-bird seat can be taken between the read and the
                # lock (so we would bill a discount this hold did not get), and
                # an early-bird tier that was full on read can free up (so we
                # would overcharge for a seat that qualified).
                #
                # This is the same rule the tier counters follow — display is
                # cached and fast, the DECISION is made under the row lock and
                # nowhere else — applied to the money rather than to the count.
                #
                # `priced` is the ONE source for both the total and the line
                # items below. The items used to be built from `requested`
                # instead, whose price came off that unlocked read — so under
                # any live sale phase the line items and the billed total
                # disagreed, and the total is what payments' webhook
                # amount-checks. An invoice that doesn't add up to the amount
                # charged is not a display bug on the money path.
                priced: list[tuple[uuid.UUID | str, int, int, str | None]] = []
                for tier_id, quantity in requested:
                    outcome = self._ticketing.reserve(ticket_type_id=tier_id, quantity=quantity)
                    # reserve() always decides a price; the Optional on the
                    # outcome is for release/confirm, which decide none.
                    assert outcome.unit_price_minor is not None
                    priced.append((tier_id, quantity, outcome.unit_price_minor, outcome.phase_name))

                total_amount = sum(q * price for _, q, price, _ in priced)

                booking = self._bookings.create(
                    id=booking_id,
                    user_id=user_id,
                    event_id=event_id,
                    hold_expires_at=hold_expires_at,
                    total_amount_minor=total_amount,
                    platform_fee_minor=platform_fee,
                    idempotency_key=idempotency_key,
                )
                self._bookings.create_items(
                    [
                        BookingItem(
                            id=uuid.uuid4(),
                            booking=booking,
                            ticket_type_id=tier_id,
                            quantity=quantity,
                            unit_price_minor=price,
                            phase_name=phase_name,
                        )
                        for tier_id, quantity, price, phase_name in priced
                    ]
                )
                uow.publish(
                    BOOKING_CREATED,
                    {
                        "booking_id": str(booking.id),
                        "user_id": str(user_id),
                        "event_id": str(event_id),
                    },
                    aggregate_id=str(booking.id),
                )
                record_audit(
                    actor_id=str(user_id),
                    action="booking.created",
                    target_type="booking",
                    target_id=str(booking.id),
                )
        except IntegrityError:
            # A concurrent same-key create won the unique constraint; our reserves
            # rolled back with the transaction → return the winner, no leak.
            if idempotency_key:
                existing = self._bookings.get_by_idempotency_key(user_id, idempotency_key)
                if existing is not None:
                    return existing
            raise

        logger.info("booking_created", extra={"booking_id": str(booking.id)})
        return booking

    def _ensure_payment_order(self, booking: Booking) -> Booking:
        """Create the payment order if this reserved booking doesn't have one
        yet (external call — always outside any DB lock). Idempotent, so a
        retry after a crash between commit and this call just fills it in."""
        if booking.payment_order_id or booking.status != BookingStatus.RESERVED:
            return booking
        order_id = self._payments.create_order(
            amount_minor=booking.total_amount_minor,
            currency=_CURRENCY,
            receipt=str(booking.id),
            notes={"booking_id": str(booking.id)},
            transfers=self._build_transfers(booking),
        )
        booking.payment_order_id = order_id
        self._bookings.save(booking)
        return booking

    def _build_transfers(self, booking: Booking) -> list[OrderTransfer] | None:
        """The Route split for this order: the organizer's share (total minus
        the platform fee) transferred to their linked account, ON HOLD until
        `settlements` releases it after the event. The platform fee is retained
        by simply not transferring it — the platform never holds the
        organizer's funds. No linked account yet → no split (the fee/hold
        policy for that case is a settlements concern)."""
        account_id = self._events.get_organizer_payout_account(booking.event_id)
        if not account_id:
            return None
        organizer_amount = booking.total_amount_minor - booking.platform_fee_minor
        return [OrderTransfer(account_id=account_id, amount_minor=organizer_amount, on_hold=True)]

    def _creation_result(self, booking: Booking) -> BookingCreationResult:
        return BookingCreationResult(
            booking=booking,
            payment_order_id=booking.payment_order_id,
            amount_minor=booking.total_amount_minor,
            currency=_CURRENCY,
        )

    # --- CancelBooking -----------------------------------------------------

    def cancel_booking(self, *, booking_id: uuid.UUID | str, actor_id: uuid.UUID | str) -> Booking:
        with UnitOfWork() as uow:
            booking = self._bookings.lock_for_update(booking_id)
            if booking is None:
                raise BookingNotFoundError(str(booking_id))
            if str(booking.user_id) != str(actor_id):
                raise NotBookingOwnerError()
            if booking.status != BookingStatus.RESERVED:
                raise BookingNotCancellableError(booking.status)

            self._release_items(booking_id)
            booking.status = BookingStatus.CANCELLED
            self._bookings.save(booking)
            uow.publish(
                BOOKING_CANCELLED,
                {"booking_id": str(booking.id), "reason": "user_cancelled"},
                aggregate_id=str(booking.id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="booking.cancelled",
                target_type="booking",
                target_id=str(booking.id),
            )

        return booking

    # --- ReleaseExpired (the sweeper / reliability backstop) ---------------

    def release_expired_bookings(self, *, limit: int = 100) -> int:
        """Find holds past their expiry still in `reserved`, release their
        inventory, and mark them `expired`. Each booking is handled in its own
        short transaction so one failure doesn't block the rest and no lock is
        held across the whole sweep. Returns how many were released."""
        expired_ids = self._bookings.list_expired_reserved_ids(now=timezone.now(), limit=limit)
        released = 0
        for booking_id in expired_ids:
            if self._release_one_expired(booking_id):
                released += 1
        if released:
            logger.info("bookings_auto_released", extra={"count": released})
        return released

    def _release_one_expired(self, booking_id: uuid.UUID) -> bool:
        with UnitOfWork() as uow:
            booking = self._bookings.lock_for_update(booking_id)
            if booking is None:
                return False
            # Re-check under the lock: confirm/cancel may have won the race.
            if (
                booking.status != BookingStatus.RESERVED
                or booking.hold_expires_at >= timezone.now()
            ):
                return False

            self._release_items(booking_id)
            booking.status = BookingStatus.EXPIRED
            self._bookings.save(booking)
            uow.publish(
                BOOKING_CANCELLED,
                {"booking_id": str(booking.id), "reason": "expired"},
                aggregate_id=str(booking.id),
            )
            record_audit(
                actor_id="system",
                action="booking.expired",
                target_type="booking",
                target_id=str(booking.id),
            )
        return True

    def _release_items(self, booking_id: uuid.UUID | str) -> None:
        for item in self._bookings.list_items(booking_id):
            self._ticketing.release(ticket_type_id=item.ticket_type_id, quantity=item.quantity)

    # --- ConfirmBooking (STAGE 2 — payments will call this) ----------------

    def confirm_booking(self, *, booking_id: uuid.UUID | str, payment_ref: str) -> ConfirmResult:
        """Confirm a paid booking and issue its tickets. Called by `payments`
        from the verified webhook. IDEMPOTENT (a webhook can fire twice) and
        safe: it never issues tickets for an expired/released hold.

        Contract for the caller (payments):
        - `issued=True`  → tickets freshly issued (`tickets` populated).
        - `issued=False, reason="already_confirmed"` → replay; the SAME tickets
          are returned, never re-issued.
        - `issued=False, reason="hold_expired"` → the hold lapsed; NO tickets
          issued. The caller should refund (payments/settlements), not retry.
        """
        with UnitOfWork() as uow:
            booking = self._bookings.lock_for_update(booking_id)
            if booking is None:
                raise BookingNotFoundError(str(booking_id))

            if booking.status == BookingStatus.PAID:
                # Idempotent replay — return the existing tickets, never re-issue.
                if booking.payment_ref and booking.payment_ref != payment_ref:
                    logger.warning(
                        "booking.confirm_ref_mismatch",
                        extra={"booking_id": str(booking.id)},
                    )
                return ConfirmResult(
                    booking=booking,
                    issued=False,
                    reason="already_confirmed",
                    tickets=self._tickets.list_for_booking(booking_id),
                )

            # Hold gone: cancelled/expired, or reserved-but-past-expiry (the
            # sweeper just hasn't run yet). Do NOT issue; the sweeper frees the
            # inventory and payments/settlements handles the refund.
            hold_lapsed = (
                booking.status in (BookingStatus.CANCELLED, BookingStatus.EXPIRED)
                or booking.hold_expires_at < timezone.now()
            )
            if hold_lapsed:
                return ConfirmResult(
                    booking=booking, issued=False, reason="hold_expired", tickets=[]
                )

            # Good hold → confirm reserved->sold and issue tickets, atomically.
            items = self._bookings.list_items(booking_id)
            for item in items:
                self._ticketing.confirm_sold(
                    ticket_type_id=item.ticket_type_id, quantity=item.quantity
                )
            booking.status = BookingStatus.PAID
            booking.payment_ref = payment_ref
            self._bookings.save(booking)

            tickets = self._issue_tickets(booking, items)
            ticket_ids = [str(t.id) for t in tickets]
            uow.publish(
                BOOKING_CONFIRMED,
                {
                    "booking_id": str(booking.id),
                    "user_id": str(booking.user_id),
                    "event_id": str(booking.event_id),
                    "ticket_ids": ticket_ids,
                },
                aggregate_id=str(booking.id),
            )
            uow.publish(
                TICKET_ISSUED,
                {"booking_id": str(booking.id), "ticket_ids": ticket_ids},
                aggregate_id=str(booking.id),
            )
            record_audit(
                actor_id=str(booking.user_id),
                action="booking.confirmed",
                target_type="booking",
                target_id=str(booking.id),
            )

        logger.info(
            "booking_confirmed",
            extra={"booking_id": str(booking.id), "ticket_count": len(tickets)},
        )
        return ConfirmResult(booking=booking, issued=True, reason="issued", tickets=tickets)

    def void_tickets_for_booking(self, *, booking_id: uuid.UUID | str) -> int:
        """Void a booking's still-active tickets so a refunded ticket can't
        enter the gate. Called by `payments` from inside the refund transaction
        (booking owns Ticket, so the void lives here, not in payments).
        IDEMPOTENT: a booking with no active tickets — never confirmed, or
        already voided — is a safe no-op. This is defense in depth: `checkin`
        denies non-active tickets by status regardless, but voiding on refund
        means a refunded ticket is dead at the source. Returns the count voided.
        """
        voided = self._tickets.void_active_for_booking(booking_id)
        if voided:
            logger.info(
                "booking.tickets_voided", extra={"booking_id": str(booking_id), "count": voided}
            )
        return voided

    # --- AssignAttendees (who each ticket is for) --------------------------

    def assign_attendees(
        self,
        *,
        booking_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        assignments: list[dict],
    ) -> list[Ticket]:
        """Name the person each ticket admits, so they get their own copy.

        Somebody who books ten seats is buying for nine other people. Naming
        them here is what lets `notifications` email each one their own ticket
        instead of the buyer forwarding a single email with ten QR codes in it.

        The rules, in the order they're checked:

        - Only the buyer may address their own booking's tickets.
        - The booking must be `paid` — an unpaid hold has no tickets to send.
        - **Every ticket id must belong to THIS booking.** The ticket ids are
          the only thing the caller supplies, and without this check a caller
          could re-address somebody else's ticket to themselves, which is a
          ticket theft with a form field. This is the important one.
        - Re-assigning overwrites (people mistype addresses) and clearing is
          allowed (blank name + blank email = the buyer is going).

        Runs under the BOOKING row lock (the module's lock ordering: booking
        first, always), which is what makes the "same address doesn't re-send"
        decision below safe against two forms submitted at once. The lock is
        uncontended and the section holds no I/O — just one batched UPDATE.

        The buyer's own delivery is untouched: they still receive every ticket
        for the booking, exactly as before.
        """
        with UnitOfWork() as uow:
            booking = self._bookings.lock_for_update(booking_id)
            if booking is None:
                raise BookingNotFoundError(str(booking_id))
            if str(booking.user_id) != str(actor_id):
                raise NotBookingOwnerError()
            if booking.status != BookingStatus.PAID:
                raise BookingNotAssignableError(booking.status)

            tickets = {str(t.id): t for t in self._tickets.list_for_attendee_assignment(booking_id)}
            requested = self._validate_assignments(assignments, tickets)

            changed: list[Ticket] = []
            newly_addressed: list[Ticket] = []
            for ticket_id, name, email in requested:
                ticket = tickets[ticket_id]
                if ticket.attendee_name == name and ticket.attendee_email == email:
                    continue  # nothing to write, nothing to send
                # THE EMAIL is what decides whether a copy needs sending. A
                # corrected spelling of the same person's name updates the row
                # and publishes nothing — that address already has this ticket,
                # and re-sending it every time the buyer touches the form is
                # how one order becomes a mailbox full of duplicates. Compared
                # case-insensitively because "Alice@x.com" and "alice@x.com"
                # are the same human, while the address we STORE keeps the
                # local part's case, which is not ours to fold away.
                resend = bool(email) and email.casefold() != ticket.attendee_email.casefold()
                ticket.attendee_name = name
                ticket.attendee_email = email
                changed.append(ticket)
                if resend:
                    newly_addressed.append(ticket)

            self._tickets.set_attendees(changed)

            for ticket in newly_addressed:
                # In the same transaction as the write, so a ticket can never be
                # addressed to somebody the outbox has no record of telling.
                uow.publish(
                    TICKET_ASSIGNED,
                    {
                        "ticket_id": str(ticket.id),
                        "booking_id": str(booking.id),
                        "event_id": str(booking.event_id),
                        "attendee_name": ticket.attendee_name,
                        "attendee_email": ticket.attendee_email,
                        "ticket_type_name": ticket.ticket_type.name,
                    },
                    aggregate_id=str(ticket.id),
                )

            if changed:
                record_audit(
                    actor_id=str(actor_id),
                    action="booking.attendees_assigned",
                    target_type="booking",
                    target_id=str(booking.id),
                )

        if newly_addressed:
            logger.info(
                "booking.attendees_assigned",
                extra={"booking_id": str(booking.id), "sent_to": len(newly_addressed)},
            )
        # The full list, joined for the response DTO — the caller's screen shows
        # every ticket, not just the ones that moved.
        return self._tickets.list_for_booking(booking_id)

    def _validate_assignments(
        self, assignments: list[dict], tickets: dict[str, Ticket]
    ) -> list[tuple[str, str, str]]:
        if len(assignments) > len(tickets):
            # Bounded by the thing itself: you cannot name more attendees than
            # there are seats, and an unbounded list is an unbounded write.
            raise InvalidAttendeeAssignmentsError(
                "More attendees were named than this booking has tickets."
            )

        seen: set[str] = set()
        requested: list[tuple[str, str, str]] = []
        for assignment in assignments:
            ticket_id = str(assignment["ticket_id"])
            if ticket_id in seen:
                # Two entries for one ticket means the client is confused about
                # who is going; silently letting the last one win would send a
                # ticket to one of two people with no way to tell which.
                raise InvalidAttendeeAssignmentsError("Each ticket may appear only once.")
            seen.add(ticket_id)

            ticket = tickets.get(ticket_id)
            if ticket is None:
                raise InvalidAttendeeAssignmentsError(
                    "A ticket in this request doesn't belong to this booking."
                )

            name = str(assignment.get("name") or "").strip()
            email = BaseUserManager.normalize_email(str(assignment.get("email") or "").strip())
            if bool(name) != bool(email):
                # Both or neither. A name with no address looks assigned on the
                # screen and delivers nothing, which is indistinguishable from a
                # lost email; an address with no name doesn't say who is being
                # admitted. Neither of the two is a state worth storing.
                raise InvalidAttendeeAssignmentsError("An attendee needs both a name and an email.")
            if email and ticket.status != TicketStatus.ACTIVE:
                # Same rule as "the booking must be paid", one level down: a
                # used or refunded ticket admits nobody, so mailing it to
                # somebody is a promise the gate will refuse.
                raise InvalidAttendeeAssignmentsError(
                    "A ticket that is no longer active can't be assigned to anyone."
                )
            requested.append((ticket_id, name, email))
        return requested

    def _issue_tickets(self, booking: Booking, items: list[BookingItem]) -> list[Ticket]:
        tickets: list[Ticket] = []
        for item in items:
            for _ in range(item.quantity):
                ticket_id = uuid.uuid4()
                token = sign_ticket(
                    ticket_id=ticket_id, event_id=booking.event_id, secret=self._qr_secret
                )
                tickets.append(
                    Ticket(
                        id=ticket_id,
                        booking_id=booking.id,
                        ticket_type_id=item.ticket_type_id,
                        qr_token=token,
                        status=TicketStatus.ACTIVE,
                    )
                )
        self._tickets.bulk_create(tickets)
        return tickets
