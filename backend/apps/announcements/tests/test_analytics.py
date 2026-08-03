"""Campaign analytics: four figures, computed in Postgres, and no fifth.

The themes: `delivered` counts only messages that actually reached `sent`,
`click_rate` is measured against `delivered` rather than against everything
queued, and there is no `opened` anywhere in the payload.
"""

from __future__ import annotations

import uuid

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.announcements import selectors
from apps.announcements.models import Announcement, AnnouncementDelivery, Subscriber
from apps.notifications.models import (
    NotificationChannel,
    NotificationLog,
    NotificationStatus,
)
from core.errors import NotFoundError


def make_log(status: str, *, address: str) -> NotificationLog:
    return NotificationLog.objects.create(
        dedupe_key=f"announcement:{uuid.uuid4()}:email:{address}",
        type="announcement",
        channel=NotificationChannel.EMAIL,
        recipient=address,
        subject="Curatix",
        body="...",
        status=status,
    )


def deliver(
    announcement: Announcement,
    *,
    address: str,
    status: str | None = None,
    clicked: bool = False,
) -> AnnouncementDelivery:
    """One delivery row, optionally attached to a notification and clicked."""
    subscriber = Subscriber.objects.create(email=address)
    log = make_log(status, address=address) if status else None
    return AnnouncementDelivery.objects.create(
        announcement=announcement,
        subscriber=subscriber,
        notification_log_id=log.id if log else None,
        clicked_at=timezone.now() if clicked else None,
    )


@pytest.mark.django_db
class TestAggregate:
    def test_a_campaign_nobody_has_received_is_all_zeroes(self, announcement: Announcement) -> None:
        assert selectors.get_announcement_analytics(announcement.id) == {
            "announcement_id": str(announcement.id),
            "recipients": 0,
            "delivered": 0,
            "clicked": 0,
            "click_rate": 0.0,
        }

    def test_the_four_figures_are_correct(self, announcement: Announcement) -> None:
        deliver(announcement, address="sent-clicked@example.com", status="sent", clicked=True)
        deliver(announcement, address="sent-quiet1@example.com", status="sent")
        deliver(announcement, address="sent-quiet2@example.com", status="sent")
        deliver(announcement, address="sent-quiet3@example.com", status="sent")
        # Claimed but not yet delivered, and dead-lettered. Neither reached
        # anybody, so neither counts as delivered.
        deliver(announcement, address="pending@example.com", status=NotificationStatus.PENDING)
        deliver(announcement, address="dead@example.com", status=NotificationStatus.FAILED)
        # Queued, never handed over at all.
        deliver(announcement, address="waiting@example.com")

        assert selectors.get_announcement_analytics(announcement.id) == {
            "announcement_id": str(announcement.id),
            "recipients": 7,
            "delivered": 4,
            "clicked": 1,
            "click_rate": 0.25,
        }

    def test_the_rate_is_measured_against_delivered_not_queued(
        self, announcement: Announcement
    ) -> None:
        """Dividing by queued rows would report a campaign still in flight as
        one people ignored — and the number would climb on its own as the
        backlog drained, which is the most misleading shape a metric has."""
        deliver(announcement, address="a@example.com", status="sent", clicked=True)
        for index in range(9):
            deliver(announcement, address=f"waiting{index}@example.com")

        payload = selectors.get_announcement_analytics(announcement.id)
        assert (payload["recipients"], payload["delivered"]) == (10, 1)
        assert payload["click_rate"] == 1.0

    def test_another_campaign_does_not_leak_in(self, announcement: Announcement) -> None:
        other = Announcement.objects.create(kind="feature", title="Something else")
        deliver(announcement, address="mine@example.com", status="sent", clicked=True)
        deliver(other, address="theirs@example.com", status="sent", clicked=True)

        assert selectors.get_announcement_analytics(announcement.id)["recipients"] == 1

    def test_a_click_on_an_undelivered_row_cannot_push_the_rate_over_one(
        self, announcement: Announcement
    ) -> None:
        """A scanner pre-fetching a link for a message that then failed to send
        is the one way these two counts can disagree in that direction. The
        rate is allowed to exceed 1.0 rather than being silently clamped —
        clamping would hide a real inconsistency behind a plausible number."""
        deliver(announcement, address="a@example.com", status="sent")
        deliver(
            announcement, address="b@example.com", status=NotificationStatus.FAILED, clicked=True
        )
        deliver(announcement, address="c@example.com", status="sent", clicked=True)

        payload = selectors.get_announcement_analytics(announcement.id)
        assert (payload["delivered"], payload["clicked"]) == (2, 2)
        assert payload["click_rate"] == 1.0

    def test_it_is_one_query(self, announcement: Announcement, django_assert_num_queries) -> None:
        """The counts never leave Postgres. Adding them up in Python would mean
        shipping every delivery for the campaign most worth measuring."""
        deliver(announcement, address="a@example.com", status="sent", clicked=True)
        deliver(announcement, address="b@example.com", status="sent")

        # One existence check for the announcement, one aggregate for the three
        # counts. Not one query per delivery, and not one per figure.
        with django_assert_num_queries(2):
            selectors.get_announcement_analytics(announcement.id)

    def test_an_unknown_announcement_is_not_four_zeroes(self) -> None:
        """Which would read as "this campaign reached nobody" — the same
        wrong-in-a-knowable-direction number this module refuses for opens."""
        with pytest.raises(NotFoundError):
            selectors.get_announcement_analytics(uuid.uuid4())


@pytest.mark.django_db
class TestAnalyticsEndpoint:
    def _url(self, announcement: Announcement) -> str:
        return f"/api/v1/admin/announcements/{announcement.id}/analytics"

    def test_staff_see_the_four_figures(self, announcement: Announcement, staff) -> None:
        deliver(announcement, address="a@example.com", status="sent", clicked=True)
        deliver(announcement, address="b@example.com", status="sent")

        client = APIClient()
        client.force_authenticate(user=staff)
        response = client.get(self._url(announcement))

        assert response.status_code == 200
        assert response.json() == {
            "announcement_id": str(announcement.id),
            "recipients": 2,
            "delivered": 2,
            "clicked": 1,
            "click_rate": 0.5,
        }

    def test_there_is_no_opens_figure(self, announcement: Announcement, staff) -> None:
        """Deliberate and permanent. A pixel measures Apple's Mail Privacy
        Protection and Gmail's image cache, not a person — so an "opens" number
        would be wrong in a knowable direction by an unknowable amount."""
        client = APIClient()
        client.force_authenticate(user=staff)

        body = client.get(self._url(announcement)).json()

        assert set(body) == {
            "announcement_id",
            "recipients",
            "delivered",
            "clicked",
            "click_rate",
        }

    def test_it_is_never_cached(self, announcement: Announcement, staff) -> None:
        client = APIClient()
        client.force_authenticate(user=staff)

        response = client.get(self._url(announcement))
        assert response["Cache-Control"] == "private, no-store"

    def test_a_member_cannot_read_it(self, announcement: Announcement) -> None:
        from apps.accounts.models import User

        member = User.objects.create_user(email="member@example.com", password="memberpass12345")
        client = APIClient()
        client.force_authenticate(user=member)

        assert client.get(self._url(announcement)).status_code == 403

    def test_it_needs_an_account(self, announcement: Announcement) -> None:
        assert APIClient().get(self._url(announcement)).status_code == 401
