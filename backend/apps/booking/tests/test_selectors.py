from __future__ import annotations

import pytest

from apps.booking.selectors import get_booking_detail, list_my_tickets


@pytest.mark.django_db
def test_get_booking_detail_returns_none_for_missing():
    assert get_booking_detail("00000000-0000-0000-0000-000000000000") is None


@pytest.mark.django_db
def test_list_my_tickets_is_one_query(
    booking_service, buyer, event, make_tier, django_assert_num_queries
):
    tier = make_tier(quantity=100)
    result = booking_service.create_booking(
        user_id=buyer.id, event_id=event.id, items=[{"ticket_type_id": tier.id, "quantity": 3}]
    )
    booking_service.confirm_booking(booking_id=result.booking.id, payment_ref="pay_1")

    with django_assert_num_queries(1):
        tickets = list(list_my_tickets(buyer.id))
        # Touch the joined relations — must not trigger extra queries.
        _ = [(t.ticket_type.name, t.booking.event.title) for t in tickets]

    assert len(tickets) == 3
