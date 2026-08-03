from __future__ import annotations

from datetime import timedelta
from typing import cast

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import User
from apps.accounts.repositories import UserRepository
from apps.events.models import Event, EventStatus
from apps.events.repositories import EventRepository
from apps.organizations.models import VerifiedLevel
from apps.organizations.repositories import OrganizationRepository
from apps.ticketing.models import TicketType
from apps.ticketing.repositories import TicketTypeRepository
from apps.ticketing.services import TicketingService
from apps.ticketing.strategies import RowLockReservationStrategy


def _access_token_for(user: User) -> str:
    return str(cast(RefreshToken, RefreshToken.for_user(user)).access_token)


@pytest.fixture(autouse=True)
def _isolate_cache():
    """Fresh cache per test — the tiers display cache plus the events list
    generation counter it bumps are process-wide (lru_cache on cache_port())."""
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
def owner() -> User:
    return UserRepository().create_user(email="tk-owner@example.com", password="s3cur3pass")


@pytest.fixture
def other_user() -> User:
    return UserRepository().create_user(email="tk-other@example.com", password="s3cur3pass")


@pytest.fixture
def organization(owner):
    """An organization a platform operator has already verified.

    Verified explicitly because `EventService.publish_event` now refuses an
    unverified organization (the approval gate lives in the service, not in
    the frontend). Two tests in this module submit an event for review to
    prove the ticket-type publish gate; they are about ticketing, not about
    verification, so the organizer here is an established one.
    """
    org = OrganizationRepository().create(owner_id=owner.id, name="Groove Collective")
    org.verified_level = VerifiedLevel.VERIFIED
    org.save(update_fields=["verified_level"])
    return org


@pytest.fixture
def event(organization) -> Event:
    ev = EventRepository().create(
        organization_id=organization.id,
        title="Concert",
        venue="Phoenix Arena",
        city="Mumbai",
        starts_at=timezone.now() + timedelta(days=30),
    )
    Event.objects.filter(pk=ev.id).update(status=EventStatus.LIVE)
    ev.refresh_from_db()
    return ev


@pytest.fixture
def authed_client(api_client, owner) -> APIClient:
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {_access_token_for(owner)}")
    return api_client


@pytest.fixture
def make_ticket_type(event):
    """Create a tier directly, with optional pre-set sold/reserved counters
    (set via a raw update so the CHECK constraint still guards them) and an
    optional phase schedule — each phase a dict of name/price_minor/ends_at/
    quantity, array order becoming position (as the write API does it)."""

    def _make(
        *,
        name: str = "General Admission",
        price_minor: int = 1000,
        quantity: int = 100,
        sold: int = 0,
        reserved: int = 0,
        sale_start=None,
        sale_end=None,
        max_per_order: int = 10,
        phases: list[dict] | None = None,
        ev: Event | None = None,
    ) -> TicketType:
        repo = TicketTypeRepository()
        tt = repo.create(
            event_id=(ev or event).id,
            name=name,
            price_minor=price_minor,
            quantity=quantity,
            sale_start=sale_start,
            sale_end=sale_end,
            max_per_order=max_per_order,
        )
        if phases:
            repo.set_phases(ticket_type_id=tt.id, phases=phases)
        if sold or reserved:
            TicketType.objects.filter(pk=tt.id).update(sold=sold, reserved=reserved)
            tt.refresh_from_db()
        return tt

    return _make


@pytest.fixture
def ticketing_service() -> TicketingService:
    """A real TicketingService (real repos + the row-lock strategy) — the
    reservation tests exercise genuine locking, not a fake."""
    repo = TicketTypeRepository()
    return TicketingService(
        ticket_types=repo,
        events=EventRepository(),
        reservation=RowLockReservationStrategy(ticket_types=repo),
    )


@pytest.fixture
def strategy() -> RowLockReservationStrategy:
    return RowLockReservationStrategy(ticket_types=TicketTypeRepository())
