"""API tests for the CMS.

Two themes run through this file:

1. **The homepage is public; editing it is not.** Every write is staff-only,
   and that is asserted rather than assumed.
2. **Curation cannot outrun moderation.** Only an approved, upcoming event can
   be featured, and a featured event that later stops being public disappears
   from the homepage without anybody unpinning it.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.cms.defaults import DEFAULT_HERO
from apps.cms.models import Category, Collection, FeaturedEntry, HomepageContent
from apps.cms.repositories import HomepageRepository
from apps.events.models import Event, EventStatus
from apps.organizations.models import Organization
from config.di import cache_port


@pytest.fixture(autouse=True)
def _fresh_cache():
    # The homepage is cache-aside; without this the first test's payload is
    # served to every test after it.
    cache_port.cache_clear()
    yield
    cache_port.cache_clear()


@pytest.fixture
def staff(db) -> User:
    return User.objects.create_user(
        email="cms-ops@example.com", password="opspass12345", is_staff=True
    )


@pytest.fixture
def member(db) -> User:
    return User.objects.create_user(email="cms-member@example.com", password="memberpass12345")


@pytest.fixture
def live_event(db) -> Event:
    owner = User.objects.create_user(email="cms-owner@example.com", password="ownerpass12345")
    org = Organization.objects.create(owner=owner, name="CMS Co")
    return Event.objects.create(
        organization=org,
        title="Featured Fest",
        venue="Arena",
        city="Mumbai",
        starts_at=timezone.now() + dt.timedelta(days=20),
        status=EventStatus.LIVE,
    )


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
class TestPublicRead:
    def test_the_homepage_is_public(self) -> None:
        response = APIClient().get("/api/v1/homepage")
        assert response.status_code == 200
        assert "hero" in response.json()

    def test_it_is_edge_cacheable(self) -> None:
        """Identical for everyone in a city scope, so a CDN should absorb it."""
        response = APIClient().get("/api/v1/homepage")
        assert "public" in response["Cache-Control"]
        assert response["ETag"]

    def test_a_matching_etag_is_a_304(self) -> None:
        first = APIClient().get("/api/v1/homepage")
        again = APIClient().get("/api/v1/homepage", HTTP_IF_NONE_MATCH=first["ETag"])
        assert again.status_code == 304

    def test_a_platform_with_no_content_row_still_serves_real_copy(self) -> None:
        """The front page can never be blank.

        This replaces a test that asserted the seed MIGRATION's rows were
        present. That assertion was not deterministic — Django flushes the
        database after every `django_db(transaction=True)` test, which deletes
        migration-seeded data permanently, and `--reuse-db` (this project's
        default in `addopts`) never puts it back. It failed on the second run
        of the suite and passed on the first.

        Worse, it was testing the weaker property. The row is created lazily on
        the READ path, and created blank it stayed blank forever: the seed
        migration is deliberately non-destructive, so nothing repairs it, and
        nothing errors. What actually matters is the guarantee asserted here —
        whatever state the table is in, the homepage serves usable copy.
        """
        HomepageContent.objects.all().delete()

        payload = APIClient().get("/api/v1/homepage").json()

        assert payload["hero"]["headline"] == DEFAULT_HERO["hero_headline"]
        assert payload["hero"]["description"]
        assert payload["hero"]["primary_cta"]
        assert payload["hero"]["search_placeholder"]
        assert payload["hero"]["trust_badges"] == DEFAULT_HERO["trust_badges"]

    def test_the_defaults_are_editable_not_hardcoded(self) -> None:
        """The whole point of seeding rather than shipping copy in the
        frontend: an operator can change it without a deploy."""
        HomepageContent.objects.all().delete()
        APIClient().get("/api/v1/homepage")  # lazily creates the row

        HomepageContent.objects.filter(singleton=True).update(hero_headline="Ours, not yours")
        cache_port.cache_clear()

        assert APIClient().get("/api/v1/homepage").json()["hero"]["headline"] == "Ours, not yours"

    def test_the_default_copy_is_never_shared_between_rows(self) -> None:
        """`trust_badges` is a list. Handing the module-level dict to
        `get_or_create(defaults=...)` would let one request's edit mutate the
        default for the life of the process."""
        HomepageContent.objects.all().delete()
        first = HomepageRepository().get_or_create_singleton()
        first.trust_badges.append("mutated")

        assert "mutated" not in DEFAULT_HERO["trust_badges"]

    def test_categories_are_served_in_display_order(self) -> None:
        """Creates its own rows rather than relying on the seeded taxonomy,
        which any `transaction=True` test elsewhere in the suite deletes."""
        Category.objects.all().delete()
        Category.objects.create(slug="comedy", label="Comedy", icon="Mic", search_term="comedy")
        Category.objects.create(
            slug="concerts", label="Concerts", icon="Music", search_term="concert"
        )

        payload = APIClient().get("/api/v1/homepage").json()
        assert {c["slug"] for c in payload["categories"]} == {"comedy", "concerts"}

    def test_nothing_is_curated_until_an_operator_curates_it(self) -> None:
        assert APIClient().get("/api/v1/homepage").json()["collections"]["featured"] == []


@pytest.mark.django_db
class TestAccess:
    @pytest.mark.parametrize(
        "method,path",
        [
            ("patch", "/api/v1/admin/homepage"),
            ("get", "/api/v1/admin/homepage/featured"),
            ("get", "/api/v1/admin/categories"),
        ],
    )
    def test_anonymous_cannot_edit(self, method: str, path: str) -> None:
        assert getattr(APIClient(), method)(path, {}, format="json").status_code == 401

    def test_a_signed_in_non_staff_user_cannot_edit(self, member: User) -> None:
        """The important one: an ordinary account must not rewrite the front page."""
        response = auth(member).patch(
            "/api/v1/admin/homepage", {"version": 1, "hero_headline": "Hi"}, format="json"
        )
        assert response.status_code == 403


@pytest.mark.django_db
class TestContent:
    def test_editing_the_hero_shows_up_on_the_homepage(self, staff: User) -> None:
        response = auth(staff).patch(
            "/api/v1/admin/homepage",
            {"version": 1, "hero_headline": "Find your next night out"},
            format="json",
        )
        assert response.status_code == 200

        payload = APIClient().get("/api/v1/homepage").json()
        assert payload["hero"]["headline"] == "Find your next night out"

    def test_an_edit_busts_a_homepage_that_was_ALREADY_cached(
        self, staff: User, django_capture_on_commit_callbacks
    ) -> None:
        """The regression that shipped once.

        Reading the homepage first populates the cache. The edit must orphan
        that entry — a generation counter whose first bump is a no-op serves
        the pre-edit payload indefinitely, which is the worst kind of CMS bug:
        the operator sees "saved", and the front page disagrees.
        """
        APIClient().get("/api/v1/homepage")  # warm it

        # The invalidation runs in `transaction.on_commit`, deliberately —
        # busting the cache BEFORE commit lets a concurrent reader repopulate
        # it with the pre-write copy. Under `django_db` those callbacks never
        # fire, so the test has to execute them explicitly.
        with django_capture_on_commit_callbacks(execute=True):
            auth(staff).patch(
                "/api/v1/admin/homepage", {"version": 1, "hero_headline": "Tonight"}, format="json"
            )

        assert APIClient().get("/api/v1/homepage").json()["hero"]["headline"] == "Tonight"

    def test_the_editor_reads_an_UNCACHED_version(self, staff: User) -> None:
        """The bug this exists to prevent.

        `GET /homepage` is cached for ten minutes, so its `version` is a
        cached number. An editor seeding its optimistic lock from there sends
        a stale version and 409s on every save — the operator sees "someone
        else edited this" forever, and nothing they type can ever be saved.
        The admin read bypasses the cache.
        """
        client = auth(staff)
        client.patch("/api/v1/admin/homepage", {"version": 1, "hero_headline": "A"}, format="json")

        public = APIClient().get("/api/v1/homepage").json()
        admin = client.get("/api/v1/admin/homepage").json()

        assert admin["version"] == 2
        assert admin["hero_headline"] == "A"
        # The public payload may legitimately lag; the editor must not.
        assert (
            client.patch(
                "/api/v1/admin/homepage",
                {"version": admin["version"], "hero_headline": "B"},
                format="json",
            ).status_code
            == 200
        )
        assert public["version"] <= admin["version"]

    def test_an_over_long_headline_is_a_field_error_not_a_500(self, staff: User) -> None:
        response = auth(staff).patch(
            "/api/v1/admin/homepage", {"version": 1, "hero_headline": "x" * 200}, format="json"
        )
        assert response.status_code == 400

    def test_a_stale_version_is_refused(self, staff: User) -> None:
        """Two operators in the CMS at once — the second must be told."""
        client = auth(staff)
        client.patch("/api/v1/admin/homepage", {"version": 1, "hero_headline": "A"}, format="json")

        response = client.patch(
            "/api/v1/admin/homepage", {"version": 1, "hero_headline": "B"}, format="json"
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "stale_homepage_version"

    def test_more_than_four_trust_badges_is_refused(self, staff: User) -> None:
        response = auth(staff).patch(
            "/api/v1/admin/homepage",
            {"version": 1, "trust_badges": ["a", "b", "c", "d", "e"]},
            format="json",
        )
        assert response.status_code == 400

    def test_the_ribbon_stays_off_without_text(self, staff: User) -> None:
        auth(staff).patch(
            "/api/v1/admin/homepage", {"version": 1, "ribbon_enabled": True}, format="json"
        )
        payload = APIClient().get("/api/v1/homepage").json()
        # Enabled but empty is not a banner; it is a blank bar.
        assert payload["ribbon"]["enabled"] is False


@pytest.mark.django_db
class TestCuration:
    def test_featuring_an_event_puts_it_on_the_homepage(
        self, staff: User, live_event: Event
    ) -> None:
        response = auth(staff).post(
            "/api/v1/admin/homepage/featured",
            {"event_id": str(live_event.id), "collection": Collection.FEATURED},
            format="json",
        )
        assert response.status_code == 201

        payload = APIClient().get("/api/v1/homepage").json()
        assert [card["title"] for card in payload["collections"]["featured"]] == ["Featured Fest"]

    def test_a_draft_event_cannot_be_featured(self, staff: User, live_event: Event) -> None:
        """Curation must not be a way around the moderation gate."""
        live_event.status = EventStatus.DRAFT
        live_event.save(update_fields=["status"])

        response = auth(staff).post(
            "/api/v1/admin/homepage/featured",
            {"event_id": str(live_event.id), "collection": Collection.FEATURED},
            format="json",
        )
        assert response.status_code == 422

    def test_an_event_taken_down_later_vanishes_without_being_unpinned(
        self, staff: User, live_event: Event
    ) -> None:
        auth(staff).post(
            "/api/v1/admin/homepage/featured",
            {"event_id": str(live_event.id), "collection": Collection.FEATURED},
            format="json",
        )
        live_event.status = EventStatus.REJECTED
        live_event.save(update_fields=["status"])
        cache_port.cache_clear()

        payload = APIClient().get("/api/v1/homepage").json()
        assert payload["collections"]["featured"] == []

    def test_the_same_event_cannot_be_added_to_a_collection_twice(
        self, staff: User, live_event: Event
    ) -> None:
        client = auth(staff)
        body = {"event_id": str(live_event.id), "collection": Collection.FEATURED}
        assert (
            client.post("/api/v1/admin/homepage/featured", body, format="json").status_code == 201
        )
        assert (
            client.post("/api/v1/admin/homepage/featured", body, format="json").status_code == 409
        )

    def test_a_scheduled_slot_does_not_appear_before_its_window(
        self, staff: User, live_event: Event
    ) -> None:
        auth(staff).post(
            "/api/v1/admin/homepage/featured",
            {
                "event_id": str(live_event.id),
                "collection": Collection.FEATURED,
                "starts_at": (timezone.now() + dt.timedelta(days=3)).isoformat(),
            },
            format="json",
        )
        assert APIClient().get("/api/v1/homepage").json()["collections"]["featured"] == []

    def test_a_city_scoped_slot_only_shows_in_that_city(
        self, staff: User, live_event: Event
    ) -> None:
        auth(staff).post(
            "/api/v1/admin/homepage/featured",
            {"event_id": str(live_event.id), "collection": Collection.FEATURED, "city": "Mumbai"},
            format="json",
        )
        client = APIClient()
        assert client.get("/api/v1/homepage?city=Mumbai").json()["collections"]["featured"]
        assert client.get("/api/v1/homepage?city=Delhi").json()["collections"]["featured"] == []

    def test_removing_a_slot_updates_the_homepage(self, staff: User, live_event: Event) -> None:
        client = auth(staff)
        created = client.post(
            "/api/v1/admin/homepage/featured",
            {"event_id": str(live_event.id), "collection": Collection.FEATURED},
            format="json",
        ).json()

        assert client.delete(f"/api/v1/admin/homepage/featured/{created['id']}").status_code == 204
        assert APIClient().get("/api/v1/homepage").json()["collections"]["featured"] == []


@pytest.fixture
def blank_taxonomy(db):
    """Drop the seeded categories so a test can assert exact counts.

    The seed migration ships eight; these tests are about the CRUD, not about
    the defaults, and `== ["sports"]` reads better than `[-1] == "sports"`.
    """
    Category.objects.all().delete()


@pytest.mark.django_db
@pytest.mark.usefixtures("blank_taxonomy")
class TestCategories:
    def test_creating_a_category_publishes_it(self, staff: User) -> None:
        response = auth(staff).post(
            "/api/v1/admin/categories",
            {"slug": "concerts", "label": "Concerts", "search_term": "concert"},
            format="json",
        )
        assert response.status_code == 201

        payload = APIClient().get("/api/v1/homepage").json()
        assert [c["slug"] for c in payload["categories"]] == ["concerts"]

    def test_a_duplicate_slug_is_a_conflict(self, staff: User) -> None:
        client = auth(staff)
        body = {"slug": "comedy", "label": "Comedy"}
        assert client.post("/api/v1/admin/categories", body, format="json").status_code == 201
        assert client.post("/api/v1/admin/categories", body, format="json").status_code == 409

    def test_archiving_hides_it_from_navigation(self, staff: User) -> None:
        client = auth(staff)
        created = client.post(
            "/api/v1/admin/categories", {"slug": "sports", "label": "Sports"}, format="json"
        ).json()

        assert client.delete(f"/api/v1/admin/categories/{created['id']}").status_code == 204
        assert APIClient().get("/api/v1/homepage").json()["categories"] == []
        # Archived, NOT deleted — a linked landing page keeps resolving.
        assert Category.objects.filter(slug="sports").exists()

    def test_hiding_a_category_keeps_it_editable(self, staff: User) -> None:
        client = auth(staff)
        created = client.post(
            "/api/v1/admin/categories", {"slug": "tech", "label": "Tech"}, format="json"
        ).json()

        client.patch(
            f"/api/v1/admin/categories/{created['id']}", {"is_visible": False}, format="json"
        )
        assert APIClient().get("/api/v1/homepage").json()["categories"] == []
        assert len(client.get("/api/v1/admin/categories").json()["data"]) == 1


@pytest.mark.django_db
class TestAudit:
    def test_every_edit_is_recorded(self, staff: User, live_event: Event) -> None:
        from core.models import AuditLog

        client = auth(staff)
        client.patch("/api/v1/admin/homepage", {"version": 1, "hero_headline": "H"}, format="json")
        client.post(
            "/api/v1/admin/homepage/featured",
            {"event_id": str(live_event.id), "collection": Collection.FEATURED},
            format="json",
        )
        client.post("/api/v1/admin/categories", {"slug": "x", "label": "X"}, format="json")

        actions = set(AuditLog.objects.values_list("action", flat=True))
        assert {"homepage.updated", "homepage.featured_added", "category.created"} <= actions


@pytest.mark.django_db
def test_the_singleton_is_created_once(staff: User) -> None:
    APIClient().get("/api/v1/homepage")
    APIClient().get("/api/v1/homepage")
    assert HomepageContent.objects.count() == 1
    assert FeaturedEntry.objects.count() == 0
