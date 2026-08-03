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


# --- the price half of the locked decision ---------------------------------


@pytest.mark.django_db
def test_reserve_reports_the_normal_price_when_there_is_no_early_bird(strategy, make_ticket_type):
    tt = make_ticket_type(quantity=10, price_minor=50_000)

    outcome = strategy.reserve(ticket_type_id=tt.id, quantity=2)

    assert outcome.unit_price_minor == 50_000
    assert outcome.early_bird_applied is False


@pytest.mark.django_db
def test_reserve_charges_the_early_bird_price_while_it_is_live(strategy, make_ticket_type):
    tt = make_ticket_type(
        quantity=10,
        price_minor=50_000,
        early_bird_price_minor=30_000,
        early_bird_ends_at=timezone.now() + timedelta(days=1),
    )

    outcome = strategy.reserve(ticket_type_id=tt.id, quantity=2)

    assert outcome.unit_price_minor == 30_000
    assert outcome.early_bird_applied is True


@pytest.mark.django_db
def test_reserve_charges_the_normal_price_after_the_deadline(strategy, make_ticket_type):
    tt = make_ticket_type(
        quantity=10,
        price_minor=50_000,
        early_bird_price_minor=30_000,
        early_bird_ends_at=timezone.now() - timedelta(minutes=1),
    )

    outcome = strategy.reserve(ticket_type_id=tt.id, quantity=1)

    assert outcome.unit_price_minor == 50_000
    assert outcome.early_bird_applied is False


@pytest.mark.django_db
def test_reserve_stops_discounting_once_the_allocation_is_taken(strategy, make_ticket_type):
    # 3 discounted seats; 3 are already held, so this buyer is the fourth.
    tt = make_ticket_type(
        quantity=10, price_minor=50_000, early_bird_price_minor=30_000, early_bird_quantity=3
    )

    first = strategy.reserve(ticket_type_id=tt.id, quantity=3)
    assert first.unit_price_minor == 30_000

    second = strategy.reserve(ticket_type_id=tt.id, quantity=1)
    assert second.unit_price_minor == 50_000
    assert second.early_bird_applied is False


@pytest.mark.django_db
def test_reserve_prices_from_the_counters_as_they_stand_before_this_hold(
    strategy, make_ticket_type
):
    """The order taking the LAST discounted seats still gets them — the
    allocation counts seats already committed, not the ones being taken."""
    tt = make_ticket_type(
        quantity=10, price_minor=50_000, early_bird_price_minor=30_000, early_bird_quantity=2
    )

    outcome = strategy.reserve(ticket_type_id=tt.id, quantity=2)

    assert outcome.unit_price_minor == 30_000


@pytest.mark.django_db
def test_release_and_confirm_report_no_price(strategy, make_ticket_type):
    """They decide no price, so they state none — a number here would invite a
    caller to bill from something nothing decided."""
    tt = make_ticket_type(quantity=10, reserved=4, price_minor=50_000)

    assert strategy.release(ticket_type_id=tt.id, quantity=1).unit_price_minor is None
    assert strategy.confirm_sold(ticket_type_id=tt.id, quantity=1).unit_price_minor is None


@pytest.mark.django_db
def test_released_holds_return_their_seats_to_the_early_bird_allocation(strategy, make_ticket_type):
    """The allocation is measured against `sold + reserved` as they stand, so
    it needs no bookkeeping of its own: when holds lapse and `booking`'s
    sweeper releases them, those seats are early-bird seats again. It also
    means an UNDISCOUNTED hold occupies an allocation slot while it lives —
    the allocation is "the first k seats of this tier", which is what
    `sold + reserved < early_bird_quantity` says."""
    tt = make_ticket_type(
        quantity=10, price_minor=50_000, early_bird_price_minor=30_000, early_bird_quantity=1
    )
    assert strategy.reserve(ticket_type_id=tt.id, quantity=1).unit_price_minor == 30_000
    assert strategy.reserve(ticket_type_id=tt.id, quantity=1).unit_price_minor == 50_000

    strategy.release(ticket_type_id=tt.id, quantity=2)  # both holds lapse

    assert strategy.reserve(ticket_type_id=tt.id, quantity=1).unit_price_minor == 30_000


@pytest.mark.django_db
def test_reserve_prices_the_locked_row_not_the_display_cache(strategy, make_ticket_type):
    """The cached tier payload can be stale by its TTL; the charge can't. Warm
    the display cache with the discount live, expire the discount underneath
    it, and the next reserve must still bill the normal price."""
    from apps.ticketing.models import TicketType
    from apps.ticketing.selectors import get_event_tiers_payload

    tt = make_ticket_type(
        quantity=10,
        price_minor=50_000,
        early_bird_price_minor=30_000,
        early_bird_ends_at=timezone.now() + timedelta(hours=1),
    )
    cached = get_event_tiers_payload(tt.event_id)
    assert cached[0]["effective_price"] == 30_000

    TicketType.objects.filter(pk=tt.id).update(
        early_bird_ends_at=timezone.now() - timedelta(minutes=1)
    )

    outcome = strategy.reserve(ticket_type_id=tt.id, quantity=1)

    assert outcome.unit_price_minor == 50_000
    # The stale display is still there — that's the accepted trade, and it is
    # the reason the charge is never read from it.
    assert get_event_tiers_payload(tt.event_id)[0]["effective_price"] == 30_000


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
