"""Two console faults an operator hit in production, pinned.

Both were reported as "bad UI". Neither was: one screen 500ed and one filter
lied about the platform being empty. Cosmetics laid over either would have left
the operator with the same wrong answer, more prettily.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.events.models import Event, EventStatus
from apps.organizations.models import Organization
from core.models import AuditLog


def staff_client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture()
def operator(db) -> User:
    return User.objects.create_user(
        email="op@example.com", password="x", full_name="Op", is_staff=True
    )


@pytest.mark.django_db
class TestAuditLogSurvivesNonUuidActors:
    """`AuditLog.actor_id` is a CharField so the trail outlives the account.

    `actor_emails` fed those strings straight into `User.objects.filter(id__in=)`
    against a UUID primary key. Django raises while BUILDING that query, so a
    single non-UUID actor returned 500 for the whole page — and kept doing it,
    because audit rows are append-only and the bad row never goes away.
    """

    def test_a_system_actor_does_not_take_the_page_down(self, operator: User) -> None:
        AuditLog.objects.create(
            actor_id="system", action="event.approved", target_type="event", target_id="x"
        )
        AuditLog.objects.create(
            actor_id=str(operator.id), action="event.rejected", target_type="event", target_id="y"
        )

        response = staff_client(operator).get("/api/v1/admin/audit")

        assert response.status_code == 200, response.data
        actions = {row["action"] for row in response.data["data"]}
        assert actions == {"event.approved", "event.rejected"}

    def test_the_real_actor_still_resolves_to_an_email(self, operator: User) -> None:
        # The unparseable one must not cost the parseable ones their emails.
        AuditLog.objects.create(actor_id="system", action="a.b", target_type="", target_id="")
        AuditLog.objects.create(
            actor_id=str(operator.id), action="c.d", target_type="", target_id=""
        )

        rows = staff_client(operator).get("/api/v1/admin/audit").data["data"]

        by_action = {row["action"]: row for row in rows}
        assert by_action["c.d"]["actor_email"] == "op@example.com"
        assert by_action["a.b"]["actor_email"] == ""


@pytest.mark.django_db
class TestModerationQueueAllStatus:
    """The console's event picker needs every moderatable state, not pending.

    An ABSENT status falls back to the pending queue on purpose — a mistyped
    query string must not widen an operator's view. But that left no way to ask
    for the whole set, so the picker (which passed nothing) reported "No events
    on the platform yet" over a table listing five.
    """

    @pytest.fixture()
    def events(self, operator: User) -> Organization:
        organization = Organization.objects.create(name="Org", owner=operator)
        now = timezone.now()
        for status in (
            EventStatus.PENDING_REVIEW,
            EventStatus.LIVE,
            EventStatus.REJECTED,
            EventStatus.ARCHIVED,
            EventStatus.DRAFT,
        ):
            Event.objects.create(
                organization=organization,
                title=f"{status} show",
                venue="V",
                city="Pune",
                starts_at=now + dt.timedelta(days=7),
                status=status,
                submitted_at=now,
            )
        return organization

    def test_without_a_status_it_stays_the_pending_queue(
        self, operator: User, events: Organization
    ) -> None:
        rows = staff_client(operator).get("/api/v1/admin/events/pending").data["data"]
        assert {row["status"] for row in rows} == {EventStatus.PENDING_REVIEW}

    def test_an_unknown_status_still_falls_back_to_pending(
        self, operator: User, events: Organization
    ) -> None:
        # The guard that makes a typo safe, kept.
        rows = (
            staff_client(operator).get("/api/v1/admin/events/pending?status=nonsense").data["data"]
        )
        assert {row["status"] for row in rows} == {EventStatus.PENDING_REVIEW}

    def test_all_returns_every_moderatable_status(
        self, operator: User, events: Organization
    ) -> None:
        rows = staff_client(operator).get("/api/v1/admin/events/pending?status=all").data["data"]
        assert {row["status"] for row in rows} == {
            EventStatus.PENDING_REVIEW,
            EventStatus.LIVE,
            EventStatus.REJECTED,
            EventStatus.ARCHIVED,
        }

    def test_all_still_hides_drafts(self, operator: User, events: Organization) -> None:
        # The whole reason the allow-list exists: an unsubmitted draft is an
        # organizer's private workspace, and `all` must not be a way around it.
        rows = staff_client(operator).get("/api/v1/admin/events/pending?status=all").data["data"]
        assert EventStatus.DRAFT not in {row["status"] for row in rows}
