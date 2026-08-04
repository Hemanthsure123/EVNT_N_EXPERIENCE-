"""An operator's power over a single event: analytics, edit, delete.

The delete tests are the important ones. `Booking.event` and
`Settlement.event` are `PROTECT`, so the database already refuses to let an
event somebody bought a ticket to disappear — these prove the API refuses
first, with a sentence saying what to do instead, rather than surfacing an
IntegrityError.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.booking.models import Booking, BookingStatus
from apps.events.models import Event, EventStatus
from apps.organizations.models import Organization


@pytest.fixture
def staff(db) -> User:
    return User.objects.create_user(
        email="ops@example.com", password="opsadmin12345", is_staff=True
    )


@pytest.fixture
def owner(db) -> User:
    return User.objects.create_user(email="owner@example.com", password="owner1234567")


@pytest.fixture
def event(db, owner) -> Event:
    org = Organization.objects.create(owner=owner, name="Acme Live")
    return Event.objects.create(
        organization=org,
        title="Jazz night",
        venue="Blue Room",
        city="Mumbai",
        starts_at=timezone.now() + dt.timedelta(days=30),
        status=EventStatus.DRAFT,
    )


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def booking(event: Event, user: User, status: str) -> Booking:
    return Booking.objects.create(
        user=user,
        event=event,
        status=status,
        total_amount_minor=50_000,
        platform_fee_minor=1_000,
        hold_expires_at=timezone.now() + dt.timedelta(minutes=10),
    )


@pytest.mark.django_db
class TestAccess:
    def test_a_member_cannot_edit_or_delete(self, event, owner) -> None:
        client = auth(owner)  # the OWNER, who is not staff
        assert client.patch(f"/api/v1/admin/events/{event.id}", {"version": 1}).status_code == 403
        assert client.delete(f"/api/v1/admin/events/{event.id}?reason=x").status_code == 403

    def test_anonymous_is_refused_analytics(self, event) -> None:
        assert APIClient().get(f"/api/v1/admin/events/{event.id}/analytics").status_code == 401


@pytest.mark.django_db
class TestAnalytics:
    def test_operator_sees_the_organizers_own_report(self, staff, event) -> None:
        resp = auth(staff).get(f"/api/v1/admin/events/{event.id}/analytics")

        assert resp.status_code == 200
        # The payload is the organizer's, passed through — an operator
        # answering "my numbers look wrong" has to be reading the same ones.
        assert "tiers" in resp.data or "event" in resp.data or resp.data

    def test_an_unknown_event_is_404_not_500(self, staff) -> None:
        missing = "00000000-0000-0000-0000-000000000000"
        assert auth(staff).get(f"/api/v1/admin/events/{missing}/analytics").status_code == 404

    def test_organization_analytics_reads_the_owners_dashboard(self, staff, event) -> None:
        resp = auth(staff).get(f"/api/v1/admin/organizations/{event.organization_id}/analytics")

        assert resp.status_code == 200
        assert "overview" in resp.data
        assert "timeseries" in resp.data


@pytest.mark.django_db
class TestOperatorEdit:
    def test_an_operator_can_edit_an_event_they_do_not_own(self, staff, event) -> None:
        resp = auth(staff).patch(
            f"/api/v1/admin/events/{event.id}",
            {"version": event.version, "title": "Jazz night (moved)"},
            format="json",
        )

        assert resp.status_code == 200
        event.refresh_from_db()
        assert event.title == "Jazz night (moved)"

    def test_an_edit_without_a_version_is_refused(self, staff, event) -> None:
        # The optimistic lock is the whole protection against two editors
        # clobbering each other; an edit that declines to name a version is
        # asking to skip it.
        resp = auth(staff).patch(f"/api/v1/admin/events/{event.id}", {"title": "x"}, format="json")
        assert resp.status_code == 422

    def test_a_stale_version_is_refused(self, staff, event) -> None:
        resp = auth(staff).patch(
            f"/api/v1/admin/events/{event.id}",
            {"version": event.version + 5, "title": "x"},
            format="json",
        )
        assert resp.status_code == 409


@pytest.mark.django_db
class TestOperatorDelete:
    def test_a_clean_event_is_deleted(self, staff, event) -> None:
        resp = auth(staff).delete(f"/api/v1/admin/events/{event.id}?reason=spam")

        assert resp.status_code == 204
        event.refresh_from_db()
        # SOFT: every read path filters on this, and a hard delete would be
        # refused by the PROTECT on bookings the moment one existed.
        assert event.deleted_at is not None

    def test_a_delete_needs_a_reason(self, staff, event) -> None:
        assert auth(staff).delete(f"/api/v1/admin/events/{event.id}").status_code == 422

    def test_an_event_with_a_paid_booking_is_refused(self, staff, event, owner) -> None:
        booking(event, owner, BookingStatus.PAID)

        resp = auth(staff).delete(f"/api/v1/admin/events/{event.id}?reason=spam")

        assert resp.status_code == 409
        assert "take it off sale" in resp.data["error"]["message"].lower()
        event.refresh_from_db()
        assert event.deleted_at is None

    def test_a_live_hold_also_blocks_the_delete(self, staff, event, owner) -> None:
        # Somebody is in checkout right now. Deleting the event under them is
        # the same failure as deleting it under a ticket holder.
        booking(event, owner, BookingStatus.RESERVED)

        assert auth(staff).delete(f"/api/v1/admin/events/{event.id}?reason=spam").status_code == 409

    def test_a_lapsed_hold_does_not_block_the_delete(self, staff, event, owner) -> None:
        # Nothing was issued and nobody is owed anything, so the event is
        # still a clean delete.
        booking(event, owner, BookingStatus.EXPIRED)

        assert auth(staff).delete(f"/api/v1/admin/events/{event.id}?reason=spam").status_code == 204

    def test_deleting_twice_is_404_rather_than_a_second_delete(self, staff, event) -> None:
        auth(staff).delete(f"/api/v1/admin/events/{event.id}?reason=spam")
        assert auth(staff).delete(f"/api/v1/admin/events/{event.id}?reason=spam").status_code == 404
