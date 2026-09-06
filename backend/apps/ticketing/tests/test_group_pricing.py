"""Group pricing: the pure rule, and the price that actually gets charged.

This is a money path, so the tests are shaped around the two things that cost
real money if they are wrong:

1. **The buyer is never charged more than they were shown.** A band above the
   face price, a band that a bigger group would pay more under, a malformed
   row from a raw write — every one of them has to resolve DOWNWARD or be
   ignored, never upward.
2. **`unit_price x quantity` stays the line total.** `BookingItem`'s docstring
   states that identity and the receipt PDF plus four frontend surfaces rely on
   it. That is why a band is an absolute PER-UNIT price and not a percentage or
   an order-level discount, and the arithmetic tests here pin it.
"""

from __future__ import annotations

from datetime import datetime
from datetime import timezone as tz

import pytest

# The end-to-end class at the bottom drives a real `create_booking`, so it
# needs booking's fixtures (`booking_service`, `buyer`, `event`, `make_tier`).
# Imported here rather than duplicated: a second copy of that service wiring is
# a second thing to keep in step with `config/di.py`.
from apps.booking.tests.conftest import *  # noqa: F401,F403
from apps.ticketing.pricing import (
    GroupBand,
    Phase,
    band_for_quantity,
    decide_unit_price,
    group_bands_from_rows,
)

NOW = datetime(2026, 6, 1, 12, 0, tzinfo=tz.utc)
FACE = 50_000  # ₹500


def _price(**kwargs):
    """`decide_unit_price` with the boring arguments defaulted."""
    return decide_unit_price(
        price_minor=kwargs.pop("price_minor", FACE),
        phases=kwargs.pop("phases", ()),
        bands=kwargs.pop("bands", ()),
        quantity=kwargs.pop("quantity", 1),
        sold=kwargs.pop("sold", 0),
        reserved=kwargs.pop("reserved", 0),
        now=kwargs.pop("now", NOW),
    )


class TestWhichBandApplies:
    def test_an_order_below_every_band_pays_the_face_price(self):
        bands = (GroupBand(min_quantity=4, price_minor=40_000),)
        assert band_for_quantity(bands, FACE, 3) is None
        assert _price(bands=bands, quantity=3).price_minor == FACE

    def test_the_LARGEST_band_the_order_reaches_wins(self):
        """Not the first. An order of 6 against bands at 2 and 4 gets the 4+
        price — taking the first would quietly withhold the better one the
        organiser advertised."""
        bands = (
            GroupBand(min_quantity=2, price_minor=45_000),
            GroupBand(min_quantity=4, price_minor=40_000),
        )
        winner = band_for_quantity(bands, FACE, 6)
        assert winner is not None
        assert winner.min_quantity == 4
        assert _price(bands=bands, quantity=6).price_minor == 40_000

    def test_the_boundary_is_inclusive(self):
        bands = (GroupBand(min_quantity=4, price_minor=40_000),)
        assert _price(bands=bands, quantity=3).price_minor == FACE
        assert _price(bands=bands, quantity=4).price_minor == 40_000

    def test_bands_are_read_in_size_order_however_they_were_stored(self):
        """The column is JSON — nothing guarantees the array is sorted."""
        bands = (
            GroupBand(min_quantity=6, price_minor=35_000),
            GroupBand(min_quantity=2, price_minor=45_000),
        )
        assert _price(bands=bands, quantity=6).price_minor == 35_000

    def test_the_winning_band_is_RECORDED(self):
        """An invoice has to be able to say why the line cost what it did."""
        bands = (GroupBand(min_quantity=4, price_minor=40_000),)
        priced = _price(bands=bands, quantity=4)
        assert priced.group_min_quantity == 4
        assert priced.phase_name is None


class TestTheNeverOverchargeFloor:
    """The defensive half. `group_bands` is a JSON column, so Postgres cannot
    CHECK a band's price against the tier's own — the service's validation is
    the only writer-side guard, and a guard one writer honours is not defense
    in depth."""

    def test_a_band_priced_above_the_face_price_is_IGNORED(self):
        bands = (GroupBand(min_quantity=2, price_minor=60_000),)
        assert _price(bands=bands, quantity=4).price_minor == FACE

    def test_a_band_at_one_ticket_is_ignored(self):
        """It is the face price wearing a label, and would apply to every
        single-ticket order."""
        bands = (GroupBand(min_quantity=1, price_minor=40_000),)
        assert _price(bands=bands, quantity=1).price_minor == FACE

    def test_an_overpriced_band_does_not_hide_a_valid_larger_one(self):
        bands = (
            GroupBand(min_quantity=2, price_minor=99_000),
            GroupBand(min_quantity=4, price_minor=40_000),
        )
        assert _price(bands=bands, quantity=4).price_minor == 40_000


