"""`Event.policies` — the organiser's own rules for their event.

Entry conditions, prohibited items, their refund terms, what happens if it
rains. Distinct from the PLATFORM policies the event page also renders (tickets
are signed QR codes, no card data is stored) — those are true of every event
and are not an organiser's to edit.

Two shape decisions this pins:

- A **JSON list**, not columns: the set is genuinely open, and any fixed schema
  would either force an organiser to leave a rule out or leave most events with
  empty fields.
- A **column**, not a related table like `EventFaq` alongside it: this list is
  written whole, read whole and never queried across events, so a table would
  buy per-row endpoints nobody would call and cost a join on the detail read —
  the hottest public query in the system. The last test guards that.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.events.models import Event, EventStatus
from apps.organizations.models import Organization

RULES = [
    {"title": "Carry a photo ID", "body": "Any government ID matching the booking name."},
    {"title": "No outside food", "body": "Bags are checked at the gate."},
]


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def world(db):
    owner = User.objects.create_user(email="pol-owner@example.com", password="owner12345")
    org = Organization.objects.create(owner=owner, name="Policy Co")
    event = Event.objects.create(
        organization=org,
        title="Rooftop Sundowner",
        venue="Aer",
        city="Mumbai",
        starts_at=timezone.now() + dt.timedelta(days=6),
        status=EventStatus.LIVE,
    )
    return {"owner": owner, "org": org, "event": event, "url": f"/api/v1/events/{event.id}"}


def patch(world, payload, user=None):
    world["event"].refresh_from_db()
    return auth(user or world["owner"]).patch(
        world["url"], {"version": world["event"].version, **payload}, format="json"
    )


@pytest.mark.django_db
class TestWriting:
    def test_an_organizer_sets_their_own_rules(self, world):
        """A column the event page renders must be reachable by a PATCH, or the
        field is decoration only a data migration could populate."""
        response = patch(world, {"policies": RULES})

        assert response.status_code == 200
        world["event"].refresh_from_db()
        assert world["event"].policies == RULES

    def test_the_list_is_replaced_WHOLESALE_not_merged(self, world):
        """These entries have no server identity to preserve, so there is
        nothing to diff and no per-row patch to get wrong."""
        patch(world, {"policies": RULES})
        patch(world, {"policies": [{"title": "Rain or shine", "body": "The show goes ahead."}]})

        world["event"].refresh_from_db()
        assert [rule["title"] for rule in world["event"].policies] == ["Rain or shine"]

    def test_an_empty_list_CLEARS_them(self, world):
        patch(world, {"policies": RULES})
        patch(world, {"policies": []})

        world["event"].refresh_from_db()
        assert world["event"].policies == []

    def test_omitting_the_field_leaves_them_alone(self, world):
        """An absent key is "not in this PATCH", which must not read as "clear
        it" — the details step saves other fields without touching this one."""
        patch(world, {"policies": RULES})
        patch(world, {"language": "Hindi, English"})

        world["event"].refresh_from_db()
        assert world["event"].policies == RULES

    def test_whitespace_is_trimmed(self, world):
        patch(world, {"policies": [{"title": "  Carry ID  ", "body": "  Any photo ID.  "}]})
        world["event"].refresh_from_db()
        assert world["event"].policies == [{"title": "Carry ID", "body": "Any photo ID."}]


@pytest.mark.django_db
class TestWhatIsRefused:
    def test_a_title_with_no_body_is_refused(self, world):
        """A heading an attendee cannot act on — "Entry policy", and then what?"""
        response = patch(world, {"policies": [{"title": "Entry policy", "body": ""}]})
        assert response.status_code == 400

    def test_a_body_with_no_title_is_refused(self, world):
        response = patch(world, {"policies": [{"title": "", "body": "Bags are checked."}]})
        assert response.status_code == 400

    def test_whitespace_only_is_refused_rather_than_stored_as_a_blank_row(self, world):
        """It would render as an empty row and read as a rendering fault."""
        response = patch(world, {"policies": [{"title": "   ", "body": "   "}]})
        assert response.status_code == 400

    def test_more_than_the_cap_is_refused(self, world):
        """A page of rules is not a policy section, it is a document nobody
        reads — and the page renders them all, because a policy behind a "show
        more" is one an attendee will say they were never told."""
        too_many = [{"title": f"Rule {n}", "body": "Body."} for n in range(13)]
        response = patch(world, {"policies": too_many})
        assert response.status_code == 400

    def test_exactly_the_cap_is_allowed(self, world):
        at_cap = [{"title": f"Rule {n}", "body": "Body."} for n in range(12)]
        assert patch(world, {"policies": at_cap}).status_code == 200

    def test_a_stranger_cannot_write_them(self, world):
        stranger = User.objects.create_user(email="nobody@example.com", password="member12345")
        response = patch(world, {"policies": RULES}, user=stranger)
        assert response.status_code in (403, 404)


@pytest.mark.django_db
class TestReading:
    def test_the_public_detail_carries_them(self, world, django_capture_on_commit_callbacks):
        with django_capture_on_commit_callbacks(execute=True):
            patch(world, {"policies": RULES})

        body = APIClient().get(world["url"]).json()
        assert body["policies"] == RULES

    def test_an_event_with_none_returns_an_empty_LIST_not_null(self, world):
        """So the page can render `policies.length` without a null guard, and a
        default of `[]` on the column is never shared between instances — the
        model uses the `list` callable for exactly that reason."""
        assert APIClient().get(world["url"]).json()["policies"] == []

    def test_the_detail_read_stays_at_ONE_query(
        self, world, django_assert_num_queries, django_capture_on_commit_callbacks
    ):
        """The whole argument for a column over a table. A related model would
        add a join or a prefetch to the hottest public query in the system, and
        `policies` must be in the repository's `.only()` set or reading it is a
        deferred load per row."""
        with django_capture_on_commit_callbacks(execute=True):
            patch(world, {"policies": RULES})

        client = APIClient()
        client.get(world["url"])  # warm the cache
        with django_assert_num_queries(0):
            client.get(world["url"])
