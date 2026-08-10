"""Fixtures for review tests: a finished event somebody actually attended."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.booking.models import Booking, BookingStatus, Ticket, TicketStatus
from apps.events.models import Event, EventStatus
from apps.events.repositories import EventRepository
from apps.organizations.models import Organization
from apps.reviews.repositories import ReviewRepository
from apps.reviews.services import ReviewService
from apps.ticketing.models import TicketType

User = get_user_model()


@pytest.fixture
def review_service() -> ReviewService:
    """Constructed directly with real repositories — never via `config.di`,
    which would make the test depend on settings choosing a backend."""
    return ReviewService(reviews=ReviewRepository(), events=EventRepository())


@pytest.fixture
def attendee(db):
    return User.objects.create_user(
        email="attendee@example.com", password="x", full_name="Asha Rao"
    )


@pytest.fixture
def stranger(db):
    return User.objects.create_user(email="stranger@example.com", password="x", full_name="Sam Roy")


@pytest.fixture
def organizer(db):
    return User.objects.create_user(email="org@example.com", password="x", full_name="Org Owner")


@pytest.fixture
def make_event(db, organizer):
    org = Organization.objects.create(name="Test Org", owner=organizer)

    def _make(*, ended_hours_ago: int = 24, status: str = EventStatus.LIVE, **overrides) -> Event:
        starts = timezone.now() - timedelta(hours=ended_hours_ago + 3)
        return Event.objects.create(
            organization=org,
            title=overrides.pop("title", "Techie Summit"),
            status=status,
            starts_at=starts,
            ends_at=starts + timedelta(hours=3),
            venue="Convention Center",
            city="Pune",
            **overrides,
        )

    return _make


@pytest.fixture
def make_booking(db):
    """A PAID booking with one ticket, which is the eligible shape."""

    def _make(*, event, user, ticket_status: str = TicketStatus.ACTIVE, **overrides) -> Booking:
        # A real tier: `Ticket.ticket_type` is NOT NULL, and a fixture that
        # papers over the schema is a fixture testing something else.
        tier = TicketType.objects.create(
            event=event, name="General", price_minor=5000, quantity=100
        )
        booking = Booking.objects.create(
            user=user,
            event=event,
            status=overrides.pop("status", BookingStatus.PAID),
            hold_expires_at=timezone.now() + timedelta(hours=1),
            total_amount_minor=5000,
            platform_fee_minor=100,
        )
        Ticket.objects.create(
            booking=booking,
            ticket_type=tier,
            status=ticket_status,
            qr_token=f"v1.{uuid.uuid4().hex}.sig",
        )
        return booking

    return _make
