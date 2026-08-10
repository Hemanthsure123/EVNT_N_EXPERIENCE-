"""`Event.category` — the browse taxonomy as a column rather than a guess.

Category filtering used to be a keyword pushed through the full-text index: the
"Comedy" tile searched the stem `comedy`, so it matched an event whose
DESCRIPTION happened to mention a comedian and missed a stand-up night whose
copy never used the word. The frontend inferred a card's chip from its title
and rendered nothing when nothing matched.

The two properties worth pinning are that the filter is now EXACT, and that it
composes with `q` instead of competing with it for the same tsquery.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.events.models import Event, EventCategory, EventStatus
from apps.organizations.models import Organization

LIST = "/api/v1/events"


@pytest.fixture
def world(db):
    owner = User.objects.create_user(email="cat-owner@example.com", password="owner12345")
    org = Organization.objects.create(owner=owner, name="Cat Co")

    def make(title: str, category: str, description: str = "") -> Event:
        return Event.objects.create(
            organization=org,
            title=title,
            description=description,
            venue="V",
            city="Mumbai",
            starts_at=timezone.now() + dt.timedelta(days=5),
            status=EventStatus.LIVE,
            category=category,
        )

    return {
        "owner": owner,
        "org": org,
        # A stand-up night whose copy never says "comedy" — the event the old
        # keyword filter MISSED.
        "standup": make("Saturday Night Mic", EventCategory.COMEDY, "An evening of laughs."),
        # A concert whose description happens to mention a comedian — the event
        # the old keyword filter wrongly INCLUDED.
        "concert": make(
            "Indie Night", EventCategory.CONCERTS, "Support set by a comedy act, then bands."
        ),
        "uncategorised": make("Mystery Event", ""),
        "make": make,
    }


@pytest.mark.django_db
class TestFiltering:
    def test_it_finds_the_event_the_keyword_search_MISSED(self, world):
        """Its copy never uses the word "comedy"."""
        body = APIClient().get(f"{LIST}?category=comedy").json()
        titles = [row["title"] for row in body["data"]]
        assert titles == ["Saturday Night Mic"]

    def test_it_excludes_the_event_the_keyword_search_WRONGLY_INCLUDED(self, world):
        """A concert whose description mentions a comedy act is not comedy."""
        body = APIClient().get(f"{LIST}?category=comedy").json()
        assert "Indie Night" not in [row["title"] for row in body["data"]]

    def test_an_uncategorised_event_matches_no_category(self, world):
        for slug in ("comedy", "concerts", "tech"):
            body = APIClient().get(f"{LIST}?category={slug}").json()
            assert "Mystery Event" not in [row["title"] for row in body["data"]]

    def test_it_composes_with_a_text_search_rather_than_competing(self, world):
        """The old approach spent the tsquery ON the category, so `q` and the
        category fought for the same slot. Now `q` means what the user typed."""
        body = APIClient().get(f"{LIST}?category=concerts&q=Indie").json()
        assert [row["title"] for row in body["data"]] == ["Indie Night"]

        # ...and a text term that matches nothing IN that category returns
        # nothing, rather than falling back to the whole category.
        empty = APIClient().get(f"{LIST}?category=concerts&q=Saturday").json()
        assert empty["data"] == []

    def test_it_composes_with_city(self, world):
        make = world["make"]
        other = make("Delhi Laughs", EventCategory.COMEDY)
        Event.objects.filter(pk=other.id).update(city="Delhi")

        body = APIClient().get(f"{LIST}?category=comedy&city=Mumbai").json()
        assert [row["title"] for row in body["data"]] == ["Saturday Night Mic"]

    def test_an_unknown_category_is_treated_as_ABSENT_not_as_an_error(self, world):
        """These params come from links people share and hand-edit. The view is
        already scoped safely, so the worst an unrecognised value can do is
        widen the list — and a browse page that 400s because a stale link
        carries a retired slug is worse than one showing extra results."""
        resp = APIClient().get(f"{LIST}?category=not-a-real-category")
        assert resp.status_code == 200

    def test_a_blank_category_is_ignored(self, world):
        body = APIClient().get(f"{LIST}?category=").json()
        assert len(body["data"]) == 3


@pytest.mark.django_db
class TestOnTheWire:
    def test_a_card_carries_its_category(self, world):
        """So the chip is READ rather than inferred from the title by keyword —
        which is why the frontend used to render nothing when nothing matched.
        """
        body = APIClient().get(LIST).json()
        rows = {row["title"]: row for row in body["data"]}
        assert rows["Saturday Night Mic"]["category"] == "comedy"

    def test_an_uncategorised_card_says_so_with_a_blank_rather_than_omitting_it(self, world):
        body = APIClient().get(LIST).json()
        rows = {row["title"]: row for row in body["data"]}
        assert rows["Mystery Event"]["category"] == ""

    def test_the_detail_carries_it_too(self, world):
        body = APIClient().get(f"{LIST}/{world['standup'].id}").json()
        assert body["category"] == "comedy"

    def test_listing_by_category_stays_within_its_query_budget(
        self, world, django_assert_num_queries
    ):
        """`category` must be in the repository's `.only()` set. Absent from it
        the column is DEFERRED, so every card re-fetches it — one extra query
        per row, which is the N+1 this budget exists to catch. It caught it."""
        client = APIClient()
        with django_assert_num_queries(1):
            client.get(f"{LIST}?category=comedy")


@pytest.mark.django_db
class TestEditing:
    def test_an_organizer_can_set_it(self, world, api_client=None):
        """A column the browse filters index MUST be reachable by a PATCH, or
        the taxonomy is decoration only a data migration could populate."""
        client = APIClient()
        client.force_authenticate(user=world["owner"])
        event = world["uncategorised"]

        resp = client.patch(
            f"/api/v1/events/{event.id}",
            {"version": event.version, "category": "festivals"},
            format="json",
        )

        assert resp.status_code == 200
        event.refresh_from_db()
        assert event.category == EventCategory.FESTIVALS

    def test_the_new_category_takes_effect_on_browse(
        self, world, django_capture_on_commit_callbacks
    ):
        client = APIClient()
        client.force_authenticate(user=world["owner"])
        event = world["uncategorised"]

        with django_capture_on_commit_callbacks(execute=True):
            client.patch(
                f"/api/v1/events/{event.id}",
                {"version": event.version, "category": "tech"},
                format="json",
            )

        body = APIClient().get(f"{LIST}?category=tech").json()
        assert [row["title"] for row in body["data"]] == ["Mystery Event"]


@pytest.mark.django_db
def test_the_slugs_match_the_frontends_exactly():
    """`frontend/lib/discovery/categories.ts` ships these eight slugs and the
    illustration set draws a scene per slug. Different strings here would need
    a translation table nobody maintains — and the first thing to break would
    be the artwork, silently, because an unknown slug falls back to the
    generic ticket.
    """
    assert {c.value for c in EventCategory} == {
        "concerts",
        "comedy",
        "workshops",
        "sports",
        "festivals",
        "nightlife",
        "food-drink",
        "tech",
        # Not a browse tile — an organiser choosing none of the eight, which is
        # a different fact from not having chosen yet (blank).
        "other",
    }
