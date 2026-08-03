"""Featured cities and popular searches — the two curated lists.

Both are MERCHANDISING, not data the platform derives:

  * Featured cities are NOT the set of cities the platform supports. Every
    city with an event in it is already searchable and already has a landing
    page, because `Event.city` is a free string. This table is the handful an
    operator chose to promote.
  * "Popular" searches are what an operator wants to point people at, not a
    measurement. There is no search-term log, and a number invented from
    nothing is exactly what this codebase refuses to display elsewhere.

Both ride on the homepage payload rather than getting endpoints of their own,
so these also assert the caching behaviour that decision brings with it.

── EVERY TEST CREATES ITS OWN ROWS ──────────────────────────────────────

None of these assert the SEED MIGRATION's rows, even though there is one.
Django flushes the database after every `django_db(transaction=True)` test —
the concurrency suites — and that deletes data-migration rows permanently;
with `--reuse-db` (this project's default) they never come back. A test
leaning on them passes on a fresh database and fails on every run after, which
is exactly what happened when this file was first written.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.cms.models import FeaturedCity, PopularSearch
from config.di import cache_port

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _fresh_cache():
    cache_port.cache_clear()
    yield
    cache_port.cache_clear()


@pytest.fixture
def staff() -> User:
    return User.objects.create_user(
        email="curator@example.com", password="curatorpass12345", is_staff=True
    )


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def curated() -> None:
    """The rows each test needs, created here rather than assumed."""
    FeaturedCity.objects.all().delete()
    PopularSearch.objects.all().delete()
    FeaturedCity.objects.bulk_create(
        FeaturedCity(name=name, position=index)
        for index, name in enumerate(["Mumbai", "Delhi", "Bengaluru"])
    )
    PopularSearch.objects.bulk_create(
        PopularSearch(label=label, query=query, position=index)
        for index, (label, query) in enumerate(
            [("Live music", "concert"), ("Comedy nights", "comedy")]
        )
    )


class TestOrdering:
    def test_rows_arrive_display_ready(self, curated):
        """Model `ordering` is by position, so no caller has to know the sort."""
        names = list(FeaturedCity.objects.values_list("name", flat=True))
        assert names == ["Mumbai", "Delhi", "Bengaluru"]


class TestThePublicPayload:
    def test_both_lists_ride_on_the_homepage_response(self, curated):
        """One cached document, one invalidation — rather than two more
        endpoints for two short lists."""
        payload = APIClient().get("/api/v1/homepage").json()

        assert payload["featured_cities"]
        assert payload["popular_searches"]
        assert {"id", "label", "query"} <= set(payload["popular_searches"][0])

    def test_hidden_rows_are_absent_from_the_public_payload(self, curated):
        FeaturedCity.objects.update(is_visible=False)
        cache_port.cache_clear()

        payload = APIClient().get("/api/v1/homepage").json()
        assert payload["featured_cities"] == []

    def test_a_search_carries_its_query_separately_from_its_label(self, curated):
        """So a chip can read "Comedy nights" while querying the stem that
        actually matches rows."""
        row = PopularSearch.objects.get(label="Comedy nights")
        assert row.query == "comedy"
        assert row.query != row.label


class TestAdminCuration:
    def test_an_operator_can_add_a_city(self, staff):
        response = auth(staff).post(
            "/api/v1/admin/featured-cities",
            {"name": "Jaipur", "position": 9},
            format="json",
        )

        assert response.status_code == 201
        assert FeaturedCity.objects.filter(name="Jaipur").exists()

    def test_adding_a_city_twice_is_a_409_not_a_duplicate_tile(self, staff):
        auth(staff).post("/api/v1/admin/featured-cities", {"name": "Jaipur"}, format="json")
        again = auth(staff).post("/api/v1/admin/featured-cities", {"name": "Jaipur"}, format="json")

        assert again.status_code == 409
        assert FeaturedCity.objects.filter(name="Jaipur").count() == 1

    def test_two_searches_cannot_share_a_label(self, staff, curated):
        """A duplicated chip is a curation mistake, not a state the front page
        should be able to reach."""
        payload = {"label": "Live music", "query": "gig"}
        response = auth(staff).post("/api/v1/admin/popular-searches", payload, format="json")

        assert response.status_code == 409

    def test_reordering_shows_up_on_the_public_page(
        self, staff, curated, django_capture_on_commit_callbacks
    ):
        """The write must invalidate the homepage cache, or an operator's
        change is invisible until the TTL lapses.

        The invalidation runs in `transaction.on_commit` — deliberately, so a
        concurrent reader cannot repopulate the cache with pre-write data in
        the window before the write lands. Which means it does NOT fire under
        a plain `django_db` test, and asserting it needs this fixture.
        """
        last = FeaturedCity.objects.order_by("-position").first()
        assert last is not None
        APIClient().get("/api/v1/homepage")  # warm the cache

        with django_capture_on_commit_callbacks(execute=True):
            auth(staff).patch(
                f"/api/v1/admin/featured-cities/{last.id}", {"position": 0}, format="json"
            )

        payload = APIClient().get("/api/v1/homepage").json()
        assert payload["featured_cities"][0]["name"] == last.name

    def test_hiding_a_search_removes_it_from_the_panel(
        self, staff, curated, django_capture_on_commit_callbacks
    ):
        row = PopularSearch.objects.first()
        assert row is not None
        APIClient().get("/api/v1/homepage")

        with django_capture_on_commit_callbacks(execute=True):
            auth(staff).patch(
                f"/api/v1/admin/popular-searches/{row.id}", {"is_visible": False}, format="json"
            )

        labels = [
            item["label"] for item in APIClient().get("/api/v1/homepage").json()["popular_searches"]
        ]
        assert row.label not in labels

    def test_deleting_a_city_is_a_hard_delete(self, staff, curated):
        """Unlike Category, which archives. Nothing links to a featured city —
        the city's landing page resolves from `Event.city`, not from this row,
        so there is no bookmark to keep working."""
        city = FeaturedCity.objects.first()
        assert city is not None

        response = auth(staff).delete(f"/api/v1/admin/featured-cities/{city.id}")

        assert response.status_code == 204
        assert not FeaturedCity.objects.filter(pk=city.id).exists()

    def test_a_missing_row_is_a_404(self, staff):
        import uuid

        response = auth(staff).patch(
            f"/api/v1/admin/featured-cities/{uuid.uuid4()}", {"position": 1}, format="json"
        )
        assert response.status_code == 404


class TestAccess:
    @pytest.mark.parametrize(
        "path",
        ["/api/v1/admin/featured-cities", "/api/v1/admin/popular-searches"],
    )
    def test_anonymous_cannot_read_the_curation_lists(self, path):
        assert APIClient().get(path).status_code == 401

    @pytest.mark.parametrize(
        "path",
        ["/api/v1/admin/featured-cities", "/api/v1/admin/popular-searches"],
    )
    def test_an_ordinary_account_cannot_curate(self, path):
        member = User.objects.create_user(email="member@example.com", password="memberpass12345")
        assert auth(member).post(path, {}, format="json").status_code == 403
