"""API tests for platform announcements.

The themes: scheduling is declarative and filtered at read time (no job has to
have run), placement decides audience, and an operator-authored link can only
ever point at this site.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.announcements.models import Announcement, AnnouncementKind, Placement
from config.di import cache_port


@pytest.fixture(autouse=True)
def _fresh_cache():
    cache_port.cache_clear()
    yield
    cache_port.cache_clear()


@pytest.fixture
def staff(db) -> User:
    return User.objects.create_user(
        email="ann-ops@example.com", password="opspass12345", is_staff=True
    )


@pytest.fixture
def member(db) -> User:
    return User.objects.create_user(email="ann-member@example.com", password="memberpass12345")


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def create(client: APIClient, **overrides) -> dict:
    body = {
        "kind": AnnouncementKind.MAINTENANCE,
        "placement": Placement.HOME,
        "title": "Scheduled maintenance",
        "body": "Ticket sales pause for ten minutes tonight.",
        **overrides,
    }
    return client.post("/api/v1/admin/announcements", body, format="json").json()


@pytest.mark.django_db
class TestAccess:
    def test_the_home_placement_is_public(self) -> None:
        assert APIClient().get("/api/v1/announcements").status_code == 200

    def test_other_placements_need_a_session(self) -> None:
        """A payout-delay notice is not for anonymous visitors."""
        assert APIClient().get("/api/v1/announcements?placement=organizer").status_code == 401

    def test_only_staff_can_publish(self, member: User) -> None:
        response = auth(member).post(
            "/api/v1/admin/announcements",
            {"kind": AnnouncementKind.PROMOTION, "title": "Half price"},
            format="json",
        )
        assert response.status_code == 403


@pytest.mark.django_db
class TestPublishing:
    def test_a_published_announcement_appears_immediately(self, staff: User) -> None:
        create(auth(staff))

        rows = APIClient().get("/api/v1/announcements").json()["data"]
        assert [row["title"] for row in rows] == ["Scheduled maintenance"]

    def test_deactivating_pulls_it_without_editing_the_schedule(self, staff: User) -> None:
        client = auth(staff)
        created = create(client)

        client.patch(
            f"/api/v1/admin/announcements/{created['id']}", {"is_active": False}, format="json"
        )
        assert APIClient().get("/api/v1/announcements").json()["data"] == []

    def test_deleting_removes_it(self, staff: User) -> None:
        client = auth(staff)
        created = create(client)

        assert client.delete(f"/api/v1/admin/announcements/{created['id']}").status_code == 204
        assert APIClient().get("/api/v1/announcements").json()["data"] == []


@pytest.mark.django_db
class TestScheduling:
    def test_a_future_window_is_not_shown_yet(self, staff: User) -> None:
        create(auth(staff), starts_at=(timezone.now() + dt.timedelta(days=1)).isoformat())
        assert APIClient().get("/api/v1/announcements").json()["data"] == []

    def test_an_expired_window_is_gone(self, staff: User) -> None:
        create(
            auth(staff),
            starts_at=(timezone.now() - dt.timedelta(days=2)).isoformat(),
            ends_at=(timezone.now() - dt.timedelta(days=1)).isoformat(),
        )
        assert APIClient().get("/api/v1/announcements").json()["data"] == []

    def test_an_open_window_is_shown(self, staff: User) -> None:
        create(
            auth(staff),
            starts_at=(timezone.now() - dt.timedelta(hours=1)).isoformat(),
            ends_at=(timezone.now() + dt.timedelta(hours=1)).isoformat(),
        )
        assert len(APIClient().get("/api/v1/announcements").json()["data"]) == 1

    def test_a_backwards_window_is_refused(self, staff: User) -> None:
        response = auth(staff).post(
            "/api/v1/admin/announcements",
            {
                "kind": AnnouncementKind.FEATURE,
                "title": "Nope",
                "starts_at": (timezone.now() + dt.timedelta(days=2)).isoformat(),
                "ends_at": timezone.now().isoformat(),
            },
            format="json",
        )
        assert response.status_code == 422


@pytest.mark.django_db
class TestPlacement:
    def test_an_organizer_notice_is_not_on_the_homepage(self, staff: User, member: User) -> None:
        create(auth(staff), placement=Placement.ORGANIZER, title="Payouts delayed")

        assert APIClient().get("/api/v1/announcements").json()["data"] == []
        rows = auth(member).get("/api/v1/announcements?placement=organizer").json()["data"]
        assert [row["title"] for row in rows] == ["Payouts delayed"]

    def test_all_reaches_every_placement_from_one_row(self, staff: User, member: User) -> None:
        create(auth(staff), placement=Placement.ALL, title="We are up")

        assert len(APIClient().get("/api/v1/announcements").json()["data"]) == 1
        assert (
            len(auth(member).get("/api/v1/announcements?placement=organizer").json()["data"]) == 1
        )


@pytest.mark.django_db
class TestLinkSafety:
    @pytest.mark.parametrize(
        "path", ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"]
    )
    def test_an_off_site_link_is_refused(self, staff: User, path: str) -> None:
        """An operator-controlled banner that can point anywhere on the
        internet is a phishing vector on the platform's own front page — and
        the operator may be a compromised account."""
        response = auth(staff).post(
            "/api/v1/admin/announcements",
            {"kind": AnnouncementKind.PROMOTION, "title": "Deal", "link_path": path},
            format="json",
        )
        assert response.status_code == 422

    def test_a_same_site_path_is_allowed(self, staff: User) -> None:
        response = auth(staff).post(
            "/api/v1/admin/announcements",
            {
                "kind": AnnouncementKind.PROMOTION,
                "title": "Deal",
                "link_path": "/events?city=Mumbai",
                "link_label": "Browse",
            },
            format="json",
        )
        assert response.status_code == 201


@pytest.mark.django_db
def test_publishing_is_audited(staff: User) -> None:
    from core.models import AuditLog

    create(auth(staff))
    entry = AuditLog.objects.get(action="announcement.published")
    assert entry.actor_id == str(staff.id)


@pytest.mark.django_db
def test_the_admin_list_includes_scheduled_and_expired_rows(staff: User) -> None:
    """Exactly what the public read filters out is what an operator manages."""
    client = auth(staff)
    create(client, starts_at=(timezone.now() + dt.timedelta(days=5)).isoformat())

    assert APIClient().get("/api/v1/announcements").json()["data"] == []
    assert len(client.get("/api/v1/admin/announcements").json()["data"]) == 1
    assert Announcement.objects.count() == 1
