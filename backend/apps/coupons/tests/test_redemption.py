"""The checkout's half: what a code is refused for, and what it is worth.

Every refusal here is a sentence somebody reads under a field, so each one is
asserted by its EXCEPTION TYPE rather than by "it raised something" — a test
that accepts any refusal would pass while the checkout told an expired code it
had been fully claimed.

The concurrency proof lives in `test_concurrency.py`, for the same reason
ticketing's does: it is the most important test in the module and it needs a
real transaction rather than the outer one pytest rolls back.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.db import transaction
from django.utils import timezone

from apps.coupons.exceptions import (
    CouponAlreadyAppliedError,
    CouponAlreadyUsedError,
    CouponExhaustedError,
    CouponExpiredError,
    CouponLeavesNothingToChargeError,
    CouponNotStartedError,
    CouponUnknownError,
    CouponWrongEventError,
)
from apps.coupons.models import CouponKind, CouponRedemption

from .conftest import FACE

pytestmark = pytest.mark.django_db


def redeem(service, *, event, booking, user, code, subtotal_minor=FACE, donation_minor=0):
    """Redeem the way the booking service will: inside one transaction.

    Written as a helper rather than repeated, because `redeem` takes a row lock
    and calling it outside a transaction would silently be a different code
    path from the one production runs.
    """
    with transaction.atomic():
        return service.redeem(
            event_id=event.id,
            user_id=user.id,
            booking_id=booking.id,
            code=code,
            subtotal_minor=subtotal_minor,
            donation_minor=donation_minor,
        )


class TestWhatItIsWorth:
    def test_a_percentage_comes_off_the_subtotal(
        self, redemption_service, make_coupon, event, buyer, make_booking
    ):
        make_coupon(code="SAVE20", kind=CouponKind.PERCENT, value=20)
        booking = make_booking()

        result = redeem(redemption_service, event=event, booking=booking, user=buyer, code="SAVE20")

        assert result.discount_minor == 10_000
        assert result.code == "SAVE20"

    def test_the_code_is_matched_case_insensitively(
        self, redemption_service, make_coupon, event, buyer, make_booking
    ):
        """People retype codes off posters. A case-sensitive comparison turns
        a correct code into a wrong one."""
        make_coupon(code="SAVE20")
        booking = make_booking()

        result = redeem(
            redemption_service, event=event, booking=booking, user=buyer, code=" save20 "
        )
        assert result.discount_minor > 0

    def test_the_AMOUNT_IS_RECORDED_not_recomputed(
        self,
        redemption_service,
        make_coupon,
        coupon_service,
        organization,
        owner,
        event,
        buyer,
        make_booking,
    ):
        """THE REASON `CouponRedemption.amount_minor` EXISTS.

        The organizer edits the coupon afterwards. A receipt that recomputed
        the discount from today's terms would tell somebody they paid a price
        they did not pay.
        """
        coupon = make_coupon(code="SAVE20", kind=CouponKind.PERCENT, value=20)
        booking = make_booking()
        redeem(redemption_service, event=event, booking=booking, user=buyer, code="SAVE20")

        coupon_service.update_coupon(
            organization_id=organization.id,
            actor_id=owner.id,
            coupon_id=coupon.id,
            value=5,
        )

        row = CouponRedemption.objects.get(booking_id=booking.id)
        assert row.amount_minor == 10_000


class TestRefusals:
    def test_an_unknown_code(self, redemption_service, event, buyer, make_booking):
        with pytest.raises(CouponUnknownError):
            redeem(
                redemption_service,
                event=event,
                booking=make_booking(),
                user=buyer,
                code="NOPE",
            )

    def test_a_SWITCHED_OFF_code_is_indistinguishable_from_an_unknown_one(
        self,
        redemption_service,
        make_coupon,
        coupon_service,
        organization,
        owner,
        event,
        buyer,
        make_booking,
    ):
        """Deliberate. A deactivated code is one somebody decided should stop
        working, and confirming it is real tells a code-guesser they found a
        live prefix."""
        coupon = make_coupon(code="SAVE20")
        coupon_service.update_coupon(
            organization_id=organization.id,
            actor_id=owner.id,
            coupon_id=coupon.id,
            is_active=False,
        )

        with pytest.raises(CouponUnknownError):
            redeem(
                redemption_service,
                event=event,
                booking=make_booking(),
                user=buyer,
                code="SAVE20",
            )

    def test_a_code_scoped_to_another_event(
        self,
        redemption_service,
        make_coupon,
        make_event,
        organization,
        event,
        buyer,
        make_booking,
    ):
        """Its OWN reason, not "invalid". The customer holds a code that
        genuinely works — telling them it is for another event is the
        difference between using it and giving up on it."""
        other = make_event(org=organization, title="Rock Night")
        make_coupon(code="ROCKONLY", event_id=other.id)

        with pytest.raises(CouponWrongEventError):
            redeem(
                redemption_service,
                event=event,
                booking=make_booking(),
                user=buyer,
                code="ROCKONLY",
            )

    def test_an_org_wide_code_works_on_any_of_their_events(
        self, redemption_service, make_coupon, make_event, organization, buyer, make_booking
    ):
        """Which is the whole reason `event` is nullable: a promoter running a
        season wants one code across it."""
        make_coupon(code="SEASON")
        second = make_event(org=organization, title="Rock Night")

        result = redeem(
            redemption_service,
            event=second,
            booking=make_booking(evt=second),
            user=buyer,
            code="SEASON",
        )
        assert result.discount_minor > 0

    def test_a_code_from_ANOTHER_ORGANIZATION_is_unknown_here(
        self,
        redemption_service,
        coupon_service,
        rival_organization,
        stranger,
        event,
        buyer,
        make_booking,
    ):
        """The EVENT decides the organization, so there is no request shape
        that aims one organizer's code at another's tickets."""
        coupon_service.create_coupon(
            organization_id=rival_organization.id,
            actor_id=stranger.id,
            code="THEIRS",
            kind=CouponKind.PERCENT,
            value=50,
        )

        with pytest.raises(CouponUnknownError):
            redeem(
                redemption_service,
                event=event,
                booking=make_booking(),
                user=buyer,
                code="THEIRS",
            )

    def test_before_its_window_opens(
        self, redemption_service, make_coupon, event, buyer, make_booking
    ):
        make_coupon(code="LATER", starts_at=timezone.now() + timedelta(days=1))
        with pytest.raises(CouponNotStartedError):
            redeem(
                redemption_service,
                event=event,
                booking=make_booking(),
                user=buyer,
                code="LATER",
            )

    def test_after_its_window_closes(
        self,
        redemption_service,
        make_coupon,
        coupon_service,
        organization,
        owner,
        event,
        buyer,
        make_booking,
    ):
        coupon = make_coupon(code="OVER")
        # Ended through the service, which is the only way an organizer can
        # produce this state — creating one already expired is refused.
        coupon_service.update_coupon(
            organization_id=organization.id,
            actor_id=owner.id,
            coupon_id=coupon.id,
            ends_at=timezone.now() - timedelta(seconds=1),
        )

        with pytest.raises(CouponExpiredError):
            redeem(
                redemption_service,
                event=event,
                booking=make_booking(),
                user=buyer,
                code="OVER",
            )

    def test_once_every_redemption_is_taken(
        self, redemption_service, make_coupon, event, buyer, stranger, make_booking
    ):
        make_coupon(code="FIRSTONE", max_redemptions=1)
        redeem(
            redemption_service,
            event=event,
            booking=make_booking(),
            user=buyer,
            code="FIRSTONE",
        )

        with pytest.raises(CouponExhaustedError):
            redeem(
                redemption_service,
                event=event,
                booking=make_booking(user=stranger),
                user=stranger,
                code="FIRSTONE",
            )

    def test_once_THIS_PERSON_has_used_it(
        self, redemption_service, make_coupon, event, buyer, make_booking
    ):
        make_coupon(code="ONCEEACH")
        redeem(
            redemption_service,
            event=event,
            booking=make_booking(),
            user=buyer,
            code="ONCEEACH",
        )

        with pytest.raises(CouponAlreadyUsedError):
            redeem(
                redemption_service,
                event=event,
                booking=make_booking(),
                user=buyer,
                code="ONCEEACH",
            )

    def test_a_higher_per_user_limit_allows_a_second_use(
        self, redemption_service, make_coupon, event, buyer, make_booking
    ):
        make_coupon(code="TWICE", max_per_user=2)
        redeem(redemption_service, event=event, booking=make_booking(), user=buyer, code="TWICE")
        result = redeem(
            redemption_service, event=event, booking=make_booking(), user=buyer, code="TWICE"
        )
        assert result.discount_minor > 0

    def test_a_second_code_on_ONE_booking_is_refused(
        self, redemption_service, make_coupon, event, buyer, make_booking
    ):
        """`CouponRedemption.booking` is a OneToOne, so stacking is refused by
        the DATABASE rather than by a check — a product rule made structural."""
        make_coupon(code="ONE", max_per_user=5)
        make_coupon(code="TWO", max_per_user=5)
        booking = make_booking()
        redeem(redemption_service, event=event, booking=booking, user=buyer, code="ONE")

        with pytest.raises(CouponAlreadyAppliedError):
            redeem(redemption_service, event=event, booking=booking, user=buyer, code="TWO")

    def test_a_draft_event_answers_as_an_unknown_code(
        self, redemption_service, make_coupon, make_event, organization, buyer, make_booking
    ):
        """Somebody who cannot book this event has no coupon problem to
        solve."""
        from apps.events.models import EventStatus

        make_coupon(code="SEASON")
        draft = make_event(org=organization, title="Unlisted", status=EventStatus.DRAFT)

        with pytest.raises(CouponUnknownError):
            redeem(
                redemption_service,
                event=draft,
                booking=make_booking(evt=draft),
                user=buyer,
                code="SEASON",
            )


class TestTheChargeableFloor:
    def test_a_code_that_covers_the_WHOLE_order_is_refused(
        self, redemption_service, make_coupon, event, buyer, make_booking
    ):
        """A booking whose total lands under the provider's floor can be held
        and never paid for — a checkout whose Pay button can only fail. Said
        while it is still somebody's choice."""
        make_coupon(code="ALLOFIT", kind=CouponKind.PERCENT, value=100)

        with pytest.raises(CouponLeavesNothingToChargeError):
            redeem(
                redemption_service,
                event=event,
                booking=make_booking(),
                user=buyer,
                code="ALLOFIT",
            )

    def test_a_fixed_code_larger_than_the_order_is_refused(
        self, redemption_service, make_coupon, event, buyer, make_booking
    ):
        make_coupon(code="BIGONE", kind=CouponKind.FIXED, value=100_000)

        with pytest.raises(CouponLeavesNothingToChargeError):
            redeem(
                redemption_service,
                event=event,
                booking=make_booking(),
                user=buyer,
                code="BIGONE",
                subtotal_minor=30_000,
            )

    def test_a_DONATION_can_keep_the_booking_payable(
        self, redemption_service, make_coupon, event, buyer, make_booking
    ):
        """The floor is on what will actually be CHARGED, and a donation is
        charged. Testing the subtotal alone would refuse a booking the provider
        would have taken."""
        make_coupon(code="ALLOFIT", kind=CouponKind.PERCENT, value=100)

        result = redeem(
            redemption_service,
            event=event,
            booking=make_booking(donation_minor=5_000),
            user=buyer,
            code="ALLOFIT",
            donation_minor=5_000,
        )
        assert result.discount_minor == FACE

    def test_nothing_is_written_when_the_floor_refuses(
        self, redemption_service, make_coupon, event, buyer, make_booking
    ):
        """A refusal must not consume a redemption — otherwise trying a code
        that cannot be used is how a code with fifty uses runs out."""
        coupon = make_coupon(code="ALLOFIT", kind=CouponKind.PERCENT, value=100)

        with pytest.raises(CouponLeavesNothingToChargeError):
            redeem(
                redemption_service,
                event=event,
                booking=make_booking(),
                user=buyer,
                code="ALLOFIT",
            )

        assert CouponRedemption.objects.filter(coupon_id=coupon.id).count() == 0


