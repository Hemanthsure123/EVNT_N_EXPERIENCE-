"""A promotional code on a live hold — the arithmetic, and giving it back.

Two properties carry all the weight here:

1. **The total adds up to the lines above it.** `sum(items) - discount + fee +
   donation == total_amount_minor`, and `total_amount_minor` is the number the
   payment order is created for AND the number payments' webhook checks. An
   invoice that does not add up to the amount charged is not a display bug.
2. **The fee follows the discount.** The organizer funds the discount, so the
   platform's percentage is taken on the DISCOUNTED subtotal — a fee on face
   value bills a percentage of money nobody paid.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.booking.models import Booking, BookingStatus
from apps.coupons.exceptions import (
    CouponExhaustedError,
    CouponLeavesNothingToChargeError,
    CouponUnknownError,
)
from apps.coupons.models import CouponKind
from apps.coupons.repositories import CouponRedemptionRepository, CouponRepository
from apps.coupons.services import CouponRedemptionService, CouponService
from apps.events.repositories import EventRepository
from apps.organizations.repositories import OrganizationRepository

pytestmark = pytest.mark.django_db


@pytest.fixture
def coupons(organizer, event):
    """The organizer's own coupon factory, built on real repositories."""
    service = CouponService(
        organizations=OrganizationRepository(),
        coupons=CouponRepository(),
        redemptions=CouponRedemptionRepository(),
        events=EventRepository(),
    )

    def _make(*, code="SAVE20", kind=CouponKind.PERCENT, value=20, **kwargs):
        return service.create_coupon(
            organization_id=event.organization_id,
            actor_id=organizer.id,
            code=code,
            kind=kind,
            value=value,
            **kwargs,
        )

    return _make


@pytest.fixture
def redemptions():
    return CouponRedemptionService(
        coupons=CouponRepository(),
        redemptions=CouponRedemptionRepository(),
        events=EventRepository(),
    )


def subtotal_of(booking: Booking) -> int:
    from apps.booking.models import BookingItem

    return sum(
        item.unit_price_minor * item.quantity
        for item in BookingItem.objects.filter(booking_id=booking.id)
    )


def assert_the_total_adds_up(booking: Booking) -> None:
    """The invariant, stated once and asserted after every money move."""
    booking.refresh_from_db()
    assert booking.total_amount_minor == (
        subtotal_of(booking)
        - booking.discount_amount_minor
        + booking.platform_fee_minor
        + booking.donation_amount_minor
    )


