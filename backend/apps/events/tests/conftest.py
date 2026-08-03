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


def _access_token_for(user: User) -> str:
    # simplejwt's for_user() is mistyped — see the note in apps/accounts/services.py.
    return str(cast(RefreshToken, RefreshToken.for_user(user)).access_token)


@pytest.fixture(autouse=True)
def _isolate_cache():
    """Give every test a fresh cache. The events list cache key is global
    (`events:list:v{gen}:{hash}`), not per-user, so without this the default
    empty-filter listing cached by one test would be served to the next —
    and the process-wide lru_cache on cache_port() keeps one adapter alive
    across the whole run. Clearing that cache rebuilds an empty adapter."""
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
    return UserRepository().create_user(email="ev-owner@example.com", password="s3cur3pass")


@pytest.fixture
def other_user() -> User:
    return UserRepository().create_user(email="ev-other@example.com", password="s3cur3pass")


@pytest.fixture
def organization(owner):
    """An organization a platform operator has ALREADY verified.

    Verified on purpose: publishing is gated on it (see
    `EventService.publish_event`), and almost every test in this module is
    about an established organizer rather than about the gate. The gate itself
    is proved against `unverified_organization` below — the two fixtures exist
    so that a test which publishes has to say which kind of organizer it is.
    """
    org = OrganizationRepository().create(owner_id=owner.id, name="Acme Events")
    org.verified_level = VerifiedLevel.VERIFIED
    org.save(update_fields=["verified_level"])
    return org


@pytest.fixture
def unverified_organization(other_user):
    """A brand-new organization: nobody has approved it yet."""
    return OrganizationRepository().create(owner_id=other_user.id, name="Unapproved Co")


@pytest.fixture
def authed_client(api_client, owner) -> APIClient:
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {_access_token_for(owner)}")
    return api_client


@pytest.fixture
def make_event(organization):
    """Create an event directly (bypassing the API's future-start validation,
    so tests can also make past/live events). Defaults to a live, upcoming
    event."""

    def _make(
        *,
        title: str = "Jazz Night",
        venue: str = "Phoenix Arena",
        city: str = "Mumbai",
        description: str = "",
        status: str = EventStatus.LIVE,
        starts_at=None,
        org=None,
    ) -> Event:
        starts_at = starts_at or (timezone.now() + timedelta(days=10))
        event = EventRepository().create(
            organization_id=(org or organization).id,
            title=title,
            venue=venue,
            city=city,
            description=description,
            starts_at=starts_at,
        )
        if status != EventStatus.DRAFT:
            Event.objects.filter(pk=event.id).update(status=status)
            event.refresh_from_db()
        return event

    return _make


@pytest.fixture
def add_ticket_type():
    """Give an event a ticket type. Needed to satisfy the "an event needs >= 1
    ticket type" publish gate that the ticketing module registers (see
    apps/ticketing/apps.py) — after ticketing exists, an event genuinely can't
    be published without one, so the events publish tests must reflect that."""

    def _add(event, *, name="General Admission", price_minor=1000, quantity=100):
        from apps.ticketing.models import TicketType

        return TicketType.objects.create(
            event_id=event.id,
            name=name,
            price_minor=price_minor,
            quantity=quantity,
            max_per_order=10,
        )

    return _add
