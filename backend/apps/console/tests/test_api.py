"""API tests for the operator console.

Two things matter most here and are tested first: that a non-staff user can
never read platform-wide data, and that every number returned is a real
aggregate over rows this test actually created — not a shape-only assertion
that would pass against a stub.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.booking.models import Booking, BookingStatus
from apps.events.models import Event, EventStatus
from apps.organizations.models import Organization, VerificationRecord, VerificationStatus
from apps.payments.models import Payment, PaymentStatus


@pytest.fixture
def staff(db) -> User:
    return User.objects.create_user(
        email="ops@example.com", password="opsadmin12345", is_staff=True
    )


@pytest.fixture
def member(db) -> User:
    return User.objects.create_user(email="member@example.com", password="member12345")


def auth(client: APIClient, user: User) -> APIClient:
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
class TestConsoleAccess:
    @pytest.mark.parametrize(
        "path",
        [
            "/api/v1/admin/overview",
            "/api/v1/admin/health",
            "/api/v1/admin/timeseries",
            "/api/v1/admin/breakdown",
            "/api/v1/admin/activity",
            "/api/v1/admin/organizations",
            "/api/v1/admin/users",
            "/api/v1/admin/settlements",
            "/api/v1/admin/verifications",
        ],
    )
    def test_anonymous_is_refused(self, path: str) -> None:
        assert APIClient().get(path).status_code == 401

    @pytest.mark.parametrize(
        "path",
        [
            "/api/v1/admin/overview",
            "/api/v1/admin/users",
            "/api/v1/admin/organizations",
        ],
    )
    def test_signed_in_but_not_staff_is_refused(self, member: User, path: str) -> None:
        """The important one. A logged-in attendee reaching an admin URL must
        get 403, not a page of every user on the platform."""
        assert auth(APIClient(), member).get(path).status_code == 403

    def test_staff_is_allowed(self, staff: User) -> None:
        assert auth(APIClient(), staff).get("/api/v1/admin/overview").status_code == 200

    def test_never_edge_cacheable(self, staff: User) -> None:
        response = auth(APIClient(), staff).get("/api/v1/admin/overview")
        assert response["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
class TestOverview:
    def test_counts_real_rows(self, staff: User) -> None:
        owner = User.objects.create_user(email="owner@example.com", password="owner12345")
        org = Organization.objects.create(owner=owner, name="Acme Live")
        VerificationRecord.objects.create(organization=org, status=VerificationStatus.PENDING)
        Event.objects.create(
            organization=org,
            title="Live One",
            venue="Hall",
            city="Mumbai",
            starts_at=timezone.now() + dt.timedelta(days=3),
            status=EventStatus.LIVE,
        )

        body = auth(APIClient(), staff).get("/api/v1/admin/overview").json()
        assert body["organizations"] == 1
        assert body["pending_verifications"] == 1
        assert body["events_live"] == 1
        # Nothing has been paid, so revenue must be exactly zero — not absent,
        # and not a placeholder.
        assert body["revenue_today_minor"] == 0
        assert body["bookings_today"] == 0

    def test_revenue_counts_only_captured_payments(self, staff: User) -> None:
        owner = User.objects.create_user(email="o2@example.com", password="owner12345")
        org = Organization.objects.create(owner=owner, name="Acme")
        event = Event.objects.create(
            organization=org,
            title="Show",
            venue="Hall",
            city="Mumbai",
            starts_at=timezone.now() + dt.timedelta(days=2),
            status=EventStatus.LIVE,
        )
        booking = Booking.objects.create(
            user=owner,
            event=event,
            status=BookingStatus.PAID,
            total_amount_minor=50_000,
            platform_fee_minor=20,
            # NOT NULL by design: a reservation without a deadline is a leak.
            hold_expires_at=timezone.now() + dt.timedelta(minutes=10),
        )
        Payment.objects.create(
            booking=booking,
            amount_minor=50_000,
            status=PaymentStatus.PAID,
            rzp_order_id="order_paid",
        )
        # An abandoned checkout. Counting this would inflate today's revenue by
        # every order nobody completed.
        Payment.objects.create(
            booking=booking,
            amount_minor=99_000,
            status=PaymentStatus.CREATED,
            rzp_order_id="order_created",
        )

        body = auth(APIClient(), staff).get("/api/v1/admin/overview").json()
        assert body["revenue_today_minor"] == 50_000


@pytest.mark.django_db
class TestTimeseries:
    def test_series_is_dense(self, staff: User) -> None:
        """Every day in the window is present, including empty ones — a chart
        that skips quiet days draws a climb that never happened."""
        body = (
            auth(APIClient(), staff).get("/api/v1/admin/timeseries?metric=bookings&days=7").json()
        )
        assert body["days"] == 7
        assert len(body["points"]) == 7
        assert all(point["value"] == 0 for point in body["points"])
        dates = [point["date"] for point in body["points"]]
        assert dates == sorted(dates)

    def test_days_is_clamped(self, staff: User) -> None:
        body = auth(APIClient(), staff).get("/api/v1/admin/timeseries?days=9999").json()
        assert body["days"] == 90
        assert len(body["points"]) == 90

    def test_garbage_input_does_not_500(self, staff: User) -> None:
        response = auth(APIClient(), staff).get("/api/v1/admin/timeseries?metric=drop&days=nope")
        assert response.status_code == 200
        assert response.json()["metric"] == "revenue"


@pytest.mark.django_db
class TestHealth:
    def test_probes_are_evidence_configured_are_not(self, staff: User) -> None:
        body = auth(APIClient(), staff).get("/api/v1/admin/health").json()
        by_name = {check["name"]: check for check in body["checks"]}

        # Actually touched.
        assert by_name["database"]["status"] == "ok"
        assert by_name["cache"]["status"] == "ok"
        # Reported, never claimed green — nothing contacted these.
        for name in ("payments", "storage", "queue", "email", "sms"):
            assert by_name[name]["status"] == "unknown"
            assert by_name[name]["detail"]


@pytest.mark.django_db
class TestVerificationDecision:
    def test_staff_can_reject_and_it_sticks(self, staff: User) -> None:
        owner = User.objects.create_user(email="o3@example.com", password="owner12345")
        org = Organization.objects.create(owner=owner, name="Shady Co")
        record = VerificationRecord.objects.create(
            organization=org, status=VerificationStatus.PENDING
        )

        response = auth(APIClient(), staff).post(
            f"/api/v1/admin/organizations/{org.id}/verification",
            {"approve": False, "notes": "Documents did not match"},
            format="json",
        )
        assert response.status_code == 204

        record.refresh_from_db()
        org.refresh_from_db()
        assert record.status == VerificationStatus.REJECTED
        assert record.notes == "Documents did not match"
        assert org.verified_level == "unverified"

    def test_deciding_twice_is_a_conflict_not_a_flip(self, staff: User) -> None:
        """A double-clicked Approve must not be able to overturn a rejection."""
        owner = User.objects.create_user(email="o4@example.com", password="owner12345")
        org = Organization.objects.create(owner=owner, name="Acme")
        VerificationRecord.objects.create(organization=org, status=VerificationStatus.PENDING)
        client = auth(APIClient(), staff)
        url = f"/api/v1/admin/organizations/{org.id}/verification"

        assert client.post(url, {"approve": False}, format="json").status_code == 204
        second = client.post(url, {"approve": True}, format="json")
        assert second.status_code == 409

        org.refresh_from_db()
        assert org.verified_level == "unverified"

    def test_non_staff_cannot_decide(self, member: User) -> None:
        owner = User.objects.create_user(email="o5@example.com", password="owner12345")
        org = Organization.objects.create(owner=owner, name="Acme")
        VerificationRecord.objects.create(organization=org, status=VerificationStatus.PENDING)
        response = auth(APIClient(), member).post(
            f"/api/v1/admin/organizations/{org.id}/verification", {"approve": True}, format="json"
        )
        assert response.status_code == 403


@pytest.mark.django_db
class TestActivity:
    def test_reads_the_outbox(self, staff: User) -> None:
        from core.models import OutboxEvent

        OutboxEvent.objects.create(
            event_type="organizations.organization_created",
            aggregate_id="abc",
            payload={"name": "Acme"},
        )
        body = auth(APIClient(), staff).get("/api/v1/admin/activity?limit=5").json()
        assert body["data"][0]["type"] == "organizations.organization_created"
        assert body["data"][0]["payload"] == {"name": "Acme"}


@pytest.mark.django_db
class TestBreakdown:
    """Both branches, with rows. The first version of `revenue_by_city` built an
    invalid queryset and 500'd on every call; the suite missed it because only
    the default branch was ever requested."""

    def _seed(self) -> None:
        owner = User.objects.create_user(email="b1@example.com", password="owner12345")
        org = Organization.objects.create(owner=owner, name="Acme")
        event = Event.objects.create(
            organization=org,
            title="Show",
            venue="Hall",
            city="Mumbai",
            starts_at=timezone.now() + dt.timedelta(days=2),
            status=EventStatus.LIVE,
        )
        booking = Booking.objects.create(
            user=owner,
            event=event,
            status=BookingStatus.PAID,
            total_amount_minor=30_000,
            platform_fee_minor=10,
            hold_expires_at=timezone.now() + dt.timedelta(minutes=10),
        )
        Payment.objects.create(
            booking=booking,
            amount_minor=30_000,
            status=PaymentStatus.PAID,
            rzp_order_id="order_city",
        )

    def test_events_by_city(self, staff: User) -> None:
        self._seed()
        body = auth(APIClient(), staff).get("/api/v1/admin/breakdown?by=events_by_city").json()
        assert body["items"] == [{"label": "Mumbai", "value": 1}]

    def test_revenue_by_city(self, staff: User) -> None:
        self._seed()
        response = auth(APIClient(), staff).get("/api/v1/admin/breakdown?by=revenue_by_city")
        assert response.status_code == 200
        assert response.json()["items"] == [{"label": "Mumbai", "value": 30_000}]
