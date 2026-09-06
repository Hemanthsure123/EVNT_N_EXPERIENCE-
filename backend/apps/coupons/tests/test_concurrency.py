"""The most important test in this module: a code cannot be over-redeemed.

The coupon analogue of ticketing's no-oversell proof, and the reason `redeem`
takes a row lock at all. Without one, "has this code been used up" is a
check-then-write: forty people holding the last redemption all read the same
count, all pass, and all insert.

`transaction=True` so each worker thread runs a REAL committed transaction
against Postgres — under the default `@pytest.mark.django_db` every
"transaction" is a savepoint on ONE connection, which cannot reproduce
concurrency and would let this test pass against code with no lock at all.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from django.db import connection, transaction
from django.utils import timezone

from apps.accounts.repositories import UserRepository
from apps.booking.models import Booking
from apps.coupons.exceptions import CouponRejectedError
from apps.coupons.models import CouponRedemption
from apps.coupons.repositories import CouponRedemptionRepository, CouponRepository
from apps.coupons.services import CouponRedemptionService, CouponService
from apps.events.models import Event, EventStatus
from apps.events.repositories import EventRepository
from apps.events.slugs import event_slug
from apps.organizations.repositories import OrganizationRepository

FACE = 50_000


def _run_concurrently(fn, n: int) -> list:
    """Run fn(i) on n threads, each closing its own connection afterwards so
    the pool does not leak between workers."""

    def worker(i: int):
        try:
            return fn(i)
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=n) as executor:
        return list(executor.map(worker, range(n)))


@pytest.fixture
def world():
    """Everything built inline rather than from the module conftest.

    A `transaction=True` test commits, so it cannot lean on fixtures that
    assume the outer rollback — and it FLUSHES the database afterwards, which
    is the reason nothing here may depend on rows another test left behind.
    """
    owner = UserRepository().create_user(email="cc-owner@example.com", password="s3cur3pass")
    organization = OrganizationRepository().create(owner_id=owner.id, name="Race Nights")
    event = EventRepository().create(
        organization_id=organization.id,
        title="Race Night",
        venue="Phoenix Arena",
        city="Mumbai",
        description="",
        starts_at=timezone.now() + timedelta(days=10),
        slug=event_slug("Race Night"),
    )
    Event.objects.filter(pk=event.id).update(status=EventStatus.LIVE)
    event.refresh_from_db()
    return owner, organization, event


def _services():
    return (
        CouponService(
            organizations=OrganizationRepository(),
            coupons=CouponRepository(),
            redemptions=CouponRedemptionRepository(),
            events=EventRepository(),
        ),
        CouponRedemptionService(
            coupons=CouponRepository(),
            redemptions=CouponRedemptionRepository(),
            events=EventRepository(),
        ),
    )


def _buyer(index: int):
    return UserRepository().create_user(email=f"cc-buyer{index}@example.com", password="s3cur3pass")


def _booking(user, event):
    return Booking.objects.create(
        user_id=user.id,
        event_id=event.id,
        hold_expires_at=timezone.now() + timedelta(minutes=10),
        total_amount_minor=FACE,
        platform_fee_minor=0,
    )


@pytest.mark.django_db(transaction=True)
def test_concurrent_redemptions_never_exceed_the_organizers_limit(world):
    """Ten redemptions offered, forty people race for them. Exactly ten win."""
    owner, organization, event = world
    coupons, redemptions = _services()
    coupon = coupons.create_coupon(
        organization_id=organization.id,
        actor_id=owner.id,
        code="RACE10",
        kind="percent",
        value=20,
        max_redemptions=10,
    )

    # Each racer is a different person with their own booking, so `max_per_user`
    # is not what limits them — `max_redemptions` is, which is the counter under
    # test.
    racers = [(user, _booking(user, event)) for user in (_buyer(i) for i in range(40))]

    def try_redeem(index: int) -> bool:
        user, booking = racers[index]
        try:
            with transaction.atomic():
                redemptions.redeem(
                    event_id=event.id,
                    user_id=user.id,
                    booking_id=booking.id,
                    code="RACE10",
                    subtotal_minor=FACE,
                )
            return True
        except CouponRejectedError:
            return False

    results = _run_concurrently(try_redeem, 40)

    assert sum(results) == 10
    assert CouponRedemption.objects.filter(coupon_id=coupon.id).count() == 10


@pytest.mark.django_db(transaction=True)
def test_one_person_racing_themselves_uses_a_code_once(world):
    """`max_per_user` has to hold under contention too.

    A single account firing several checkouts at once — a double-tapped Apply
    across two tabs — is the likelier race than forty strangers, and it is the
    one a per-user counter checked outside a lock would miss.
    """
    owner, organization, event = world
    coupons, redemptions = _services()
    coupons.create_coupon(
        organization_id=organization.id,
        actor_id=owner.id,
        code="ONCEONLY",
        kind="percent",
        value=20,
    )

    buyer = _buyer(99)
    bookings = [_booking(buyer, event) for _ in range(8)]

    def try_redeem(index: int) -> bool:
        try:
            with transaction.atomic():
                redemptions.redeem(
                    event_id=event.id,
                    user_id=buyer.id,
                    booking_id=bookings[index].id,
                    code="ONCEONLY",
                    subtotal_minor=FACE,
                )
            return True
        except CouponRejectedError:
            return False

    results = _run_concurrently(try_redeem, 8)

    assert sum(results) == 1
    assert CouponRedemption.objects.filter(user_id=buyer.id).count() == 1


@pytest.mark.django_db(transaction=True)
def test_a_released_redemption_is_immediately_available_to_the_next_person(world):
    """The release path holds no coupon lock, so this proves it still lands
    where the next locked count can see it."""
    owner, organization, event = world
    coupons, redemptions = _services()
    coupons.create_coupon(
        organization_id=organization.id,
        actor_id=owner.id,
        code="HANDOVER",
        kind="percent",
        value=20,
        max_redemptions=1,
    )

    first, second = _buyer(101), _buyer(102)
    first_booking, second_booking = _booking(first, event), _booking(second, event)

    with transaction.atomic():
        redemptions.redeem(
            event_id=event.id,
            user_id=first.id,
            booking_id=first_booking.id,
            code="HANDOVER",
            subtotal_minor=FACE,
        )
    redemptions.release_for_booking(booking_id=first_booking.id)

    with transaction.atomic():
        result = redemptions.redeem(
            event_id=event.id,
            user_id=second.id,
            booking_id=second_booking.id,
            code="HANDOVER",
            subtotal_minor=FACE,
        )

    assert result.discount_minor == 10_000