class TestApplying:
    def test_a_percentage_comes_off_and_the_total_adds_up(
        self, booking_service, buyer, event, make_tier, coupons
    ):
        coupons(code="SAVE20", value=20)
        tier = make_tier(price_minor=50_000, quantity=10)
        created = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 2}],
        )

        booking = booking_service.set_coupon(
            booking_id=created.booking.id, actor_id=buyer.id, code="SAVE20"
        )

        assert booking.discount_amount_minor == 20_000  # 20% of ₹1,000
        assert_the_total_adds_up(booking)

    def test_THE_FEE_IS_TAKEN_ON_THE_DISCOUNTED_SUBTOTAL(
        self, booking_service, buyer, event, make_tier, coupons
    ):
        """THE TEST THIS FILE EXISTS FOR.

        The organizer funds the discount, so the platform's 1% is charged on
        what the customer actually pays for tickets. Left on the face value it
        would bill a percentage of money nobody paid — and the organizer, whose
        share is `total - fee - donation`, would fund that too.
        """
        coupons(code="HALF", value=50)
        tier = make_tier(price_minor=100_000, quantity=10)
        created = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
        )
        assert created.booking.platform_fee_minor == 1_000  # 1% of ₹1,000

        booking = booking_service.set_coupon(
            booking_id=created.booking.id, actor_id=buyer.id, code="HALF"
        )

        assert booking.platform_fee_minor == 500  # 1% of the ₹500 now payable
        assert booking.total_amount_minor == 50_500

    def test_the_ORGANIZERS_SHARE_is_the_discounted_ticket_revenue(
        self, booking_service, buyer, event, make_tier, coupons
    ):
        """`_build_transfers` is `total - fee - donation`, so it follows the
        discount with no change of its own. Asserted rather than assumed,
        because it is the line that decides what an organizer is paid."""
        coupons(code="HALF", value=50)
        tier = make_tier(price_minor=100_000, quantity=10)
        created = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
        )
        booking = booking_service.set_coupon(
            booking_id=created.booking.id, actor_id=buyer.id, code="HALF"
        )

        organizer_share = (
            booking.total_amount_minor - booking.platform_fee_minor - booking.donation_amount_minor
        )
        assert organizer_share == 50_000

    def test_the_payment_order_is_RE_ISSUED_for_the_new_amount(
        self, booking_service, buyer, event, make_tier, coupons
    ):
        """A stale order guarantees the webhook's amount check refuses a
        payment that was in every other sense fine, and auto-refunds it."""
        coupons(code="SAVE20", value=20)
        tier = make_tier(price_minor=50_000, quantity=10)
        created = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
        )
        original_order = created.booking.payment_order_id
        assert original_order

        booking = booking_service.set_coupon(
            booking_id=created.booking.id, actor_id=buyer.id, code="SAVE20"
        )

        assert booking.payment_order_id
        assert booking.payment_order_id != original_order

    def test_a_donation_survives_the_discount(
        self, booking_service, buyer, event, make_tier, coupons
    ):
        """They move independently: one is added and retained by the platform,
        the other subtracted and funded by the organizer."""
        coupons(code="SAVE20", value=20)
        tier = make_tier(price_minor=50_000, quantity=10)
        created = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
            donation_minor=1_500,
        )

        booking = booking_service.set_coupon(
            booking_id=created.booking.id, actor_id=buyer.id, code="SAVE20"
        )

        assert booking.donation_amount_minor == 1_500
        assert_the_total_adds_up(booking)

    def test_setting_a_donation_AFTERWARDS_keeps_the_discount(
        self, booking_service, buyer, event, make_tier, coupons
    ):
        """`set_donation` recovers the ticket half by arithmetic on the row, so
        a discount already applied has to survive it — otherwise choosing to
        give ₹15 would quietly cancel somebody's coupon."""
        coupons(code="SAVE20", value=20)
        tier = make_tier(price_minor=50_000, quantity=10)
        created = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
        )
        booking_service.set_coupon(booking_id=created.booking.id, actor_id=buyer.id, code="SAVE20")

        booking = booking_service.set_donation(
            booking_id=created.booking.id, actor_id=buyer.id, donation_minor=1_500
        )

        assert booking.discount_amount_minor == 10_000
        assert_the_total_adds_up(booking)


class TestReplacingAndRemoving:
    def test_a_second_code_REPLACES_the_first(
        self, booking_service, buyer, event, make_tier, coupons
    ):
        coupons(code="SMALL", value=10)
        coupons(code="BIG", value=30)
        tier = make_tier(price_minor=50_000, quantity=10)
        created = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
        )

        booking_service.set_coupon(booking_id=created.booking.id, actor_id=buyer.id, code="SMALL")
        booking = booking_service.set_coupon(
            booking_id=created.booking.id, actor_id=buyer.id, code="BIG"
        )

        assert booking.discount_amount_minor == 15_000
        assert_the_total_adds_up(booking)

    def test_a_REFUSED_second_code_leaves_the_first_in_place(
        self, booking_service, buyer, event, make_tier, coupons
    ):
        """The release and the redemption are one transaction, so a typo does
        not cost somebody a working discount."""
        coupons(code="WORKS", value=20)
        tier = make_tier(price_minor=50_000, quantity=10)
        created = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
        )
        booking_service.set_coupon(booking_id=created.booking.id, actor_id=buyer.id, code="WORKS")

        with pytest.raises(CouponUnknownError):
            booking_service.set_coupon(
                booking_id=created.booking.id, actor_id=buyer.id, code="TYPOO"
            )

        booking = Booking.objects.get(pk=created.booking.id)
        assert booking.discount_amount_minor == 10_000
        assert booking.coupon_redemption.coupon.code == "WORKS"
        assert_the_total_adds_up(booking)

    def test_removing_a_code_restores_the_original_total(
        self, booking_service, buyer, event, make_tier, coupons
    ):
        coupons(code="SAVE20", value=20)
        tier = make_tier(price_minor=50_000, quantity=10)
        created = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
        )
        original_total = created.booking.total_amount_minor
        original_fee = created.booking.platform_fee_minor

        booking_service.set_coupon(booking_id=created.booking.id, actor_id=buyer.id, code="SAVE20")
        booking = booking_service.clear_coupon(booking_id=created.booking.id, actor_id=buyer.id)

        assert booking.discount_amount_minor == 0
        assert booking.platform_fee_minor == original_fee
        assert booking.total_amount_minor == original_total

    def test_removing_a_code_that_was_never_there_churns_no_order(
        self, booking_service, buyer, event, make_tier
    ):
        """A different order id for the same amount is a change the browser has
        to absorb for nothing."""
        tier = make_tier(price_minor=50_000, quantity=10)
        created = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
        )

        booking = booking_service.clear_coupon(booking_id=created.booking.id, actor_id=buyer.id)

        assert booking.payment_order_id == created.booking.payment_order_id

    def test_removing_a_code_puts_the_redemption_back(
        self, booking_service, buyer, event, make_tier, coupons
    ):
        coupons(code="ONLYONE", value=20, max_redemptions=1, max_per_user=5)
        tier = make_tier(price_minor=50_000, quantity=20)
        first = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
            idempotency_key="first",
        )
        booking_service.set_coupon(booking_id=first.booking.id, actor_id=buyer.id, code="ONLYONE")
        booking_service.clear_coupon(booking_id=first.booking.id, actor_id=buyer.id)

        second = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
            idempotency_key="second",
        )
        booking = booking_service.set_coupon(
            booking_id=second.booking.id, actor_id=buyer.id, code="ONLYONE"
        )

        assert booking.discount_amount_minor > 0


