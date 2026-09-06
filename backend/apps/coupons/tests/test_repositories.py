"""Queries, and the two properties a lock depends on.

The test that carries weight is the DEFERRED-FIELD one. `_LOCK_FIELDS` drives a
`.only()` on the row the redemption locks, and a column the rule reads but the
lock did not fetch is re-SELECTed mid-critical-section — which is exactly what
holding the lock is meant to avoid.
"""

from __future__ import annotations

import pytest
from django.db import transaction

from apps.coupons.models import CouponRedemption
from apps.coupons.repositories import (
    CouponRedemptionRepository,
    CouponRepository,
    normalize_code,
    window_is_open,
)

pytestmark = pytest.mark.django_db


class TestNormalisation:
    @pytest.mark.parametrize(
        ("typed", "stored"),
        [("summer20", "SUMMER20"), (" SUMMER20 ", "SUMMER20"), ("Summer20", "SUMMER20")],
    )
    def test_one_spelling_of_a_code(self, typed, stored):
        assert normalize_code(typed) == stored


class TestTheLockedRow:
    def test_every_field_the_rule_reads_is_already_loaded(self, make_coupon):
        """Asserted by reading each one off a locked row, so the test fails for
        the reason that matters rather than by inspecting a tuple."""
        coupon = make_coupon(code="LOCKED", value=20, max_discount_minor=5_000, max_redemptions=10)

        with transaction.atomic():
            locked = CouponRepository().lock_for_update(coupon.id)
            assert locked is not None
            deferred = locked.get_deferred_fields()
            for column in (
                "event_id",
                "kind",
                "value",
                "max_discount_minor",
                "starts_at",
                "ends_at",
                "max_redemptions",
                "max_per_user",
                "is_active",
            ):
                assert column not in deferred, column

    def test_locking_a_coupon_that_is_gone_answers_None(self):
        import uuid

        with transaction.atomic():
            assert CouponRepository().lock_for_update(uuid.uuid4()) is None


class TestTheWindow:
    def test_no_bounds_is_always_open(self, make_coupon):
        from django.utils import timezone

        started, ended = window_is_open(make_coupon(), now=timezone.now())
        assert started and not ended

    def test_the_end_is_EXCLUSIVE(self, make_coupon, coupon_service, organization, owner):
        """A coupon "until midnight" stops AT midnight. An inclusive bound
        would leave it usable for one more instant than the organizer set, on
        the boundary somebody actually tests."""
        from django.utils import timezone

        coupon = make_coupon()
        moment = timezone.now()
        coupon_service.update_coupon(
            organization_id=organization.id,
            actor_id=owner.id,
            coupon_id=coupon.id,
            ends_at=moment,
        )
        coupon.refresh_from_db()

        _, ended = window_is_open(coupon, now=moment)
        assert ended

    def test_the_start_is_INCLUSIVE(self, make_coupon):
        """The mirror: a coupon that opens at noon is usable at noon, not a
        moment after."""
        from datetime import timedelta

        from django.utils import timezone

        moment = timezone.now() + timedelta(hours=1)
        coupon = make_coupon(starts_at=moment)

        started, _ = window_is_open(coupon, now=moment)
        assert started


class TestUsage:
    def test_counts_are_aggregated_for_a_whole_page_in_one_query(
        self, django_assert_num_queries, make_coupon, make_booking, buyer
    ):
        first = make_coupon(code="ONE")
        second = make_coupon(code="TWO")
        redemptions = CouponRedemptionRepository()
        redemptions.create(
            coupon_id=first.id,
            booking_id=make_booking().id,
            user_id=buyer.id,
            amount_minor=100,
        )

        with django_assert_num_queries(1):
            usage = redemptions.usage_by_coupon([first.id, second.id])

        assert usage == {str(first.id): 1}

    def test_an_empty_page_costs_no_query_at_all(self, django_assert_num_queries):
        with django_assert_num_queries(0):
            assert CouponRedemptionRepository().usage_by_coupon([]) == {}

    def test_deleting_a_redemption_is_scoped_to_one_booking(self, make_coupon, make_booking, buyer):
        coupon = make_coupon()
        redemptions = CouponRedemptionRepository()
        kept, dropped = make_booking(), make_booking()
        for booking in (kept, dropped):
            redemptions.create(
                coupon_id=coupon.id,
                booking_id=booking.id,
                user_id=buyer.id,
                amount_minor=100,
            )

        assert redemptions.delete_for_booking(dropped.id) == 1
        assert CouponRedemption.objects.filter(booking_id=kept.id).exists()
