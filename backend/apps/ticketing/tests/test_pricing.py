"""The early-bird rule, tested as a pure function — no DB, no clock.

Its failure cases are boundaries: the deadline instant, the last allocated
seat, and an order that straddles that seat. None of them are visible by
looking at a tier that renders correctly, which is why the rule lives in
`pricing.py` rather than inline in the strategy.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from apps.ticketing.pricing import EarlyBirdState, decide_unit_price, evaluate_early_bird

NOW = datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc)


def _state(
    *,
    price_minor: int = 100_000,
    early_bird_price_minor: int | None = 60_000,
    early_bird_ends_at: datetime | None = None,
    early_bird_quantity: int | None = None,
    sold: int = 0,
    reserved: int = 0,
    now: datetime = NOW,
) -> EarlyBirdState:
    """A tier priced at ₹1,000 with a ₹600 early bird and no bounds, unless a
    test says otherwise."""
    return evaluate_early_bird(
        price_minor=price_minor,
        early_bird_price_minor=early_bird_price_minor,
        early_bird_ends_at=early_bird_ends_at,
        early_bird_quantity=early_bird_quantity,
        sold=sold,
        reserved=reserved,
        now=now,
    )


# --- when the early bird applies -------------------------------------------


def test_no_early_bird_configured_is_just_the_normal_price():
    state = _state(early_bird_price_minor=None)

    assert state.is_active is False
    assert state.effective_price_minor == 100_000
    assert state.remaining is None
    assert state.ends_at is None


def test_configured_with_no_bounds_is_active():
    state = _state()

    assert state.is_active is True
    assert state.effective_price_minor == 60_000
    # No cap set → no number to report. The platform does not invent one.
    assert state.remaining is None


def test_active_before_the_deadline_and_over_after_it():
    live = _state(early_bird_ends_at=NOW + timedelta(hours=1))
    assert live.is_active is True
    assert live.effective_price_minor == 60_000

    over = _state(early_bird_ends_at=NOW - timedelta(seconds=1))
    assert over.is_active is False
    assert over.effective_price_minor == 100_000


def test_the_deadline_instant_itself_is_over():
    # `ends_at` is exclusive: at exactly the deadline the discount has ended.
    state = _state(early_bird_ends_at=NOW)

    assert state.is_active is False


def test_allocation_counts_sold_and_reserved_together():
    # A held (unpaid) seat consumes the allocation exactly like a sold one —
    # otherwise a rush of holds would hand out the discount twice over.
    state = _state(early_bird_quantity=10, sold=4, reserved=6)

    assert state.is_active is False
    assert state.remaining == 0
    assert state.effective_price_minor == 100_000


def test_remaining_counts_down_to_the_last_allocated_seat():
    state = _state(early_bird_quantity=10, sold=3, reserved=6)

    assert state.is_active is True
    assert state.remaining == 1


def test_remaining_is_zero_once_the_deadline_passes_even_with_seats_left():
    """A capped early bird that timed out has no seats left AT THAT PRICE —
    reporting the unused allocation would put "3 left" on a screen where
    nobody can get one."""
    state = _state(
        early_bird_quantity=10, sold=7, reserved=0, early_bird_ends_at=NOW - timedelta(minutes=1)
    )

    assert state.is_active is False
    assert state.remaining == 0


def test_remaining_never_reads_negative():
    # An organizer can cut `early_bird_quantity` below what's already committed.
    state = _state(early_bird_quantity=5, sold=9)

    assert state.remaining == 0
    assert state.is_active is False


def test_a_stray_deadline_without_a_price_is_not_reported():
    state = _state(early_bird_price_minor=None, early_bird_ends_at=NOW + timedelta(days=2))

    assert state.ends_at is None  # no discount exists, so nothing is ending


# --- the charged unit price -------------------------------------------------


def test_charged_price_matches_an_active_uncapped_early_bird():
    assert decide_unit_price(_state(), quantity=4) == (60_000, True)


def test_charged_price_is_normal_when_the_early_bird_is_over():
    state = _state(early_bird_ends_at=NOW - timedelta(seconds=1))

    assert decide_unit_price(state, quantity=1) == (100_000, False)


def test_an_order_that_fits_the_remaining_allocation_gets_the_discount():
    state = _state(early_bird_quantity=10, sold=7)  # 3 left

    assert decide_unit_price(state, quantity=3) == (60_000, True)


def test_an_order_that_straddles_the_last_allocated_seat_pays_full_price():
    """3 wanted, 1 discounted seat left. A booking item carries ONE unit price,
    so the order can't be split — and handing out 3 seats the organizer
    allocated 1 of costs them real money on every straddling order."""
    state = _state(early_bird_quantity=10, sold=9)  # 1 left

    assert decide_unit_price(state, quantity=3) == (100_000, False)
    # The tier payload reports that 1 remains, so the frontend can say so
    # rather than letting the buyer discover the boundary at checkout.
    assert state.remaining == 1