class TestGivingTheHoldUp:
    def test_CANCELLING_returns_the_redemption(
        self, booking_service, buyer, event, make_tier, coupons
    ):
        """Without this a code with fifty uses is exhausted by fifty people who
        abandoned their checkout — the coupon-shaped version of leaking held
        inventory."""
        coupons(code="ONLYONE", value=20, max_redemptions=1, max_per_user=5)
        tier = make_tier(price_minor=50_000, quantity=20)
        abandoned = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
            idempotency_key="abandoned",
        )
        booking_service.set_coupon(
            booking_id=abandoned.booking.id, actor_id=buyer.id, code="ONLYONE"
        )

        booking_service.cancel_booking(booking_id=abandoned.booking.id, actor_id=buyer.id)

        retry = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
            idempotency_key="retry",
        )
        booking = booking_service.set_coupon(
            booking_id=retry.booking.id, actor_id=buyer.id, code="ONLYONE"
        )
        assert booking.discount_amount_minor > 0

    def test_the_SWEEPER_returns_the_redemption(
        self, booking_service, buyer, event, make_tier, coupons
    ):
        """The reliability backstop has to free a coupon for the same reason it
        frees inventory: nothing else will."""
        coupons(code="ONLYONE", value=20, max_redemptions=1, max_per_user=5)
        tier = make_tier(price_minor=50_000, quantity=20)
        lapsed = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
            idempotency_key="lapsed",
        )
        booking_service.set_coupon(booking_id=lapsed.booking.id, actor_id=buyer.id, code="ONLYONE")
        Booking.objects.filter(pk=lapsed.booking.id).update(
            hold_expires_at=timezone.now() - timedelta(minutes=1)
        )

        assert booking_service.release_expired_bookings() == 1

        retry = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
            idempotency_key="retry",
        )
        booking = booking_service.set_coupon(
            booking_id=retry.booking.id, actor_id=buyer.id, code="ONLYONE"
        )
        assert booking.discount_amount_minor > 0

    def test_a_PAID_booking_keeps_its_redemption(
        self, booking_service, buyer, event, make_tier, coupons, django_capture_on_commit_callbacks
    ):
        """The code was genuinely used. Returning it on payment would make a
        one-use code reusable by whoever spent it, and an organizer who wants
        it back can raise `max_redemptions`."""
        coupons(code="ONLYONE", value=20, max_redemptions=1)
        tier = make_tier(price_minor=50_000, quantity=20)
        created = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
        )
        booking_service.set_coupon(booking_id=created.booking.id, actor_id=buyer.id, code="ONLYONE")

        with django_capture_on_commit_callbacks(execute=True):
            booking_service.confirm_booking(
                booking_id=created.booking.id, payment_ref="pay_confirmed"
            )

        booking = Booking.objects.get(pk=created.booking.id)
        assert booking.status == BookingStatus.PAID
        assert booking.discount_amount_minor == 10_000
        assert booking.coupon_redemption is not None


