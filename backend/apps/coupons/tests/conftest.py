from __future__ import annotations

from datetime import timedelta
from typing import cast

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import User
from apps.accounts.repositories import UserRepository
from apps.booking.models import Booking
from apps.coupons.models import CouponKind
from apps.coupons.repositories import CouponRedemptionRepository, CouponRepository
from apps.coupons.services import CouponRedemptionService, CouponService
from apps.events.models import Event, EventStatus
from apps.events.repositories import EventRepository
from apps.events.slugs import event_slug
from apps.organizations.repositories import OrganizationRepository

#: ₹500 — the face value every money assertion in this module is written
#: against, so a number in a test reads as a multiple of it rather than as an
#: arbitrary constant.
FACE = 50_000


def _access_token_for(user: User) -> str:
    # simplejwt's for_user() is mistyped — see the note in apps/accounts/services.py.
    return str(cast(RefreshToken, RefreshToken.for_user(user)).access_token)


@pytest.fixture(autouse=True)
def _isolate_cache():
    """The events read path this module resolves a coupon through is cached,
    and `cache_port()` is `lru_cache`d for the process."""
    from config.di import cache_port

    cache_port.cache_clear()
    yield
    cache_port.cache_clear()


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def token_for():
    return _access_token_for


@pytest.fixture
def owner() -> User:
    return UserRepository().create_user(email="cp-owner@example.com", password="s3cur3pass")


@pytest.fixture
def buyer() -> User:
    return UserRepository().create_user(email="cp-buyer@example.com", password="s3cur3pass")


@pytest.fixture
def stranger() -> User:
    return UserRepository().create_user(email="cp-stranger@example.com", password="s3cur3pass")


@pytest.fixture
def organization(owner):
    return OrganizationRepository().create(owner_id=owner.id, name="Acme Promotions")


@pytest.fixture
def rival_organization(stranger):
    """A second tenant. Every cross-tenant assertion in this module needs one,
    and sharing the first would make those tests pass for the wrong reason."""
    return OrganizationRepository().create(owner_id=stranger.id, name="Rival Nights")


@pytest.fixture
def make_event():
    def _make(*, org, title: str = "Jazz Night", status: str = EventStatus.LIVE) -> Event:
        event = EventRepository().create(
            organization_id=org.id,
            title=title,
            venue="Phoenix Arena",
            city="Mumbai",
            description="",
            starts_at=timezone.now() + timedelta(days=10),
            slug=event_slug(title),
        )
        if status != EventStatus.DRAFT:
            Event.objects.filter(pk=event.id).update(status=status)
            event.refresh_from_db()
        return event

    return _make


@pytest.fixture
def event(make_event, organization) -> Event:
    return make_event(org=organization)


@pytest.fixture
def coupon_service(organization) -> CouponService:
    """Built directly with real repositories, never through `config.di` — a
    unit test must not depend on which backends settings happen to select."""
    return CouponService(
        organizations=OrganizationRepository(),
        coupons=CouponRepository(),
        redemptions=CouponRedemptionRepository(),
        events=EventRepository(),
    )


@pytest.fixture
def redemption_service() -> CouponRedemptionService:
    return CouponRedemptionService(
        coupons=CouponRepository(),
        redemptions=CouponRedemptionRepository(),
        events=EventRepository(),
    )


@pytest.fixture
def make_coupon(coupon_service, organization, owner):
    """A coupon through the SERVICE, so every fixture obeys the same rules the
    API does — a row inserted straight into the table could carry terms the
    platform would never accept, and a test built on one proves nothing."""

    def _make(
        *,
        code: str = "SAVE20",
        kind: str = CouponKind.PERCENT,
        value: int = 20,
        org=None,
        actor=None,
        **kwargs,
    ):
        return coupon_service.create_coupon(
            organization_id=(org or organization).id,
            actor_id=(actor or owner).id,
            code=code,
            kind=kind,
            value=value,
            **kwargs,
        )

    return _make


@pytest.fixture
def make_booking(buyer, event):
    """A reserved booking, created directly.

    The real one comes from `BookingService.create_booking`, which reserves
    inventory under tier locks — none of which this module's tests are about.
    What they need is a row with a subtotal, and the subtotal is passed to
    `redeem` explicitly, so constructing the booking here keeps the coupon
    tests about coupons.
    """

    def _make(*, user=None, evt=None, subtotal_minor: int = FACE, donation_minor: int = 0):
        return Booking.objects.create(
            user_id=(user or buyer).id,
            event_id=(evt or event).id,
            hold_expires_at=timezone.now() + timedelta(minutes=10),
            total_amount_minor=subtotal_minor + donation_minor,
            platform_fee_minor=0,
            donation_amount_minor=donation_minor,
        )

    return _make
