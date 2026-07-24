"""ORM access for bookings and tickets. Reads are shaped to avoid N+1 (the
detail and /me/tickets queries fetch related rows in one round trip); writes
keep the locked window on the booking row minimal."""

from __future__ import annotations

import uuid
from datetime import datetime

from django.db.models import Prefetch, QuerySet

from core.base_repository import BaseRepository

from .models import Booking, BookingItem, BookingStatus, Ticket, TicketStatus


class BookingRepository(BaseRepository[Booking]):
    model = Booking

    # --- writes / lifecycle ------------------------------------------------

    def create(
        self,
        *,
        id: uuid.UUID,
        user_id: uuid.UUID | str,
        event_id: uuid.UUID | str,
        hold_expires_at: datetime,
        total_amount_minor: int,
        platform_fee_minor: int,
        idempotency_key: str | None,
    ) -> Booking:
        return Booking.objects.create(
            id=id,
            user_id=user_id,
            event_id=event_id,
            hold_expires_at=hold_expires_at,
            total_amount_minor=total_amount_minor,
            platform_fee_minor=platform_fee_minor,
            idempotency_key=idempotency_key,
        )

    def create_items(self, items: list[BookingItem]) -> None:
        BookingItem.objects.bulk_create(items)

    def lock_for_update(self, booking_id: uuid.UUID | str) -> Booking | None:
        """SELECT ... FOR UPDATE on the booking row — the coordination point
        that serialises confirm / cancel / sweep so a booking can't be, say,
        confirmed and expired at once. Its items aren't locked (releasing/
        confirming inventory locks the *tier* rows via ticketing)."""
        return Booking.objects.select_for_update().filter(pk=booking_id).first()

    def list_items(self, booking_id: uuid.UUID | str) -> list[BookingItem]:
        return list(BookingItem.objects.filter(booking_id=booking_id))

    # --- reads -------------------------------------------------------------

    def get_by_idempotency_key(
        self, user_id: uuid.UUID | str, idempotency_key: str
    ) -> Booking | None:
        return Booking.objects.filter(user_id=user_id, idempotency_key=idempotency_key).first()

    def get_detail(self, booking_id: uuid.UUID | str) -> Booking | None:
        """Booking + event + items(+tier) in a fixed number of queries, for
        GET /bookings/{id}."""
        return (
            Booking.objects.select_related("event")
            .prefetch_related(
                Prefetch("items", queryset=BookingItem.objects.select_related("ticket_type"))
            )
            .filter(pk=booking_id)
            .first()
        )

    def list_expired_reserved_ids(self, *, now: datetime, limit: int = 100) -> list[uuid.UUID]:
        """Ids of holds whose window has lapsed but are still reserved — the
        sweeper's work list. Ids only (each is re-loaded under lock before being
        touched), so the sweep doesn't hold anything while it iterates."""
        return list(
            Booking.objects.filter(
                status=BookingStatus.RESERVED, hold_expires_at__lt=now
            ).values_list("id", flat=True)[:limit]
        )


class TicketRepository(BaseRepository[Ticket]):
    model = Ticket

    def bulk_create(self, tickets: list[Ticket]) -> list[Ticket]:
        return Ticket.objects.bulk_create(tickets)

    def list_for_booking(self, booking_id: uuid.UUID | str) -> list[Ticket]:
        return list(
            Ticket.objects.select_related("ticket_type", "booking__event")
            .filter(booking_id=booking_id)
            .order_by("created_at")
        )

    def list_active_for_user(self, user_id: uuid.UUID | str) -> QuerySet[Ticket]:
        """A user's active tickets, newest first — one query with the tier and
        event joined so the DTO never N+1s."""
        return (
            Ticket.objects.select_related("ticket_type", "booking__event")
            .filter(booking__user_id=user_id, status=TicketStatus.ACTIVE)
            .order_by("-created_at", "id")
        )
