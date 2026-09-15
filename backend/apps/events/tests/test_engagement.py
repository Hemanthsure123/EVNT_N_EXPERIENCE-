"""The engagement beacon: what a browser saw, counted without keeping who saw it.

These are the numbers behind the organizer's views, impressions and
click-through. They are INDICATIVE — the beacon is anonymous — so what is
tested here is the floor the server applies whatever a browser sends: each
event once per kind per beacon, only events a visitor could have seen, no
machines, and nothing stored about the person.
"""

from __future__ import annotations

import datetime as dt
import uuid

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.events.engagement import PLATFORM_TZ, EngagementService, is_automated, same_city
from apps.events.models import Event, EventEngagementDay, EventStatus
from apps.events.repositories import EventEngagementRepository
from apps.organizations.models import Organization

URL = "/api/v1/events/engagement"
BROWSER = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)


@pytest.fixture
def organization(db) -> Organization:
    owner = User.objects.create_user(
        email="engagement-owner@example.com", password="ownerpass12345"
    )
    return Organization.objects.create(owner=owner, name="Engagement Collective")


def _event(
    organization: Organization,
    *,
    city: str = "Mumbai",
    status: str = EventStatus.LIVE,
    deleted: bool = False,
) -> Event:
    event = Event.objects.create(
        organization=organization,
        title=f"Show {uuid.uuid4().hex[:6]}",
        venue="Blue Frog",
        city=city,
        starts_at=timezone.now() + dt.timedelta(days=5),
        status=status,
    )
    if deleted:
        Event.objects.filter(pk=event.pk).update(deleted_at=timezone.now())
    return event


def _post(payload: dict, *, agent: str = BROWSER, client: APIClient | None = None):
    return (client or APIClient()).post(URL, payload, format="json", HTTP_USER_AGENT=agent)


def _day(event: Event) -> EventEngagementDay:
    return EventEngagementDay.objects.get(event=event)


