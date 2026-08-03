"""Saved events.

The behaviour that matters is not "a row is written" — it is that the toggle
is IDEMPOTENT and that the anonymous-to-signed-in merge works, because saving
is deliberately available before anybody has an account.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.events.models import Event, EventStatus, SavedEvent
from apps.organizations.models import Organization

pytestmark = pytest.mark.django_db


@pytest.fixture
def user() -> User:
    person = User.objects.create_user(email="saver@example.com", password="SaverPass!23456")
    person.email_verified = True
    person.save(update_fields=["email_verified"])
    return person


@pytest.fixture
def events(user: User) -> list[Event]:
    org = Organization.objects.create(owner=user, name="Saved Co")
    return [
        Event.objects.create(
            organization=org,
            title=f"Event {index}",
            venue="Arena",
            city="Mumbai",
            starts_at=timezone.now() + dt.timedelta(days=10 + index),
            status=EventStatus.LIVE,
        )
        for index in range(3)
    ]


def auth(person: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=person)
    return client


class TestSavingIsIdempotent:
    def test_saving_the_same_event_twice_writes_one_row(self, user, events):
        """The heart can double-fire on a slow connection. A unique constraint
        makes the second press a no-op instead of a duplicate."""
        client = auth(user)
        client.post("/api/v1/me/saved-events", {"event_ids": [str(events[0].id)]}, format="json")
        response = client.post(
            "/api/v1/me/saved-events", {"event_ids": [str(events[0].id)]}, format="json"
        )

        assert response.status_code == 200
        assert SavedEvent.objects.filter(user=user, event=events[0]).count() == 1

    def test_unsaving_something_never_saved_is_still_a_204(self, user, events):
        """The caller's intent is "this should not be saved", which is true
        either way. A 404 would make the UI explain a state nobody is in."""
        response = auth(user).delete(f"/api/v1/me/saved-events/{events[0].id}")
        assert response.status_code == 204

    def test_a_save_can_be_undone(self, user, events):
        client = auth(user)
        client.post("/api/v1/me/saved-events", {"event_ids": [str(events[0].id)]}, format="json")
        client.delete(f"/api/v1/me/saved-events/{events[0].id}")

        assert not SavedEvent.objects.filter(user=user).exists()


class TestTheAnonymousMerge:
    """Saving is available BEFORE sign-in — a heart that demands an account
    removes the affordance for exactly the people still deciding to make one.
    The browser keeps them locally and hands the set over on sign-in."""

    def test_a_whole_local_set_merges_in_one_call(self, user, events):
        response = auth(user).post(
            "/api/v1/me/saved-events",
            {"event_ids": [str(event.id) for event in events]},
            format="json",
        )

        assert response.status_code == 200
        assert len(response.json()["event_ids"]) == 3

    def test_the_merge_is_safe_over_things_already_saved(self, user, events):
        """A week-old local set overlaps whatever the account already has.
        Merging must not fail or duplicate."""
        client = auth(user)
        client.post("/api/v1/me/saved-events", {"event_ids": [str(events[0].id)]}, format="json")

        response = client.post(
            "/api/v1/me/saved-events",
            {"event_ids": [str(event.id) for event in events]},
            format="json",
        )

        assert response.status_code == 200
        assert SavedEvent.objects.filter(user=user).count() == 3

    def test_the_response_carries_the_whole_set_not_just_the_change(self, user, events):
        """So the client replaces its local state outright instead of
        reconciling — which is what makes the merge one call."""
        client = auth(user)
        client.post("/api/v1/me/saved-events", {"event_ids": [str(events[0].id)]}, format="json")
        response = client.post(
            "/api/v1/me/saved-events", {"event_ids": [str(events[1].id)]}, format="json"
        )

        returned = set(response.json()["event_ids"])
        assert returned == {str(events[0].id), str(events[1].id)}

    def test_an_empty_merge_is_accepted(self, user):
        """Somebody who never saved anything still signs in."""
        response = auth(user).post("/api/v1/me/saved-events", {"event_ids": []}, format="json")
        assert response.status_code == 200
        assert response.json()["event_ids"] == []

    def test_an_unbounded_list_is_refused(self, user):
        """An authenticated endpoint that loops over whatever it is handed is
        an unbounded write."""
        response = auth(user).post(
            "/api/v1/me/saved-events",
            {"event_ids": [str(events_id) for events_id in range(500)]},
            format="json",
        )
        assert response.status_code == 400


class TestReading:
    def test_the_list_is_newest_first(self, user, events):
        client = auth(user)
        for event in events:
            client.post("/api/v1/me/saved-events", {"event_ids": [str(event.id)]}, format="json")

        titles = [row["title"] for row in client.get("/api/v1/me/saved-events").json()["data"]]
        assert titles == ["Event 2", "Event 1", "Event 0"]

    def test_a_saved_event_that_is_no_longer_on_sale_still_appears(self, user, events):
        """Hiding it would look like the save was lost. The card reports that
        it is unavailable instead of offering a dead Book button."""
        client = auth(user)
        client.post("/api/v1/me/saved-events", {"event_ids": [str(events[0].id)]}, format="json")
        Event.objects.filter(pk=events[0].id).update(status=EventStatus.DRAFT)

        row = client.get("/api/v1/me/saved-events").json()["data"][0]
        assert row["id"] == str(events[0].id)
        assert row["is_available"] is False

    def test_the_list_is_one_query_per_page_not_one_per_row(
        self, user, events, django_assert_num_queries
    ):
        """N+1 on a saved list is the easiest regression to introduce and the
        least visible — it only hurts the people who saved the most."""
        client = auth(user)
        client.post(
            "/api/v1/me/saved-events",
            {"event_ids": [str(event.id) for event in events]},
            format="json",
        )

        # ONE query for the whole page: the saved rows with their event and
        # organization joined. (No auth lookup to pay for — `force_authenticate`
        # sets the user directly, which is why this is 1 and not 2.)
        with django_assert_num_queries(1):
            client.get("/api/v1/me/saved-events")

    def test_deleting_an_event_removes_it_from_saved_lists(self, user, events):
        """CASCADE, not PROTECT: a saved row means nothing without its event,
        and unlike a booking it is not a financial record anyone must keep."""
        auth(user).post(
            "/api/v1/me/saved-events", {"event_ids": [str(events[0].id)]}, format="json"
        )
        events[0].delete()

        assert not SavedEvent.objects.filter(user=user).exists()


class TestAccess:
    def test_anonymous_cannot_read_a_saved_list(self):
        assert APIClient().get("/api/v1/me/saved-events").status_code == 401

    def test_one_account_cannot_see_anothers_saves(self, user, events):
        auth(user).post(
            "/api/v1/me/saved-events", {"event_ids": [str(events[0].id)]}, format="json"
        )
        other = User.objects.create_user(email="other@example.com", password="OtherPass!23456")

        assert auth(other).get("/api/v1/me/saved-events").json()["data"] == []

    def test_the_list_is_never_shared_cached(self, user):
        """Per-user data behind a shared cache is one person's saves served to
        another."""
        response = auth(user).get("/api/v1/me/saved-events")
        assert "no-store" in response["Cache-Control"]
