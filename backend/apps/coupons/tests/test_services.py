"""The organizer's half: who may manage a coupon, and what terms are usable.

The tests that carry weight are the CROSS-TENANT ones and the MERGED-ROW ones.
The first are the only real security boundary in this file — every id arrives
from a browser. The second are the same class of bug ticketing's group bands
document: three inputs the rule depends on are independently editable, so
validating a PATCH against what it happens to carry checks nothing.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.coupons.exceptions import (
    CouponCodeTakenError,
    CouponNotFoundError,
    InvalidCouponError,
)
from apps.coupons.models import Coupon, CouponKind
from apps.coupons.services import MAX_COUPONS_PER_ORGANIZATION

pytestmark = pytest.mark.django_db


class TestOwnership:
    def test_a_stranger_cannot_list_another_organizations_coupons(
        self, coupon_service, organization, stranger
    ):
        with pytest.raises(CouponNotFoundError):
            coupon_service.list_coupons(organization_id=organization.id, actor_id=stranger.id)

    def test_a_stranger_cannot_create_one(self, coupon_service, organization, stranger):
        with pytest.raises(CouponNotFoundError):
            coupon_service.create_coupon(
                organization_id=organization.id,
                actor_id=stranger.id,
                code="STEAL",
                kind=CouponKind.PERCENT,
                value=50,
            )

    def test_a_coupon_from_another_organization_is_NOT_FOUND_rather_than_forbidden(
        self, coupon_service, make_coupon, rival_organization, stranger
    ):
        """Answered identically to a uuid that was never real, so the endpoint
        cannot be used to discover which ids exist."""
        mine = make_coupon(code="MINE")

        with pytest.raises(CouponNotFoundError):
            coupon_service.get_coupon(
                organization_id=rival_organization.id,
                actor_id=stranger.id,
                coupon_id=mine.id,
            )

    def test_an_event_from_another_organization_cannot_be_scoped_to(
        self, coupon_service, make_event, rival_organization, organization, owner
    ):
        """THE CROSS-TENANT CHECK. Without it a guessed uuid defines one
        promoter's discount on another promoter's tickets."""
        theirs = make_event(org=rival_organization, title="Their Show")

        with pytest.raises(CouponNotFoundError):
            coupon_service.create_coupon(
                organization_id=organization.id,
                actor_id=owner.id,
                code="CROSS",
                kind=CouponKind.PERCENT,
                value=10,
                event_id=theirs.id,
            )

    def test_an_event_of_their_own_is_accepted(self, coupon_service, event, organization, owner):
        coupon = coupon_service.create_coupon(
            organization_id=organization.id,
            actor_id=owner.id,
            code="MINEONLY",
            kind=CouponKind.PERCENT,
            value=10,
            event_id=event.id,
        )
        assert coupon.event_id == event.id


class TestTheCode:
    def test_it_is_stored_upper_case(self, make_coupon):
        assert make_coupon(code="summer20").code == "SUMMER20"

    def test_surrounding_space_is_stripped(self, make_coupon):
        assert make_coupon(code="  summer20 ").code == "SUMMER20"

    @pytest.mark.parametrize("bad", ["", "AB", "A" * 33])
    def test_a_code_of_the_wrong_length_is_refused(self, make_coupon, bad):
        with pytest.raises(InvalidCouponError):
            make_coupon(code=bad)

    @pytest.mark.parametrize("bad", ["SUMMER 20", "SUMMER!", "SUMMER/20", "SUMMER%20"])
    def test_punctuation_a_person_would_mistype_is_refused(self, make_coupon, bad):
        """A code is retyped off a poster. A space cannot survive a URL, and
        characters that render differently in two fonts are ones somebody will
        get wrong forever."""
        with pytest.raises(InvalidCouponError):
            make_coupon(code=bad)

    def test_the_same_code_twice_in_one_organization_is_refused(self, make_coupon):
        make_coupon(code="SUMMER")
        with pytest.raises(CouponCodeTakenError):
            make_coupon(code="summer")

    def test_two_organizations_may_both_use_one_word(
        self, coupon_service, make_coupon, rival_organization, stranger
    ):
        """A global unique would let whoever registered "SUMMER" first own the
        word for everybody."""
        make_coupon(code="SUMMER")
        theirs = coupon_service.create_coupon(
            organization_id=rival_organization.id,
            actor_id=stranger.id,
            code="SUMMER",
            kind=CouponKind.PERCENT,
            value=10,
        )
        assert theirs.code == "SUMMER"


class TestTerms:
    def test_a_percentage_above_a_hundred_is_refused(self, make_coupon):
        with pytest.raises(InvalidCouponError):
            make_coupon(kind=CouponKind.PERCENT, value=101)

    def test_a_discount_of_nothing_is_refused(self, make_coupon):
        with pytest.raises(InvalidCouponError):
            make_coupon(kind=CouponKind.FIXED, value=0)

    def test_a_cap_on_a_FIXED_amount_is_refused(self, make_coupon):
        """A ceiling on a fixed amount is the fixed amount. Refused rather than
        ignored — a field that is silently discarded is one an organizer sets,
        reads back empty, and sets again."""
        with pytest.raises(InvalidCouponError):
            make_coupon(kind=CouponKind.FIXED, value=10_000, max_discount_minor=5_000)

    def test_a_cap_on_a_percentage_is_accepted(self, make_coupon):
        coupon = make_coupon(kind=CouponKind.PERCENT, value=20, max_discount_minor=5_000)
        assert coupon.max_discount_minor == 5_000

    def test_a_window_that_ends_before_it_starts_is_refused(self, make_coupon):
        now = timezone.now()
        with pytest.raises(InvalidCouponError):
            make_coupon(starts_at=now + timedelta(days=2), ends_at=now + timedelta(days=1))

    def test_a_coupon_created_already_expired_is_refused(self, make_coupon):
        with pytest.raises(InvalidCouponError):
            make_coupon(ends_at=timezone.now() - timedelta(minutes=1))

    def test_zero_redemptions_is_refused(self, make_coupon):
        with pytest.raises(InvalidCouponError):
            make_coupon(max_redemptions=0)

    def test_zero_per_user_is_refused(self, make_coupon):
        with pytest.raises(InvalidCouponError):
            make_coupon(max_per_user=0)

    def test_the_defaults_are_the_common_case(self, make_coupon):
        """One use per person, not advertised, live, unscoped — a private code
        given to a partner, which is what a promo code usually is."""
        coupon = make_coupon()
        assert coupon.max_per_user == 1
        assert coupon.visible_at_checkout is False
        assert coupon.is_active is True
        assert coupon.event_id is None
        assert coupon.max_redemptions is None


class TestUpdatingAgainstTheMergedRow:
    def test_switching_to_FIXED_revalidates_the_STORED_value(
        self, coupon_service, make_coupon, organization, owner
    ):
        """THE TEST THIS CLASS EXISTS FOR — the mirror of ticketing's
        "cutting the face price below a STORED band".

        The coupon is 20 PERCENT with a ₹50 cap. A PATCH carrying only
        `kind: fixed` does not mention either, so validating the submitted
        fields alone would check nothing — and the row would be left as a
        fixed-amount coupon carrying a percentage cap, which is exactly the
        state `validate_terms` refuses on the way in.
        """
        coupon = make_coupon(kind=CouponKind.PERCENT, value=20, max_discount_minor=5_000)

        with pytest.raises(InvalidCouponError):
            coupon_service.update_coupon(
                organization_id=organization.id,
                actor_id=owner.id,
                coupon_id=coupon.id,
                kind=CouponKind.FIXED,
            )

    def test_the_kind_and_the_cap_can_move_together(
        self, coupon_service, make_coupon, organization, owner
    ):
        """Which is precisely why the check has to see the merged row rather
        than either side alone."""
        coupon = make_coupon(kind=CouponKind.PERCENT, value=20, max_discount_minor=5_000)

        updated, _ = coupon_service.update_coupon(
            organization_id=organization.id,
            actor_id=owner.id,
            coupon_id=coupon.id,
            kind=CouponKind.FIXED,
            value=10_000,
            max_discount_minor=None,
        )

        assert updated.kind == CouponKind.FIXED
        assert updated.max_discount_minor is None

    def test_raising_a_percentage_past_a_hundred_is_refused(
        self, coupon_service, make_coupon, organization, owner
    ):
        coupon = make_coupon(kind=CouponKind.PERCENT, value=20)
        with pytest.raises(InvalidCouponError):
            coupon_service.update_coupon(
                organization_id=organization.id,
                actor_id=owner.id,
                coupon_id=coupon.id,
                value=200,
            )

    def test_an_untouched_field_is_not_written_back(
        self, coupon_service, make_coupon, organization, owner
    ):
        """A PATCH is not a replace. `visible_at_checkout` reverting to its
        default on an unrelated edit is the shape of bug a serializer default
        produces."""
        coupon = make_coupon(visible_at_checkout=True, max_per_user=3)

        updated, _ = coupon_service.update_coupon(
            organization_id=organization.id,
            actor_id=owner.id,
            coupon_id=coupon.id,
            value=25,
        )

        assert updated.value == 25
        assert updated.visible_at_checkout is True
        assert updated.max_per_user == 3

    def test_ending_a_running_coupon_early_is_allowed(
        self, coupon_service, make_coupon, organization, owner
    ):
        """The "already expired" rule is a CREATE rule only. Setting an end
        date in the past is how somebody deliberately stops one, and refusing
        it would remove a legitimate action."""
        coupon = make_coupon()
        updated, _ = coupon_service.update_coupon(
            organization_id=organization.id,
            actor_id=owner.id,
            coupon_id=coupon.id,
            ends_at=timezone.now() - timedelta(minutes=1),
        )
        assert updated.ends_at is not None

    def test_an_empty_patch_is_a_no_op_rather_than_an_error(
        self, coupon_service, make_coupon, organization, owner
    ):
        coupon = make_coupon()
        updated, redeemed = coupon_service.update_coupon(
            organization_id=organization.id, actor_id=owner.id, coupon_id=coupon.id
        )
        assert updated.id == coupon.id
        assert redeemed == 0


class TestLimits:
    def test_the_list_is_bounded(
        self, coupon_service, make_coupon, organization, owner, monkeypatch
    ):
        """A cap that no real organizer meets, so an automated write loop
        cannot fill the table. Patched down rather than creating 200 rows —
        the rule is the cap, not the number."""
        monkeypatch.setattr("apps.coupons.services.MAX_COUPONS_PER_ORGANIZATION", 2)
        make_coupon(code="ONE")
        make_coupon(code="TWO")

        from core.errors import InvalidInputError

        with pytest.raises(InvalidInputError):
            make_coupon(code="THREE")

    def test_the_real_cap_is_a_number_no_organizer_reaches(self):
        assert MAX_COUPONS_PER_ORGANIZATION >= 100


class TestDeleting:
    def test_an_unused_coupon_is_deleted(self, coupon_service, make_coupon, organization, owner):
        coupon = make_coupon()
        coupon_service.delete_coupon(
            organization_id=organization.id, actor_id=owner.id, coupon_id=coupon.id
        )
        assert not Coupon.objects.filter(pk=coupon.id).exists()

    def test_a_stranger_cannot_delete_one(
        self, coupon_service, make_coupon, organization, stranger
    ):
        coupon = make_coupon()
        with pytest.raises(CouponNotFoundError):
            coupon_service.delete_coupon(
                organization_id=organization.id, actor_id=stranger.id, coupon_id=coupon.id
            )
        assert Coupon.objects.filter(pk=coupon.id).exists()