class TestComposingWithSalePhases:
    """The buyer pays the LOWER of the two. Both are advertised before the
    press, and charging the higher of two visible discounts is overcharging
    relative to what was on screen."""

    def test_a_cheaper_phase_beats_the_band(self):
        phases = (
            Phase(name="Early bird", price_minor=30_000, ends_at=None, quantity=100, position=0),
        )
        bands = (GroupBand(min_quantity=2, price_minor=45_000),)

        priced = _price(phases=phases, bands=bands, quantity=4)

        assert priced.price_minor == 30_000
        # The PHASE priced it, so the phase is what gets recorded.
        assert priced.phase_name == "Early bird"
        assert priced.group_min_quantity is None

    def test_a_cheaper_band_beats_the_phase(self):
        phases = (
            Phase(name="Early bird", price_minor=45_000, ends_at=None, quantity=100, position=0),
        )
        bands = (GroupBand(min_quantity=4, price_minor=35_000),)

        priced = _price(phases=phases, bands=bands, quantity=4)

        assert priced.price_minor == 35_000
        assert priced.group_min_quantity == 4
        # The phase did NOT price this line. Recording it would make the
        # receipt claim a discount the buyer did not receive.
        assert priced.phase_name is None

    def test_nobody_loses_a_discount_by_qualifying_for_a_second_one(self):
        """The property the `min` composition exists for: whichever is
        cheaper, the buyer gets it."""
        phases = (
            Phase(name="Early bird", price_minor=40_000, ends_at=None, quantity=100, position=0),
        )
        bands = (GroupBand(min_quantity=2, price_minor=40_000),)

        # A tie resolves to the phase, which keeps the name on the invoice.
        priced = _price(phases=phases, bands=bands, quantity=2)
        assert priced.price_minor == 40_000
        assert priced.phase_name == "Early bird"

    def test_a_phase_that_cannot_cover_the_order_still_straddles_correctly(self):
        """The phase half is unchanged by bands. A phase whose cumulative
        threshold cannot cover the whole order is skipped, exactly as before —
        and the band is then compared against the FALLEN-THROUGH price."""
        phases = (
            Phase(name="Early bird", price_minor=30_000, ends_at=None, quantity=2, position=0),
        )
        bands = (GroupBand(min_quantity=3, price_minor=45_000),)

        # 3 tickets cannot fit inside a 2-seat threshold, so the phase is out
        # and the band's 45,000 beats the 50,000 face price.
        priced = _price(phases=phases, bands=bands, quantity=3, sold=0, reserved=0)

        assert priced.price_minor == 45_000
        assert priced.group_min_quantity == 3


class TestReadingTheStoredColumn:
    """`group_bands_from_rows` runs inside a row lock on the money path, so a
    malformed row must never raise — it is dropped, and the worst outcome is
    somebody paying the face price they were quoted."""

    def test_a_well_formed_list_is_read(self):
        rows = [{"min_quantity": 4, "price_minor": 40_000}]
        assert group_bands_from_rows(rows) == [GroupBand(min_quantity=4, price_minor=40_000)]

    @pytest.mark.parametrize(
        "rows",
        [
            None,
            "not a list",
            {"min_quantity": 4},
            [None],
            ["nope"],
            [{"min_quantity": 4}],
            [{"price_minor": 100}],
            [{"min_quantity": "4", "price_minor": 100}],
            [{"min_quantity": 4, "price_minor": "100"}],
            [{"min_quantity": -1, "price_minor": 100}],
            [{"min_quantity": 4, "price_minor": -1}],
        ],
    )
    def test_anything_malformed_is_dropped_rather_than_raised_on(self, rows):
        assert group_bands_from_rows(rows) == []

    def test_a_boolean_is_not_an_integer_here(self):
        """`bool` is an `int` subclass, so `{"min_quantity": true}` would
        otherwise read as a band at 1 — which the floor would then apply to
        every single-ticket order."""
        assert group_bands_from_rows([{"min_quantity": True, "price_minor": 100}]) == []

    def test_one_bad_row_does_not_discard_the_good_ones(self):
        rows = [
            {"min_quantity": 4, "price_minor": 40_000},
            "garbage",
            {"min_quantity": 6, "price_minor": 35_000},
        ]
        assert [band.min_quantity for band in group_bands_from_rows(rows)] == [4, 6]