class TestRefusals:
    def test_a_code_covering_the_whole_order_is_refused_and_changes_nothing(
        self, booking_service, buyer, event, make_tier, coupons
    ):
        coupons(code="ALLOFIT", value=100)
        tier = make_tier(price_minor=50_000, quantity=10)
        created = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
        )
        original_total = created.booking.total_amount_minor

        with pytest.raises(CouponLeavesNothingToChargeError):
            booking_service.set_coupon(
                booking_id=created.booking.id, actor_id=buyer.id, code="ALLOFIT"
            )

        booking = Booking.objects.get(pk=created.booking.id)
        assert booking.total_amount_minor == original_total
        assert booking.discount_amount_minor == 0

    def test_a_stranger_cannot_apply_a_code_to_somebody_elses_booking(
        self, booking_service, buyer, other_user, event, make_tier, coupons
    ):
        from apps.booking.exceptions import NotBookingOwnerError

        coupons(code="SAVE20", value=20)
        tier = make_tier(price_minor=50_000, quantity=10)
        created = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
        )

        with pytest.raises(NotBookingOwnerError):
            booking_service.set_coupon(
                booking_id=created.booking.id, actor_id=other_user.id, code="SAVE20"
            )

    def test_a_PAID_booking_cannot_take_a_code(
        self, booking_service, buyer, event, make_tier, coupons, django_capture_on_commit_callbacks
    ):
        """Its amount is settled — the money already moved, and a discount
        applied afterwards would describe a charge that never happened."""
        from apps.booking.exceptions import BookingNotModifiableError

        coupons(code="SAVE20", value=20)
        tier = make_tier(price_minor=50_000, quantity=10)
        created = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
        )
        with django_capture_on_commit_callbacks(execute=True):
            booking_service.confirm_booking(booking_id=created.booking.id, payment_ref="pay_1")

        with pytest.raises(BookingNotModifiableError):
            booking_service.set_coupon(
                booking_id=created.booking.id, actor_id=buyer.id, code="SAVE20"
            )

    def test_an_exhausted_code_is_refused(
        self, booking_service, buyer, other_user, event, make_tier, coupons
    ):
        coupons(code="ONLYONE", value=20, max_redemptions=1)
        tier = make_tier(price_minor=50_000, quantity=20)
        first = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
        )
        booking_service.set_coupon(booking_id=first.booking.id, actor_id=buyer.id, code="ONLYONE")

        second = booking_service.create_booking(
            user_id=other_user.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
        )
        with pytest.raises(CouponExhaustedError):
            booking_service.set_coupon(
                booking_id=second.booking.id, actor_id=other_user.id, code="ONLYONE"
            )


class TestTheEndpoint:
    """`POST` / `DELETE /bookings/{id}/coupon`.

    Side effects are proved above; what is asserted here is the shape a client
    sees, including that a refusal carries a code the checkout can put a
    specific sentence under.
    """

    def url(self, booking) -> str:
        return f"/api/v1/bookings/{booking.id}/coupon"

    @pytest.fixture
    def held(self, booking_service, buyer, event, make_tier):
        tier = make_tier(price_minor=50_000, quantity=10)
        return booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
        ).booking

    def test_applying_returns_the_repriced_booking(self, authed_client, held, coupons):
        coupons(code="SAVE20", value=20)

        response = authed_client.post(self.url(held), {"code": "save20"}, format="json")

        assert response.status_code == 200
        body = response.json()
        assert body["discount"] == 10_000
        assert body["total_amount"] == 40_400  # ₹400 + 1% of ₹400

    def test_it_is_never_cached(self, authed_client, held, coupons):
        coupons(code="SAVE20", value=20)
        response = authed_client.post(self.url(held), {"code": "SAVE20"}, format="json")
        assert response["Cache-Control"] == "private, no-store"

    def test_a_refusal_names_its_reason(self, authed_client, held):
        response = authed_client.post(self.url(held), {"code": "NOPE"}, format="json")

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "coupon_not_found"

    def test_an_expired_code_and_an_exhausted_one_answer_DIFFERENTLY(
        self, authed_client, held, coupons, buyer, booking_service, event, make_tier
    ):
        """A single "invalid code" would send both people nowhere."""
        coupons(code="GONE", value=20, max_redemptions=1)
        other = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(make_tier(price_minor=50_000).id), "quantity": 1}],
            idempotency_key="other",
        ).booking
        booking_service.set_coupon(booking_id=other.id, actor_id=buyer.id, code="GONE")

        response = authed_client.post(self.url(held), {"code": "GONE"}, format="json")
        assert response.json()["error"]["code"] == "coupon_exhausted"

    def test_a_malformed_code_is_refused_at_the_BOUNDARY(self, authed_client, held):
        """400 from the serializer rather than 422 from the service, because
        the bounds are the coupon module's own — imported, not restated, so
        the two cannot disagree about what a code may look like."""
        response = authed_client.post(self.url(held), {"code": "AB"}, format="json")
        assert response.status_code == 400

    def test_removing_answers_200_with_the_booking(self, authed_client, held, coupons):
        coupons(code="SAVE20", value=20)
        authed_client.post(self.url(held), {"code": "SAVE20"}, format="json")

        response = authed_client.delete(self.url(held))

        assert response.status_code == 200
        assert response.json()["discount"] == 0

    def test_removing_nothing_is_a_200_rather_than_an_error(self, authed_client, held):
        assert authed_client.delete(self.url(held)).status_code == 200

    def test_it_requires_a_session(self, api_client, held):
        assert api_client.post(self.url(held), {"code": "X"}, format="json").status_code == 401

    def test_the_detail_read_names_the_applied_code(self, authed_client, held, coupons):
        """So a reloaded checkout can show what is on the booking. The summary
        deliberately does not carry it — see the note on that serializer."""
        coupons(code="SAVE20", value=20)
        authed_client.post(self.url(held), {"code": "SAVE20"}, format="json")

        body = authed_client.get(f"/api/v1/bookings/{held.id}").json()

        assert body["coupon_code"] == "SAVE20"
        assert body["discount"] == 10_000

    def test_the_detail_read_says_null_when_there_is_no_code(self, authed_client, held):
        body = authed_client.get(f"/api/v1/bookings/{held.id}").json()
        assert body["coupon_code"] is None
        assert body["discount"] == 0