@pytest.mark.django_db
class TestTheBeacon:
    def test_counts_an_impression_a_view_and_where_the_view_came_from(self, organization):
        event = _event(organization)
        response = _post(
            {
                "impressions": [str(event.id)],
                "views": [{"event_id": str(event.id), "source": "feed"}],
                "city": "mumbai",
            }
        )
        assert response.status_code == 204
        row = _day(event)
        assert (row.impressions, row.views, row.feed_views) == (1, 1, 1)
        # The city matched regardless of case — and it was not kept anywhere.
        assert (row.located_views, row.local_views) == (1, 1)
        assert row.date == timezone.now().astimezone(PLATFORM_TZ).date()

    def test_a_second_beacon_adds_to_the_same_day_rather_than_replacing_it(self, organization):
        event = _event(organization)
        _post({"views": [{"event_id": str(event.id)}]})
        _post({"views": [{"event_id": str(event.id)}]})
        row = _day(event)
        assert row.views == 2
        # `direct` is the default source, so neither counted as a feed press.
        assert row.feed_views == 0
        assert EventEngagementDay.objects.filter(event=event).count() == 1

    def test_one_beacon_counts_each_event_once_per_kind(self, organization):
        """A replayed or buggy batch cannot multiply itself inside one request."""
        event = _event(organization)
        _post(
            {
                "impressions": [str(event.id)] * 30,
                "views": [
                    {"event_id": str(event.id), "source": "direct"},
                    {"event_id": str(event.id), "source": "feed"},
                ],
            }
        )
        row = _day(event)
        assert row.impressions == 1
        assert row.views == 1
        # The press on the card wins: it is the fact click-through measures.
        assert row.feed_views == 1

    def test_a_view_from_another_city_is_located_but_not_local(self, organization):
        event = _event(organization, city="Mumbai")
        _post({"views": [{"event_id": str(event.id)}], "city": "Pune"})
        row = _day(event)
        assert (row.located_views, row.local_views) == (1, 0)

    def test_all_cities_is_no_choice_at_all(self, organization):
        event = _event(organization)
        _post({"views": [{"event_id": str(event.id)}], "city": None})
        row = _day(event)
        assert (row.views, row.located_views, row.local_views) == (1, 0, 0)

    def test_impressions_never_carry_a_city(self, organization):
        """ "Where are people looking at this from" is asked of people who opened
        it, not of everybody who scrolled past a card."""
        event = _event(organization)
        _post({"impressions": [str(event.id)], "city": "Mumbai"})
        row = _day(event)
        assert (row.impressions, row.located_views, row.local_views) == (1, 0, 0)

    def test_unknown_deleted_and_draft_ids_are_dropped_without_failing_the_batch(
        self, organization
    ):
        live = _event(organization)
        gone = _event(organization, deleted=True)
        draft = _event(organization, status=EventStatus.DRAFT)
        response = _post(
            {"impressions": [str(live.id), str(gone.id), str(draft.id), str(uuid.uuid4())]}
        )
        assert response.status_code == 204
        assert list(EventEngagementDay.objects.values_list("event_id", flat=True)) == [live.id]

    def test_a_cancelled_event_still_counts(self, organization):
        """A cancelled event keeps its page on purpose, so a view of it is real."""
        event = _event(organization, status=EventStatus.CANCELLED)
        _post({"views": [{"event_id": str(event.id)}]})
        assert _day(event).views == 1

    def test_a_machine_is_answered_and_counted_as_nothing(self, organization):
        event = _event(organization)
        for agent in (
            "Googlebot/2.1 (+http://www.google.com/bot.html)",
            "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0 Safari/537.36",
            "facebookexternalhit/1.1",
            "",
        ):
            assert _post({"views": [{"event_id": str(event.id)}]}, agent=agent).status_code == 204
        assert not EventEngagementDay.objects.exists()

    def test_a_stale_token_does_not_lose_the_view(self, organization):
        """The beacon takes no credentials, so an expired access token on a
        signed-in reader's tab is ignored rather than answered with a 401."""
        event = _event(organization)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION="Bearer not-a-real-token")
        assert _post({"views": [{"event_id": str(event.id)}]}, client=client).status_code == 204
        assert _day(event).views == 1

    def test_the_batch_is_bounded(self, organization):
        event = _event(organization)
        assert _post({"impressions": [str(uuid.uuid4()) for _ in range(101)]}).status_code == 400
        assert _post({"views": [{"event_id": str(event.id)}] * 21}).status_code == 400
        assert _post({"views": [{"event_id": str(event.id), "source": "email"}]}).status_code == 400
        assert not EventEngagementDay.objects.exists()

    def test_an_empty_beacon_writes_nothing(self):
        assert _post({}).status_code == 204
        assert not EventEngagementDay.objects.exists()


class TestHelpers:
    def test_the_city_comparison_ignores_case_and_surrounding_space(self):
        assert same_city(" mumbai", "Mumbai ")
        assert not same_city("Mumbai", "Pune")
        assert not same_city(None, "Mumbai")
        assert not same_city("Mumbai", "")

    def test_machines_and_missing_agents_are_automated(self):
        assert is_automated("")
        assert is_automated("Mozilla/5.0 (compatible; bingbot/2.0)")
        assert not is_automated(BROWSER)


@pytest.mark.django_db
def test_a_view_lands_on_the_platform_day_not_the_utc_one(organization):
    """23:30 UTC on the 1st is 05:00 on the 2nd in IST. A view is counted on the
    Indian day, which is the day the organizer's dashboard calls today."""
    event = _event(organization)
    late_utc = dt.datetime(2026, 9, 1, 23, 30, tzinfo=dt.timezone.utc)
    service = EngagementService(engagement=EventEngagementRepository(), clock=lambda: late_utc)
    service.record(impressions=[event.id], views=[])
    assert _day(event).date == dt.date(2026, 9, 2)