class TestTheLineArithmeticSurvives:
    """`unit_price x quantity` is the line total, and the whole money path
    depends on it. This is what a percentage or an order-level discount would
    have broken."""

    @pytest.mark.parametrize(("quantity", "expected_unit"), [(1, 50_000), (4, 40_000)])
    def test_the_line_total_is_exactly_unit_times_quantity(self, quantity, expected_unit):
        bands = (GroupBand(min_quantity=4, price_minor=40_000),)
        priced = _price(bands=bands, quantity=quantity)

        assert priced.price_minor == expected_unit
        # No remainder, no rounding, no per-order adjustment to reconcile.
        assert priced.price_minor * quantity == expected_unit * quantity

    def test_a_band_price_is_whole_paise_so_nothing_rounds(self):
        """An absolute per-unit price cannot produce a fraction. A percentage
        band would have had to round SOMEWHERE, and the only two places to do
        it (per unit, or per line) disagree by up to `quantity - 1` paise."""
        bands = (GroupBand(min_quantity=3, price_minor=33_333),)
        priced = _price(bands=bands, quantity=3)

        assert priced.price_minor == 33_333
        assert priced.price_minor * 3 == 99_999


# ── THE CHARGE, THROUGH THE REAL LOCK ────────────────────────────────────────


@pytest.mark.django_db
class TestTheChargedPriceEndToEnd:
    """Through `reserve`, under the real per-tier row lock, into a real
    `BookingItem`. The pure tests above prove the rule; these prove it is the
    rule the money path actually uses.
    """

    def test_a_group_order_is_billed_the_band_price(self, booking_service, buyer, event, make_tier):
        tier = make_tier(price_minor=FACE, quantity=50, max_per_order=10)
        _set_bands(tier, [{"min_quantity": 4, "price_minor": 40_000}])

        result = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": tier.id, "quantity": 4}],
        )

        item = result.booking.items.get()
        assert item.unit_price_minor == 40_000
        assert item.group_min_quantity == 4
        assert item.phase_name is None
        # The identity the whole money path relies on.
        subtotal = item.unit_price_minor * item.quantity
        assert subtotal == 160_000
        # total = subtotal + 1% platform fee + donation(0)
        assert result.booking.total_amount_minor == subtotal + 1_600

    def test_an_order_below_the_band_pays_the_face_price(
        self, booking_service, buyer, event, make_tier
    ):
        tier = make_tier(price_minor=FACE, quantity=50, max_per_order=10)
        _set_bands(tier, [{"min_quantity": 4, "price_minor": 40_000}])

        result = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": tier.id, "quantity": 3}],
        )

        item = result.booking.items.get()
        assert item.unit_price_minor == FACE
        assert item.group_min_quantity is None

    def test_the_platform_fee_is_taken_on_the_DISCOUNTED_subtotal(
        self, booking_service, buyer, event, make_tier
    ):
        """The fee is computed inside the reserve transaction from the locked
        prices. A fee on the face value would bill a percentage of money
        nobody paid."""
        tier = make_tier(price_minor=FACE, quantity=50, max_per_order=10)
        _set_bands(tier, [{"min_quantity": 5, "price_minor": 20_000}])

        result = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": tier.id, "quantity": 5}],
        )

        # 5 x 20,000 = 100,000, not 5 x 50,000 = 250,000.
        assert result.booking.platform_fee_minor == 1_000

    def test_a_band_above_the_face_price_never_reaches_the_charge(
        self, booking_service, buyer, event, make_tier
    ):
        """Only a raw write can produce this, and the floor in
        `_eligible_bands` is what keeps it from overcharging."""
        tier = make_tier(price_minor=FACE, quantity=50, max_per_order=10)
        _set_bands(tier, [{"min_quantity": 2, "price_minor": 90_000}])

        result = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": tier.id, "quantity": 4}],
        )

        assert result.booking.items.get().unit_price_minor == FACE


def _set_bands(tier, bands):
    """Straight onto the row, bypassing the service.

    Deliberate: these tests are about what the CHARGE path does with whatever
    is stored, including values the service's validation would refuse. The
    validation has its own tests.
    """
    from apps.ticketing.models import TicketType

    TicketType.objects.filter(pk=tier.id).update(group_bands=bands)
