"""The sale-phase rule, tested as a pure function — no DB, no clock.

Its failure cases are boundaries: a deadline instant, the last seat of a
cumulative threshold, and an order that straddles that seat. None of them
are visible by looking at a tier that renders correctly, which is why the
rule lives in `pricing.py` rather than inline in the strategy.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from apps.ticketing.pricing import Phase, decide_unit_price, evaluate_phases

NOW = datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc)

FACE = 100_000  # a tier priced at ₹1,000


def _phase(
    *,
    name: str = "Early bird",
    price_minor: int = 60_000,
    ends_at: datetime | None = None,
    quantity: int | None = None,
    position: int = 0,
) -> Phase:
    return Phase(
        name=name, price_minor=price_minor, ends_at=ends_at, quantity=quantity, position=position
    )


def _evaluate(phases: list[Phase], *, sold: int = 0, reserved: int = 0, now: datetime = NOW):
    return evaluate_phases(price_minor=FACE, phases=phases, sold=sold, reserved=reserved, now=now)


def _decide(
    phases: list[Phase], *, quantity: int, sold: int = 0, reserved: int = 0, now: datetime = NOW
):
    return decide_unit_price(
        price_minor=FACE, phases=phases, quantity=quantity, sold=sold, reserved=reserved, now=now
    )


# --- which phase is active ---------------------------------------------------


def test_no_phases_is_just_the_face_price():
    state = _evaluate([])

    assert state.phase_name is None
    assert state.effective_price_minor == FACE
    assert state.remaining is None
    assert state.ends_at is None
    assert state.next_price_minor is None  # nothing comes after the face price


def test_a_time_bound_phase_is_active_before_its_deadline_and_over_after_it():
    live = _evaluate([_phase(ends_at=NOW + timedelta(hours=1))])
    assert live.phase_name == "Early bird"
    assert live.effective_price_minor == 60_000
    # No seat threshold → no number to report. The platform does not invent one.
    assert live.remaining is None
    assert live.next_price_minor == FACE

    over = _evaluate([_phase(ends_at=NOW - timedelta(seconds=1))])
    assert over.phase_name is None
    assert over.effective_price_minor == FACE


def test_the_deadline_instant_itself_is_over():
    # `ends_at` is exclusive: at exactly the deadline the phase has ended.
    state = _evaluate([_phase(ends_at=NOW)])

    assert state.phase_name is None


def test_the_threshold_counts_sold_and_reserved_together():
    # A held (unpaid) seat crosses the threshold exactly like a sold one —
    # otherwise a rush of holds would hand out the phase price twice over.
    state = _evaluate([_phase(quantity=10)], sold=4, reserved=6)

    assert state.phase_name is None
    assert state.effective_price_minor == FACE


def test_remaining_counts_down_to_the_last_seat_inside_the_threshold():
    state = _evaluate([_phase(quantity=10)], sold=3, reserved=6)

    assert state.phase_name == "Early bird"
    assert state.remaining == 1


def test_remaining_never_reads_negative():
    # An organizer can cut a threshold below what's already committed.
    state = _evaluate(
        [_phase(quantity=5), _phase(name="Phase 2", price_minor=80_000, quantity=20, position=1)],
        sold=9,
    )

    assert state.phase_name == "Phase 2"
    assert state.remaining == 11


def test_an_exhausted_first_phase_hands_over_to_the_next():
    phases = [
        _phase(quantity=5),
        _phase(name="Phase 2", price_minor=80_000, ends_at=NOW + timedelta(days=2), position=1),
    ]

    state = _evaluate(phases, sold=5)

    assert state.phase_name == "Phase 2"
    assert state.effective_price_minor == 80_000
    assert state.ends_at == NOW + timedelta(days=2)
    assert state.next_price_minor == FACE


def test_a_timed_out_first_phase_hands_over_to_the_next():
    phases = [
        _phase(ends_at=NOW - timedelta(minutes=1)),
        _phase(name="Phase 2", price_minor=80_000, quantity=50, position=1),
    ]

    state = _evaluate(phases)

    assert state.phase_name == "Phase 2"
    assert state.effective_price_minor == 80_000


def test_phases_are_ordered_by_position_not_list_order():
    phases = [
        _phase(name="Phase 2", price_minor=80_000, quantity=50, position=1),
        _phase(quantity=10, position=0),
    ]

    state = _evaluate(phases)

    assert state.phase_name == "Early bird"
    assert state.effective_price_minor == 60_000


# --- next_price --------------------------------------------------------------


def test_next_price_is_the_following_phase_price():
    phases = [
        _phase(quantity=10),
        _phase(name="Phase 2", price_minor=80_000, quantity=50, position=1),
    ]

    assert _evaluate(phases).next_price_minor == 80_000


def test_next_price_falls_back_to_face_after_the_last_phase():
    assert _evaluate([_phase(quantity=10)]).next_price_minor == FACE


def test_next_price_skips_a_phase_that_can_no_longer_apply():
    """The hint must name the price that will ACTUALLY apply next — a later
    phase whose own deadline already passed is a price nobody can ever pay,
    and pointing a "price goes up to X" at it would be a confident lie."""
    phases = [
        _phase(quantity=10),
        _phase(name="Phase 2", price_minor=80_000, ends_at=NOW - timedelta(minutes=1), position=1),
    ]

    assert _evaluate(phases).next_price_minor == FACE


# --- the charged unit price --------------------------------------------------


def test_charged_price_matches_an_active_unbounded_by_seats_phase():
    assert _decide([_phase(ends_at=NOW + timedelta(days=1))], quantity=4) == (
        60_000,
        "Early bird",
    )


def test_charged_price_is_face_when_no_phase_is_live():
    assert _decide([_phase(ends_at=NOW - timedelta(seconds=1))], quantity=1) == (FACE, None)


def test_an_order_that_fits_the_threshold_gets_the_phase_price():
    state = _decide([_phase(quantity=10)], quantity=3, sold=7)  # 3 left

    assert state == (60_000, "Early bird")


def test_a_straddling_order_falls_to_the_next_phase_price_for_the_whole_order():
    """3 wanted, 1 phase seat left. A booking item carries ONE unit price, so
    the order can't be split — the whole order bills at the NEXT phase's
    price, never a mix."""
    phases = [
        _phase(quantity=10),
        _phase(name="Phase 2", price_minor=80_000, quantity=50, position=1),
    ]

    assert _decide(phases, quantity=3, sold=9) == (80_000, "Phase 2")
    # The display half reports that 1 remains, so the frontend can say so
    # rather than letting the buyer discover the boundary at checkout.
    assert _evaluate(phases, sold=9).remaining == 1


def test_a_straddling_order_falls_to_face_when_no_later_phase_can_cover_it():
    assert _decide([_phase(quantity=10)], quantity=3, sold=9) == (FACE, None)


def test_a_straddling_order_skips_phases_until_one_covers_it_whole():
    # 4 wanted; phase 1 has 1 seat left, phase 2's cumulative 12 can't cover
    # 9+4 either — the order lands on phase 3.
    phases = [
        _phase(quantity=10),
        _phase(name="Phase 2", price_minor=70_000, quantity=12, position=1),
        _phase(name="Phase 3", price_minor=80_000, quantity=50, position=2),
    ]

    assert _decide(phases, quantity=4, sold=9) == (80_000, "Phase 3")


def test_the_order_taking_the_last_threshold_seats_still_gets_the_phase_price():
    """The threshold counts seats already committed, not the ones being
    taken — an order landing exactly on the boundary is inside it."""
    assert _decide([_phase(quantity=10)], quantity=3, sold=7) == (60_000, "Early bird")


def test_a_phase_priced_above_the_face_price_is_ignored_not_billed():
    """The rule that replaced a database CHECK.

    `early_bird_price_minor <= price_minor` used to be a same-row constraint
    the database enforced. A child table cannot carry a cross-table CHECK, so
    the pure rule refuses the row instead: a schedule may only ever make a
    buyer pay less than the advertised price.
    """
    assert _decide([_phase(price_minor=FACE + 10_000, quantity=10)], quantity=1, sold=0) == (
        FACE,
        None,
    )

    state = _evaluate([_phase(price_minor=FACE + 10_000, quantity=10)], sold=0)
    assert state.effective_price_minor == FACE
    assert state.phase_name is None


def test_an_overpriced_phase_is_skipped_while_a_valid_later_one_still_applies():
    phases = [
        _phase(price_minor=FACE + 1, quantity=10),
        _phase(name="Phase 2", price_minor=70_000, quantity=50, position=1),
    ]

    assert _decide(phases, quantity=1, sold=0) == (70_000, "Phase 2")
    assert _evaluate(phases, sold=0).phase_name == "Phase 2"


def test_an_overpriced_phase_is_never_advertised_as_the_next_price():
    """A 'prices rise to X' hint must not quote a row that can never be
    charged — the same confident-lie problem `next_price_minor` already
    avoids for dead phases."""
    phases = [
        _phase(quantity=10),
        _phase(name="Phase 2", price_minor=FACE + 5_000, quantity=50, position=1),
    ]

    assert _evaluate(phases, sold=0).next_price_minor == FACE
