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
    TICKET_ISSUED,
)
from core.ports.cache_port import CachePort
from core.ports.payment_port import OrderTransfer, PaymentPort
from core.unit_of_work import UnitOfWork

from .exceptions import (
    BookingNotCancellableError,
    BookingNotFoundError,
    EventNotBookableError,
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

        # Read (no lock): validate every requested tier belongs to this event
        # and capture the price to bill — the price the buyer is seeing now.
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

    def _validate_items(self, items: list[dict], tiers: dict) -> list[tuple]:
        seen: set[str] = set()
        requested: list[tuple] = []
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
            requested.append((tier_id, quantity, tier.price_minor))
        return requested

    def _reserve_and_insert(
        self, user_id, event_id, requested: list[tuple], idempotency_key: str | None
    ) -> Booking:
        booking_id = uuid.uuid4()
        hold_expires_at = timezone.now() + timedelta(minutes=self._hold_minutes)
        total_quantity = sum(q for _, q, _ in requested)
        total_amount = sum(q * price for _, q, price in requested)
        platform_fee = self._platform_fee_per_ticket * total_quantity

        try:
            with UnitOfWork() as uow:
                # Reserve every item under its per-tier lock. All-or-nothing: any
                # failure (SoldOut / SaleClosed / ExceedsMaxPerOrder / …) rolls the
                # whole transaction back, releasing everything reserved so far.
                for tier_id, quantity, _ in requested:
                    self._ticketing.reserve(ticket_type_id=tier_id, quantity=quantity)

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
                        )
                        for tier_id, quantity, price in requested
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
