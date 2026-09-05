"""Read-side of booking (CQRS-lite). Nothing here is cached: a booking and a
user's tickets are private, per-user data (and a booking's status is
security-sensitive and fast-moving), so these responses are `private,
no-store`. The reserve/availability decisions are ticketing's and are never
cached anyway."""

from __future__ import annotations

import uuid

from django.db.models import QuerySet

from .models import Booking, Ticket
from .repositories import BookingRepository, TicketRepository


def get_booking_detail(
    booking_id: uuid.UUID | str, *, bookings: BookingRepository | None = None
) -> Booking | None:
    """Booking + event + items(+tier) for GET /bookings/{id}. Ownership is
    checked in the view against the loaded row."""
    bookings = bookings or BookingRepository()
    return bookings.get_detail(booking_id)


def list_my_bookings(
    user_id: uuid.UUID | str, *, bookings: BookingRepository | None = None
) -> QuerySet[Booking]:
    """This account's purchase history — every booking, in every state.

    Distinct from `list_my_tickets`, which returns only ACTIVE tickets. A
    refunded, checked-in, cancelled or never-paid booking has no active ticket
    and so had no representation anywhere the customer could see; a payment
    that failed left nothing on screen at all. This is what the account's
    Bookings & Purchases list reads.
    """
    bookings = bookings or BookingRepository()
    return bookings.list_for_user(user_id)


def list_my_tickets(
    user_id: uuid.UUID | str, *, tickets: TicketRepository | None = None
) -> QuerySet[Ticket]:
    """A user's active tickets, newest first — one query with tier + event
    joined (no N+1)."""
    tickets = tickets or TicketRepository()
    return tickets.list_active_for_user(user_id)
