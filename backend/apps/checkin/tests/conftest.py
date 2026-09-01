from __future__ import annotations

from datetime import timedelta
from typing import cast

import pytest
from django.conf import settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import User
from apps.accounts.repositories import UserRepository
from apps.booking.models import Ticket
from apps.booking.repositories import BookingRepository, TicketRepository
from apps.booking.services import BookingService
from apps.checkin.repositories import ScanLogRepository
from apps.checkin.services import CheckinService
from apps.events.models import Event, EventStatus
from apps.events.repositories import EventRepository
from apps.organizations.repositories import OrganizationRepository
from apps.ticketing.models import TicketType
from apps.ticketing.repositories import TicketTypeRepository
from apps.ticketing.services import TicketingService
from apps.ticketing.strategies import RowLockReservationStrategy
from core.adapters.local.fake_payment import FakePaymentAdapter
from core.adapters.local.locmem_cache import LocMemCacheAdapter

# The one HMAC key both booking (issuing) and checkin (verifying) share. Use
# the SAME configured key the DI-built service uses, so tokens minted here
# verify at the API layer too (the composition root signs/verifies with this).
QR_SECRET = settings.TICKET_QR_SIGNING_KEY


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
def organizer() -> User:
    return UserRepository().create_user(email="ci-organizer@example.com", password="s3cur3pass")


@pytest.fixture
def buyer() -> User:
    return UserRepository().create_user(email="ci-buyer@example.com", password="s3cur3pass")


@pytest.fixture
def other_user() -> User:
    return UserRepository().create_user(email="ci-other@example.com", password="s3cur3pass")


@pytest.fixture
def organization(organizer):
    return OrganizationRepository().create(owner_id=organizer.id, name="Checkin Demo Co")


def _make_event(organization, *, starts_in: timedelta, ends_in: timedelta | None) -> Event:
    now = timezone.now()
    ev = EventRepository().create(
        organization_id=organization.id,
        title="Gate Test Show",
        venue="Arena",
        city="Mumbai",
        starts_at=now + starts_in,
        ends_at=(now + ends_in) if ends_in is not None else None,
    )
    Event.objects.filter(pk=ev.id).update(status=EventStatus.LIVE)
    ev.refresh_from_db()
    return ev


@pytest.fixture
def event(organization) -> Event:
    """A live event whose scan window is currently OPEN (started an hour ago,
    ends in three hours)."""
    return _make_event(organization, starts_in=timedelta(hours=-1), ends_in=timedelta(hours=3))


@pytest.fixture
def future_event(organization) -> Event:
    """A live event far in the future — well before its scan window opens."""
    return _make_event(organization, starts_in=timedelta(days=30), ends_in=timedelta(days=30))


@pytest.fixture
def make_tier():
    def _make(event, *, name="GA", price_minor=50000, quantity=100, max_per_order=10) -> TicketType:
        return TicketTypeRepository().create(
            event_id=event.id,
            name=name,
            price_minor=price_minor,
            quantity=quantity,
            max_per_order=max_per_order,
        )

    return _make


@pytest.fixture
def tier(event, make_tier) -> TicketType:
    return make_tier(event)


def _build_booking_service() -> BookingService:
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


@pytest.fixture
def booking_service() -> BookingService:
    return _build_booking_service()


def issue_one_ticket(booking_service: BookingService, *, buyer, event, tier) -> Ticket:
    """Run the real booking flow (reserve -> confirm) to mint one genuinely
    signed, active Ticket — checkin verifies exactly what booking issues."""
    booking = booking_service.create_booking(
        user_id=buyer.id,
        event_id=event.id,
        items=[{"ticket_type_id": tier.id, "quantity": 1}],
    ).booking
    result = booking_service.confirm_booking(booking_id=booking.id, payment_ref="pay_checkin_test")
    return result.tickets[0]


@pytest.fixture
def issued_ticket(booking_service, buyer, event, tier) -> Ticket:
    return issue_one_ticket(booking_service, buyer=buyer, event=event, tier=tier)


def build_checkin_service(cache: LocMemCacheAdapter | None = None) -> CheckinService:
    return CheckinService(
        scans=ScanLogRepository(),
        tickets=TicketRepository(),
        ticket_types=TicketTypeRepository(),
        events=EventRepository(),
        cache=cache or LocMemCacheAdapter(),
        qr_secret=QR_SECRET,
        window_opens_before_minutes=180,
        window_grace_after_minutes=360,
    )


@pytest.fixture
def checkin_service() -> CheckinService:
    return build_checkin_service()
