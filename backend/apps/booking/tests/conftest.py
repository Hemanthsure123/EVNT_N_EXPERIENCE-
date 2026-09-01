from __future__ import annotations

from datetime import timedelta
from typing import cast

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import User
from apps.accounts.repositories import UserRepository
from apps.booking.repositories import BookingRepository, TicketRepository
from apps.booking.services import BookingService
from apps.events.models import Event, EventStatus
from apps.events.repositories import EventRepository
from apps.organizations.repositories import OrganizationRepository
from apps.ticketing.models import TicketType
from apps.ticketing.repositories import TicketTypeRepository
from apps.ticketing.services import TicketingService
from apps.ticketing.strategies import RowLockReservationStrategy
from core.adapters.local.fake_payment import FakePaymentAdapter
from core.adapters.local.locmem_cache import LocMemCacheAdapter

QR_SECRET = "booking-test-qr-secret"


def _access_token_for(user: User) -> str:
    return str(cast(RefreshToken, RefreshToken.for_user(user)).access_token)


@pytest.fixture(autouse=True)
def _isolate_cache():
    from config.di import cache_port

    cache_port.cache_clear()
    yield
    cache_port.cache_clear()


@pytest.fixture
def token_for():
    return _access_token_for


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def buyer() -> User:
    return UserRepository().create_user(email="buyer@example.com", password="s3cur3pass")


@pytest.fixture
def other_user() -> User:
    return UserRepository().create_user(email="bk-other@example.com", password="s3cur3pass")


@pytest.fixture
def authed_client(api_client, buyer) -> APIClient:
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {_access_token_for(buyer)}")
    return api_client


@pytest.fixture
def organizer() -> User:
    return UserRepository().create_user(email="bk-organizer@example.com", password="s3cur3pass")


@pytest.fixture
def event(organizer) -> Event:
    org = OrganizationRepository().create(owner_id=organizer.id, name="Groove Collective")
    ev = EventRepository().create(
        organization_id=org.id,
        title="Headline Show",
        venue="Phoenix Arena",
        city="Mumbai",
        starts_at=timezone.now() + timedelta(days=30),
    )
    Event.objects.filter(pk=ev.id).update(status=EventStatus.LIVE)
    ev.refresh_from_db()
    return ev


@pytest.fixture
def make_tier(event):
    """A tier, optionally with a sale-phase schedule — each phase a dict of
    name/price_minor/ends_at/quantity, array order becoming position (exactly
    as the ticketing write API sets them)."""

    def _make(
        *,
        name="General",
        price_minor=50000,
        quantity=100,
        max_per_order=10,
        phases: list[dict] | None = None,
        ev=None,
    ) -> TicketType:
        repo = TicketTypeRepository()
        tier = repo.create(
            event_id=(ev or event).id,
            name=name,
            price_minor=price_minor,
            quantity=quantity,
            max_per_order=max_per_order,
        )
        if phases:
            repo.set_phases(ticket_type_id=tier.id, phases=phases)
        return tier

    return _make


@pytest.fixture
def booking_service() -> BookingService:
    """A real BookingService: real repos + the real TicketingService (row-lock
    reservations), with fake payment + locmem cache adapters."""
    ticket_types = TicketTypeRepository()
    ticketing = TicketingService(
        ticket_types=ticket_types,
        events=EventRepository(),
        reservation=RowLockReservationStrategy(ticket_types=ticket_types),
    )
    return BookingService(
        bookings=BookingRepository(),
        tickets=TicketRepository(),
        ticket_types=ticket_types,
        ticketing=ticketing,
        events=EventRepository(),
        payments=FakePaymentAdapter(),
        cache=LocMemCacheAdapter(),
        qr_secret=QR_SECRET,
        hold_minutes=10,
        # 100 bps = 1%, matching the shipped default. The fee is ADDED to the
        # total here as in production, so a test's expected total is
        # subtotal + 1% and not the bare ticket price.
        platform_fee_bps=100,
        donation_max_minor=100_000,
    )
