from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.booking.exceptions import (
    BookingNotCancellableError,
    EventNotBookableError,
    InvalidBookingItemsError,
    NotBookingOwnerError,
)
from apps.booking.models import Booking, BookingStatus, Ticket, TicketStatus
from apps.booking.qr import verify_ticket_token
from apps.booking.tests.conftest import QR_SECRET
from apps.ticketing.exceptions import SoldOutError
from apps.ticketing.repositories import TicketTypeRepository
from core.models import OutboxEvent


def _reserved(tier_id) -> int:
    tt = TicketTypeRepository().get_active_by_id(tier_id)
    assert tt is not None
    return tt.reserved


def _sold(tier_id) -> int:
    tt = TicketTypeRepository().get_active_by_id(tier_id)
    assert tt is not None
    return tt.sold


# --- CreateBooking ---------------------------------------------------------


@pytest.mark.django_db
def test_create_booking_reserves_and_holds(booking_service, event, buyer, make_tier):
    tier = make_tier(price_minor=50000, quantity=100)

    result = booking_service.create_booking(
        user_id=buyer.id,
        event_id=event.id,
        items=[{"ticket_type_id": tier.id, "quantity": 2}],
    )

    booking = result.booking
    assert booking.status == BookingStatus.RESERVED
    assert booking.total_amount_minor == 100000  # 2 x 50000
    assert booking.platform_fee_minor == 20  # 10 per ticket x 2
    assert result.payment_order_id.startswith("fake_order_")
    assert _reserved(tier.id) == 2
    assert OutboxEvent.objects.filter(event_type="booking.booking_created").exists()


@pytest.mark.django_db
def test_create_booking_is_all_or_nothing_across_tiers(booking_service, event, buyer, make_tier):
    plenty = make_tier(name="Basic", quantity=100)
    scarce = make_tier(name="VIP", quantity=1)  # only 1 left

    # Ask for 1 Basic (ok) + 2 VIP (impossible) → the whole booking must fail
    # and NOTHING may stay reserved.
    with pytest.raises(SoldOutError):
        booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[
                {"ticket_type_id": plenty.id, "quantity": 1},
                {"ticket_type_id": scarce.id, "quantity": 2},
            ],
        )

    assert _reserved(plenty.id) == 0  # the successful reserve was rolled back
    assert _reserved(scarce.id) == 0
    assert Booking.objects.count() == 0


@pytest.mark.django_db
def test_create_booking_is_idempotent_on_the_idempotency_key(
    booking_service, event, buyer, make_tier
):
    tier = make_tier(quantity=100)
    items = [{"ticket_type_id": tier.id, "quantity": 3}]

    first = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=items, idempotency_key="abc-123"
    )
    second = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=items, idempotency_key="abc-123"
    )

    assert first.booking.id == second.booking.id  # same booking, not a new one
    assert Booking.objects.count() == 1
    assert _reserved(tier.id) == 3  # reserved once, not twice


@pytest.mark.django_db
def test_create_booking_rejects_tier_from_another_event(booking_service, event, buyer, make_tier):
    from apps.events.models import Event, EventStatus
    from apps.events.repositories import EventRepository

    other = EventRepository().create(
        organization_id=event.organization_id,
        title="Other",
        venue="X",
        city="Y",
        starts_at=timezone.now() + timedelta(days=10),
    )
    Event.objects.filter(pk=other.id).update(status=EventStatus.LIVE)
    foreign_tier = make_tier(ev=other)

    with pytest.raises(InvalidBookingItemsError):
        booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": foreign_tier.id, "quantity": 1}],
        )


@pytest.mark.django_db
def test_create_booking_rejects_a_draft_event(booking_service, buyer, make_tier):
    from apps.events.models import Event, EventStatus
    from apps.events.repositories import EventRepository

    draft = EventRepository().create(
        organization_id=make_tier().event.organization_id,
        title="Draft",
        venue="X",
        city="Y",
        starts_at=timezone.now() + timedelta(days=10),
    )
    Event.objects.filter(pk=draft.id).update(status=EventStatus.DRAFT)
    tier = make_tier(ev=draft)

    with pytest.raises(EventNotBookableError):
        booking_service.create_booking(
            user_id=buyer.id, event_id=draft.id, items=[{"ticket_type_id": tier.id, "quantity": 1}]
        )


# --- CancelBooking ---------------------------------------------------------


