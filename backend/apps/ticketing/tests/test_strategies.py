"""Decision-logic tests for the row-lock strategy. These run under the
default `django_db` transaction, which is itself an atomic block — enough for
`select_for_update` to work in a single-threaded test. Genuine concurrency is
covered in test_concurrency.py."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.ticketing.exceptions import (
    ExceedsMaxPerOrderError,
    SaleClosedError,
    SaleNotStartedError,
    SoldOutError,
    TicketTypeNotFoundError,
)


@pytest.mark.django_db
def test_reserve_decrements_availability_and_reports_outcome(strategy, make_ticket_type):
    tt = make_ticket_type(quantity=10)

    outcome = strategy.reserve(ticket_type_id=tt.id, quantity=3)

    assert outcome.quantity == 3
    assert outcome.available_after == 7
    assert outcome.became_sold_out is False
    tt.refresh_from_db()
    assert tt.reserved == 3


@pytest.mark.django_db
def test_reserve_flags_became_sold_out_on_the_last_tickets(strategy, make_ticket_type):
    tt = make_ticket_type(quantity=2)

    outcome = strategy.reserve(ticket_type_id=tt.id, quantity=2)

    assert outcome.available_after == 0
    assert outcome.became_sold_out is True


@pytest.mark.django_db
def test_reserve_rejects_more_than_available(strategy, make_ticket_type):
    tt = make_ticket_type(quantity=5, reserved=4)  # only 1 left

    with pytest.raises(SoldOutError) as exc:
        strategy.reserve(ticket_type_id=tt.id, quantity=2)
    assert exc.value.available == 1


@pytest.mark.django_db
def test_reserve_rejects_over_max_per_order(strategy, make_ticket_type):
    tt = make_ticket_type(quantity=100, max_per_order=4)

    with pytest.raises(ExceedsMaxPerOrderError):
        strategy.reserve(ticket_type_id=tt.id, quantity=5)


@pytest.mark.django_db
def test_reserve_rejects_before_sale_start(strategy, make_ticket_type):
    tt = make_ticket_type(quantity=10, sale_start=timezone.now() + timedelta(days=1))

    with pytest.raises(SaleNotStartedError):
        strategy.reserve(ticket_type_id=tt.id, quantity=1)


@pytest.mark.django_db
def test_reserve_rejects_after_sale_end(strategy, make_ticket_type):
    tt = make_ticket_type(quantity=10, sale_end=timezone.now() - timedelta(days=1))

    with pytest.raises(SaleClosedError):
        strategy.reserve(ticket_type_id=tt.id, quantity=1)


@pytest.mark.django_db
def test_reserve_unknown_tier_raises_not_found(strategy):
    with pytest.raises(TicketTypeNotFoundError):
        strategy.reserve(ticket_type_id="00000000-0000-0000-0000-000000000000", quantity=1)


@pytest.mark.django_db
def test_release_is_clamped_and_safe_to_retry(strategy, make_ticket_type):
    tt = make_ticket_type(quantity=10, reserved=2)

    # Releasing more than is reserved clamps to what's there — never negative.
    outcome = strategy.release(ticket_type_id=tt.id, quantity=5)

    assert outcome.quantity == 2  # only 2 were actually reserved
    tt.refresh_from_db()
    assert tt.reserved == 0

    # A second (retry) release is a no-op.
    strategy.release(ticket_type_id=tt.id, quantity=5)
    tt.refresh_from_db()
    assert tt.reserved == 0


@pytest.mark.django_db
def test_confirm_is_clamped_and_safe_to_retry(strategy, make_ticket_type):
    tt = make_ticket_type(quantity=10, reserved=3)

    strategy.confirm_sold(ticket_type_id=tt.id, quantity=10)  # clamps to reserved (3)

    tt.refresh_from_db()
    assert tt.sold == 3
    assert tt.reserved == 0

    # Retry can't double-count sold.
    strategy.confirm_sold(ticket_type_id=tt.id, quantity=3)
    tt.refresh_from_db()
    assert tt.sold == 3
