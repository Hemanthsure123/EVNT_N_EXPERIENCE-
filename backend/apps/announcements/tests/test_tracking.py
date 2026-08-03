"""The tracked redirect — the click, and the open redirect it must never be.

The themes: the first click wins and later ones are a no-op, the destination
can only ever be this site, and a reader always arrives at the page whether or
not their click could be attributed to anybody.
"""

from __future__ import annotations

import uuid

import pytest
from rest_framework.test import APIClient

from apps.announcements.models import Announcement, AnnouncementDelivery, Subscriber
from apps.announcements.services import ClickTrackingService
from core.errors import InvalidInputError

from .conftest import SITE_BASE


@pytest.fixture
def delivery(db, announcement: Announcement) -> AnnouncementDelivery:
    subscriber = Subscriber.objects.create(email="reader@example.com", source="homepage_card")
    return AnnouncementDelivery.objects.create(announcement=announcement, subscriber=subscriber)


def track(announcement_id, *, to: str = "/events", delivery_id=None) -> str:
    query = f"?to={to}" + (f"&d={delivery_id}" if delivery_id else "")
    return f"/api/v1/a/{announcement_id}/r{query}"


@pytest.mark.django_db
class TestClickService:
    def test_a_click_is_stamped_once(
        self, clicks: ClickTrackingService, delivery: AnnouncementDelivery
    ) -> None:
        clicks.record_click(
            announcement_id=delivery.announcement_id, to="/events", delivery_id=delivery.id
        )
        delivery.refresh_from_db()
        first = delivery.clicked_at
        assert first is not None

        clicks.record_click(
            announcement_id=delivery.announcement_id, to="/events", delivery_id=delivery.id
        )
        delivery.refresh_from_db()
        # A forwarded link and a second press by the same reader are one
        # person, and the first timestamp is the one that answers "when".
        assert delivery.clicked_at == first

    def test_it_returns_an_absolute_url_on_this_site(
        self, clicks: ClickTrackingService, delivery: AnnouncementDelivery
    ) -> None:
        destination = clicks.record_click(
            announcement_id=delivery.announcement_id,
            to="/events?city=Mumbai",
            delivery_id=delivery.id,
        )
        assert destination == f"{SITE_BASE}/events?city=Mumbai"

    @pytest.mark.parametrize(
        "to",
        [
            "https://evil.example",
            "//evil.example",
            "/\\evil.example",
            "/%2f%2fevil.example",
            "javascript:alert(1)",
            "/events\r\nSet-Cookie: a=b",
        ],
    )
    def test_an_off_origin_destination_is_refused(
        self, clicks: ClickTrackingService, delivery: AnnouncementDelivery, to: str
    ) -> None:
        """A link that arrives in an email from us is the most valuable open
        redirect on the platform: the trusted domain in front of it is the
        entire point of the attack."""
        with pytest.raises(InvalidInputError):
            clicks.record_click(
                announcement_id=delivery.announcement_id, to=to, delivery_id=delivery.id
            )

        delivery.refresh_from_db()
        # And the probe is not recorded as engagement — validation runs first.
        assert delivery.clicked_at is None

    def test_a_click_with_no_delivery_still_redirects(
        self, clicks: ClickTrackingService, announcement: Announcement
    ) -> None:
        """A forwarded link with the id stripped is a reader who should still
        arrive at the page. One uncounted click is the cost."""
        assert (
            clicks.record_click(announcement_id=announcement.id, to="/events", delivery_id=None)
            == f"{SITE_BASE}/events"
        )

    def test_a_delivery_from_another_campaign_cannot_be_stamped(
        self, clicks: ClickTrackingService, delivery: AnnouncementDelivery
    ) -> None:
        other = Announcement.objects.create(kind="feature", title="Something else")

        clicks.record_click(announcement_id=other.id, to="/events", delivery_id=delivery.id)

        delivery.refresh_from_db()
        assert delivery.clicked_at is None


@pytest.mark.django_db
class TestRedirectEndpoint:
    def test_it_302s_and_stamps(self, delivery: AnnouncementDelivery) -> None:
        response = APIClient().get(
            track(delivery.announcement_id, delivery_id=delivery.id), follow=False
        )

        assert response.status_code == 302
        assert response["Location"].endswith("/events")
        delivery.refresh_from_db()
        assert delivery.clicked_at is not None

    def test_it_is_never_cached(self, delivery: AnnouncementDelivery) -> None:
        """A permanent redirect, or a cacheable one, is a tracking URL that
        stops tracking after the first reader in each browser."""
        response = APIClient().get(
            track(delivery.announcement_id, delivery_id=delivery.id), follow=False
        )

        assert response.status_code == 302  # not 301
        assert response["Cache-Control"] == "private, no-store"

    def test_an_off_origin_destination_is_refused_over_http(
        self, delivery: AnnouncementDelivery
    ) -> None:
        response = APIClient().get(
            track(delivery.announcement_id, to="https://evil.example", delivery_id=delivery.id),
            follow=False,
        )

        assert response.status_code == 422
        assert "Location" not in response
        assert response.json()["error"]["code"] == "invalid_input"

    def test_a_malformed_delivery_id_is_treated_as_absent(self, announcement: Announcement) -> None:
        """The reader pressed a link and must arrive at the page. The worst
        case is one click nobody counted."""
        response = APIClient().get(
            f"/api/v1/a/{announcement.id}/r?to=/events&d=not-a-uuid", follow=False
        )
        assert response.status_code == 302

    def test_an_unknown_delivery_id_is_not_an_error(self, announcement: Announcement) -> None:
        response = APIClient().get(track(announcement.id, delivery_id=uuid.uuid4()), follow=False)
        assert response.status_code == 302

    def test_it_needs_no_account(self, delivery: AnnouncementDelivery) -> None:
        """The reader is in their mail client, not signed in to anything."""
        response = APIClient().get(
            track(delivery.announcement_id, delivery_id=delivery.id), follow=False
        )
        assert response.status_code == 302