class TestTheReceipt:
    """The seam into `notifications`.

    The RENDERING half — that a context carrying a discount produces a row, and
    one without it produces none — is proved in
    `apps/notifications/tests/test_receipt_discount.py`. What is proved here is
    the half that needs a real booking: that the handler finds the code and the
    amount at all.
    """

    def test_the_receipt_context_names_the_code_and_what_it_saved(
        self, booking_service, buyer, event, make_tier, coupons
    ):
        """The amount comes off the REDEMPTION row rather than being recomputed
        from the coupon's terms, which the organizer may have edited since. A
        receipt is a record of what somebody paid."""
        from apps.booking.repositories import BookingRepository
        from apps.notifications.handlers import discount_row

        coupons(code="SAVE20", value=20)
        tier = make_tier(price_minor=50_000, quantity=10)
        created = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
        )
        booking_service.set_coupon(booking_id=created.booking.id, actor_id=buyer.id, code="SAVE20")

        loaded = BookingRepository().get_detail(created.booking.id)
        row = discount_row(loaded)

        assert "SAVE20" in row["discount_display"]
        assert "100.00" in row["discount_display"]

    def test_a_booking_with_no_code_carries_no_discount_row(
        self, booking_service, buyer, event, make_tier
    ):
        """Absent, not a zero. "Discount ₹0.00" invites the reader to work out
        what went wrong with a discount they never had."""
        from apps.booking.repositories import BookingRepository
        from apps.notifications.handlers import discount_row

        tier = make_tier(price_minor=50_000, quantity=10)
        created = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
        )

        assert discount_row(BookingRepository().get_detail(created.booking.id)) == {}

    def test_finding_the_code_costs_no_extra_query(
        self, django_assert_num_queries, booking_service, buyer, event, make_tier, coupons
    ):
        """`get_detail` joins the redemption, so the receipt names the code off
        a row it already has. Without the join this is one statement per
        booking confirmation, on the money path."""
        from apps.booking.repositories import BookingRepository
        from apps.notifications.handlers import discount_row

        coupons(code="SAVE20", value=20)
        tier = make_tier(price_minor=50_000, quantity=10)
        created = booking_service.create_booking(
            user_id=buyer.id,
            event_id=event.id,
            items=[{"ticket_type_id": str(tier.id), "quantity": 1}],
        )
        booking_service.set_coupon(booking_id=created.booking.id, actor_id=buyer.id, code="SAVE20")
        loaded = BookingRepository().get_detail(created.booking.id)

        with django_assert_num_queries(0):
            assert discount_row(loaded)
