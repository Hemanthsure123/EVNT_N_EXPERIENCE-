"""Shared fixtures for the marketplace tests.

The cache fixture is here for the same reason `events` and `organizer` have
one: the public selectors are cache-aside, and a cache is exactly the state
Django's per-test transaction rollback does NOT undo. Without it the first test
to read a profile serves its payload to every test after it.

`world` builds TWO organizations on purpose. Almost every test here is really
asking "can this reach somebody else's row", and that question needs somebody
else to exist.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.organizations.models import Organization
from apps.performers.models import (
    BookingRequest,
    Occasion,
    Performer,
    PerformerMedia,
    PerformerStatus,
    PerformerType,
)
from config.di import cache_port


@pytest.fixture(autouse=True)
def _fresh_cache():
    cache_port.cache_clear()
    yield
    cache_port.cache_clear()


@pytest.fixture
def owner(db) -> User:
    return User.objects.create_user(email="band-owner@example.com", password="ownerpass12345")


@pytest.fixture
def rival(db) -> User:
    return User.objects.create_user(email="rival-owner@example.com", password="rivalpass12345")


@pytest.fixture
def customer(db) -> User:
    return User.objects.create_user(
        email="customer@example.com", password="custpass12345", full_name="Asha Rao"
    )


@pytest.fixture
def staff(db) -> User:
    return User.objects.create_user(email="ops@example.com", password="opspass12345", is_staff=True)


@pytest.fixture
def organization(owner) -> Organization:
    return Organization.objects.create(owner=owner, name="Groove Collective")


@pytest.fixture
def rival_organization(rival) -> Organization:
    return Organization.objects.create(owner=rival, name="Rival Sounds")


@pytest.fixture
def make_performer(organization):
    def _make(**overrides) -> Performer:
        fields = {
            "organization": organization,
            "stage_name": "The Midnight Quartet",
            "performer_type": PerformerType.BAND,
            "city": "Mumbai",
            "bio": "A four-piece jazz outfit playing weddings and corporate evenings "
            "across the west coast for a decade.",
            "genres": ["jazz", "swing"],
            "languages": ["English", "Hindi"],
            "occasions": [Occasion.WEDDING, Occasion.CORPORATE],
            "base_price_minor": 8_000_00,
            "experience_years": 10,
            "status": PerformerStatus.LIVE,
        }
        fields.update(overrides)
        return Performer.objects.create(**fields)

    return _make


@pytest.fixture
def with_photo():
    def _add(performer: Performer) -> PerformerMedia:
        return PerformerMedia.objects.create(
            performer=performer,
            url="https://cdn.example/band.jpg",
            alt_text="The quartet on stage at dusk",
        )

    return _add


@pytest.fixture
def make_request(customer):
    def _make(**overrides) -> BookingRequest:
        fields = {
            "customer": customer,
            "performer_type": PerformerType.BAND,
            "occasion": Occasion.WEDDING,
            "city": "Mumbai",
            "event_date": (timezone.now() + dt.timedelta(days=60)).date(),
            "budget_min_minor": 5_000_00,
            "budget_max_minor": 15_000_00,
            "notes": "Evening reception, about 200 guests.",
        }
        fields.update(overrides)
        return BookingRequest.objects.create(**fields)

    return _make