class TestReleasing:
    def test_releasing_frees_the_redemption(
        self, redemption_service, make_coupon, event, buyer, stranger, make_booking
    ):
        """Without it, a code with fifty uses is exhausted by fifty people who
        abandoned their checkout — the coupon-shaped version of leaking held
        inventory."""
        make_coupon(code="ONLYONE", max_redemptions=1)
        abandoned = make_booking()
        redeem(redemption_service, event=event, booking=abandoned, user=buyer, code="ONLYONE")

        redemption_service.release_for_booking(booking_id=abandoned.id)

        result = redeem(
            redemption_service,
            event=event,
            booking=make_booking(user=stranger),
            user=stranger,
            code="ONLYONE",
        )
        assert result.discount_minor > 0

    def test_releasing_twice_is_a_no_op(
        self, redemption_service, make_coupon, event, buyer, make_booking
    ):
        """The cancel path and the sweeper can both reach a booking, so this
        has to be idempotent for the same reason `ticketing.release` is."""
        make_coupon(code="SAVE20")
        booking = make_booking()
        redeem(redemption_service, event=event, booking=booking, user=buyer, code="SAVE20")

        assert redemption_service.release_for_booking(booking_id=booking.id) == 1
        assert redemption_service.release_for_booking(booking_id=booking.id) == 0

    def test_releasing_a_booking_that_never_had_one_is_a_no_op(
        self, redemption_service, make_booking
    ):
        assert redemption_service.release_for_booking(booking_id=make_booking().id) == 0

    def test_a_released_booking_may_take_a_different_code(
        self, redemption_service, make_coupon, event, buyer, make_booking
    ):
        """Which is how "remove this code and try another" works, and why the
        OneToOne is not a dead end."""
        make_coupon(code="ONE")
        make_coupon(code="TWO")
        booking = make_booking()

        redeem(redemption_service, event=event, booking=booking, user=buyer, code="ONE")
        redemption_service.release_for_booking(booking_id=booking.id)
        result = redeem(redemption_service, event=event, booking=booking, user=buyer, code="TWO")

        assert result.code == "TWO"