@pytest.mark.django_db
def test_cancel_releases_inventory_and_marks_cancelled(booking_service, event, buyer, make_tier):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 4}]
    )
    assert _reserved(tier.id) == 4

    booking = booking_service.cancel_booking(booking_id=result.booking.id, actor_id=buyer.id)

    assert booking.status == BookingStatus.CANCELLED
    assert _reserved(tier.id) == 0  # inventory freed


@pytest.mark.django_db
def test_cancel_by_non_owner_is_rejected(booking_service, event, buyer, other_user, make_tier):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 1}]
    )

    with pytest.raises(NotBookingOwnerError):
        booking_service.cancel_booking(booking_id=result.booking.id, actor_id=other_user.id)


@pytest.mark.django_db
def test_cancel_a_paid_booking_is_rejected(booking_service, event, buyer, make_tier):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 1}]
    )
    booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_1")

    with pytest.raises(BookingNotCancellableError):
        booking_service.cancel_booking(booking_id=result.booking.id, actor_id=buyer.id)


# --- ReleaseExpired (sweeper) ----------------------------------------------


@pytest.mark.django_db
def test_sweeper_auto_releases_expired_holds(booking_service, event, buyer, make_tier):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 5}]
    )
    assert _reserved(tier.id) == 5

    # Force the hold into the past.
    Booking.objects.filter(pk=result.booking.id).update(
        hold_expires_at=timezone.now() - timedelta(minutes=1)
    )

    released = booking_service.release_expired_bookings()

    assert released == 1
    assert _reserved(tier.id) == 0  # inventory restored
    result.booking.refresh_from_db()
    assert result.booking.status == BookingStatus.EXPIRED


@pytest.mark.django_db
def test_sweeper_leaves_live_holds_untouched(booking_service, event, buyer, make_tier):
    tier = make_tier(quantity=100)
    booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 2}]
    )

    released = booking_service.release_expired_bookings()

    assert released == 0
    assert _reserved(tier.id) == 2  # still held


# --- ConfirmBooking (Stage 2) ----------------------------------------------


@pytest.mark.django_db
def test_confirm_issues_signed_tickets_and_converts_reserved_to_sold(
    booking_service, event, buyer, make_tier
):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 3}]
    )

    outcome = booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_1")

    assert outcome.issued is True
    assert len(outcome.tickets) == 3
    assert _sold(tier.id) == 3
    assert _reserved(tier.id) == 0
    # Every issued ticket has a valid, verifiable token.
    for ticket in outcome.tickets:
        payload = verify_ticket_token(ticket.qr_token, secret=QR_SECRET)
        assert payload is not None
        assert payload.ticket_id == str(ticket.id)
        assert payload.event_id == str(event.id)
    assert OutboxEvent.objects.filter(event_type="booking.booking_confirmed").exists()
    assert OutboxEvent.objects.filter(event_type="booking.ticket_issued").exists()


@pytest.mark.django_db
def test_confirm_is_idempotent_never_issues_duplicate_tickets(
    booking_service, event, buyer, make_tier
):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 2}]
    )

    first = booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_1")
    second = booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_1")

    assert first.issued is True
    assert second.issued is False
    assert second.reason == "already_confirmed"
    assert {t.id for t in first.tickets} == {t.id for t in second.tickets}
    # Exactly one set of tickets exists — no duplicates from the second call.
    assert Ticket.objects.filter(booking_id=result.booking.id).count() == 2
    assert _sold(tier.id) == 2  # not 4


@pytest.mark.django_db
def test_confirm_after_expiry_issues_no_tickets(booking_service, event, buyer, make_tier):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 2}]
    )
    Booking.objects.filter(pk=result.booking.id).update(
        hold_expires_at=timezone.now() - timedelta(minutes=1)
    )

    outcome = booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_late")

    assert outcome.issued is False
    assert outcome.reason == "hold_expired"
    assert outcome.tickets == []
    assert Ticket.objects.filter(booking_id=result.booking.id).count() == 0
    assert _sold(tier.id) == 0  # nothing sold


@pytest.mark.django_db
def test_confirm_a_cancelled_booking_issues_nothing(booking_service, event, buyer, make_tier):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 1}]
    )
    booking_service.cancel_booking(booking_id=result.booking.id, actor_id=buyer.id)

    outcome = booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_x")

    assert outcome.issued is False
    assert outcome.reason == "hold_expired"
    assert Ticket.objects.filter(booking_id=result.booking.id).count() == 0


@pytest.mark.django_db
def test_ticket_status_defaults_to_active(booking_service, event, buyer, make_tier):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 1}]
    )
    outcome = booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_1")

    assert outcome.tickets[0].status == TicketStatus.ACTIVE
