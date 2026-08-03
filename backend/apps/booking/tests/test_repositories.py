from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.booking.models import Booking, BookingStatus
from apps.booking.repositories import BookingRepository, TicketRepository


@pytest.fixture
def repo() -> BookingRepository:
    return BookingRepository()


def _make_booking(buyer, event, *, status=BookingStatus.RESERVED, hold_minutes=10):
    return Booking.objects.create(
        user_id=buyer.id,
        event_id=event.id,
        status=status,
        hold_expires_at=timezone.now() + timedelta(minutes=hold_minutes),
        total_amount_minor=1000,
        platform_fee_minor=10,
    )


@pytest.mark.django_db
def test_get_by_idempotency_key(repo, buyer, event):
    booking = Booking.objects.create(
        user_id=buyer.id,
        event_id=event.id,
        hold_expires_at=timezone.now() + timedelta(minutes=10),
        total_amount_minor=1000,
        platform_fee_minor=10,
        idempotency_key="key-1",
    )

    assert repo.get_by_idempotency_key(buyer.id, "key-1").id == booking.id
    assert repo.get_by_idempotency_key(buyer.id, "missing") is None


@pytest.mark.django_db
def test_list_expired_reserved_ids_finds_only_lapsed_reserved(repo, buyer, event):
    live = _make_booking(buyer, event, hold_minutes=10)
    expired = _make_booking(buyer, event, hold_minutes=-5)  # past
    paid = _make_booking(buyer, event, hold_minutes=-5, status=BookingStatus.PAID)

    ids = repo.list_expired_reserved_ids(now=timezone.now())

    assert expired.id in ids
    assert live.id not in ids  # still in its window
    assert paid.id not in ids  # not reserved anymore


@pytest.mark.django_db
def test_get_detail_loads_event_and_items(repo, booking_service, buyer, event, make_tier):
    tier = make_tier(name="Gold", quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 2}]
    )

    detail = repo.get_detail(result.booking.id)

    assert detail is not None
    assert detail.event.title == "Headline Show"
    items = list(detail.items.all())
    assert len(items) == 1
    assert items[0].ticket_type.name == "Gold"
    # A reserved booking has no tickets yet — prefetched empty, never absent.
    assert list(detail.tickets.all()) == []


@pytest.mark.django_db
def test_list_for_attendee_assignment_is_one_query_with_the_tier_name(
    booking_service, buyer, event, make_tier, django_assert_num_queries
):
    """The tier name goes into the TICKET_ASSIGNED payload, so it must come
    back joined — otherwise a ten-seat booking is ten extra queries inside the
    booking lock."""
    tier = make_tier(name="Gold", quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 3}]
    )
    booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_1")

    with django_assert_num_queries(1):
        tickets = TicketRepository().list_for_attendee_assignment(result.booking.id)
        assert [t.ticket_type.name for t in tickets] == ["Gold", "Gold", "Gold"]
        assert all(t.attendee_email == "" for t in tickets)
