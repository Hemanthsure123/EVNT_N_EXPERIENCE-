"""The pure discount rule.

No database and no Django. Every case here is arithmetic that reaches a charged
amount, so it is stated as a table of examples rather than as a property — the
failures that matter (a negative total, a discount above its own stated rate)
are all at boundaries, and a boundary is where a generated example is least
likely to land.
"""

from __future__ import annotations

import pytest

from apps.coupons.discounts import MAX_PERCENT, CouponTerms, discount_on

FACE = 50_000  # ₹500


def percent(value: int, *, cap: int | None = None) -> CouponTerms:
    return CouponTerms(kind="percent", value=value, max_discount_minor=cap)


def fixed(value: int) -> CouponTerms:
    return CouponTerms(kind="fixed", value=value, max_discount_minor=None)


class TestPercentages:
    def test_takes_the_stated_share(self):
        assert discount_on(percent(20), subtotal_minor=FACE) == 10_000

    def test_a_hundred_percent_is_the_whole_order(self):
        assert discount_on(percent(100), subtotal_minor=FACE) == FACE

    def test_a_fraction_of_a_paise_rounds_DOWN(self):
        # 15% of 333 paise is 49.95. Rounding up would spend a paise of the
        # organizer's money the advertised rate does not cover, and make a
        # coupon worth momentarily more than it says.
        assert discount_on(percent(15), subtotal_minor=333) == 49

    def test_a_percentage_above_a_hundred_cannot_exceed_the_order(self):
        # `validate_terms` refuses this on the way in; the rule refuses it
        # again here, because a raw write is the one path that skips the first.
        assert discount_on(percent(150), subtotal_minor=FACE) == FACE
        assert discount_on(percent(MAX_PERCENT + 1), subtotal_minor=FACE) == FACE


class TestTheCap:
    def test_a_cap_bounds_a_percentage(self):
        # "20% off, up to ₹50" on a ₹500 order is ₹50, not ₹100. Without it,
        # a rate meant for a ₹200 ticket costs the organizer ₹4,000 on a table
        # booking.
        assert discount_on(percent(20, cap=5_000), subtotal_minor=FACE) == 5_000

    def test_a_cap_above_the_discount_changes_nothing(self):
        assert discount_on(percent(20, cap=100_000), subtotal_minor=FACE) == 10_000

    def test_no_cap_means_no_cap(self):
        assert discount_on(percent(20, cap=None), subtotal_minor=FACE) == 10_000


class TestFixedAmounts:
    def test_takes_the_stated_amount(self):
        assert discount_on(fixed(10_000), subtotal_minor=FACE) == 10_000

    def test_NEVER_EXCEEDS_THE_SUBTOTAL(self):
        """THE TEST THIS MODULE EXISTS FOR.

        A ₹500 code on a ₹300 order takes ₹300 off. Uncapped it would take
        ₹500 off and produce a NEGATIVE total — an amount that would be handed
        to a payment provider as a charge.
        """
        assert discount_on(fixed(FACE), subtotal_minor=30_000) == 30_000
        assert discount_on(fixed(999_999), subtotal_minor=1) == 1

    def test_the_result_is_never_negative(self):
        assert discount_on(fixed(10_000), subtotal_minor=0) == 0
        assert discount_on(percent(20), subtotal_minor=0) == 0


class TestDegenerateInputs:
    """Only a raw write reaches these; the rule still has to answer."""

    @pytest.mark.parametrize("subtotal", [0, -1, -50_000])
    def test_a_non_positive_subtotal_is_worth_nothing(self, subtotal):
        assert discount_on(percent(50), subtotal_minor=subtotal) == 0
        assert discount_on(fixed(1_000), subtotal_minor=subtotal) == 0

    def test_a_negative_value_is_worth_nothing_rather_than_an_ADDITION(self):
        # A negative fixed amount would otherwise return a negative discount,
        # which the caller SUBTRACTS — quietly turning a coupon into a
        # surcharge.
        assert discount_on(fixed(-5_000), subtotal_minor=FACE) == 0
        assert discount_on(percent(-20), subtotal_minor=FACE) == 0

    def test_a_negative_cap_disables_the_discount_rather_than_inverting_it(self):
        assert discount_on(percent(20, cap=-100), subtotal_minor=FACE) == 0

    def test_an_unknown_kind_is_read_as_a_fixed_amount(self):
        # `kind` is a database column with a CHECK-free `choices`, so a raw
        # write can store anything. Reading an unknown kind as "fixed paise"
        # keeps the result bounded by the subtotal; reading it as a percentage
        # would multiply.
        assert discount_on(CouponTerms(kind="???", value=200), subtotal_minor=FACE) == 200
