from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.events.models import Event, EventStatus
from apps.organizations.models import VerifiedLevel


def _future_iso(days: int = 10) -> str:
    return (timezone.now() + timedelta(days=days)).isoformat()


# --- public browse / search ------------------------------------------------


@pytest.mark.django_db
def test_public_list_returns_only_published_upcoming(api_client, make_event):
    make_event(title="Live Upcoming", status=EventStatus.LIVE)
    make_event(title="A Draft", status=EventStatus.DRAFT)
    make_event(title="Past", status=EventStatus.LIVE, starts_at=timezone.now() - timedelta(days=1))

    resp = api_client.get("/api/v1/events")

    assert resp.status_code == 200
    titles = [e["title"] for e in resp.json()["data"]]
    assert titles == ["Live Upcoming"]


@pytest.mark.django_db
def test_public_list_is_edge_cacheable(api_client, make_event):
    make_event(status=EventStatus.LIVE)

    resp = api_client.get("/api/v1/events")

    assert resp.status_code == 200
    assert resp.headers["ETag"]
    cache_control = resp.headers["Cache-Control"]
    assert "public" in cache_control
    assert "s-maxage=" in cache_control
    assert "stale-while-revalidate=" in cache_control


@pytest.mark.django_db
def test_public_list_full_text_search(api_client, make_event):
    make_event(title="Sunburn Jazz Night", status=EventStatus.LIVE)
    make_event(title="Rock Marathon", status=EventStatus.LIVE)

    resp = api_client.get("/api/v1/events", {"q": "jazz"})

    titles = [e["title"] for e in resp.json()["data"]]
    assert titles == ["Sunburn Jazz Night"]


@pytest.mark.django_db
def test_public_list_city_filter(api_client, make_event):
    make_event(title="Mumbai Show", city="Mumbai", status=EventStatus.LIVE)
    make_event(title="Delhi Show", city="Delhi", status=EventStatus.LIVE)

    resp = api_client.get("/api/v1/events", {"city": "Delhi"})

    titles = [e["title"] for e in resp.json()["data"]]
    assert titles == ["Delhi Show"]


@pytest.mark.django_db
def test_public_list_cursor_pagination(api_client, make_event):
    for i in range(25):
        make_event(
            title=f"Event {i:02d}",
            status=EventStatus.LIVE,
            starts_at=timezone.now() + timedelta(days=i + 1),
        )

    resp = api_client.get("/api/v1/events", {"page_size": 10})

    body = resp.json()
    assert len(body["data"]) == 10
    assert body["meta"]["next"] is not None


@pytest.mark.django_db
def test_public_list_query_budget_cold_then_warm(api_client, make_event, django_assert_num_queries):
    # Two events across two orgs would expose an N+1 on organization name if
    # select_related were missing.
    make_event(title="One", status=EventStatus.LIVE)
    make_event(title="Two", status=EventStatus.LIVE)

    with django_assert_num_queries(1):  # unauthenticated: just the list query
        first = api_client.get("/api/v1/events")
    assert first.status_code == 200

    with django_assert_num_queries(0):  # served from cache
        second = api_client.get("/api/v1/events")
    assert second.json()["data"] == first.json()["data"]


# --- public detail ---------------------------------------------------------


@pytest.mark.django_db
def test_public_detail_returns_published_event_with_edge_headers(api_client, make_event):
    event = make_event(title="Detail Show", status=EventStatus.LIVE)

    resp = api_client.get(f"/api/v1/events/{event.id}")

    assert resp.status_code == 200
    assert resp.json()["title"] == "Detail Show"
    assert "public" in resp.headers["Cache-Control"]
    assert "s-maxage=" in resp.headers["Cache-Control"]
    assert resp.headers["ETag"]


@pytest.mark.django_db
def test_public_detail_hides_drafts(api_client, make_event):
    draft = make_event(status=EventStatus.DRAFT)

    resp = api_client.get(f"/api/v1/events/{draft.id}")

    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "event_not_found"


@pytest.mark.django_db
def test_public_detail_returns_304_on_matching_etag(api_client, make_event):
    event = make_event(status=EventStatus.LIVE)
    first = api_client.get(f"/api/v1/events/{event.id}")
    etag = first.headers["ETag"]

    second = api_client.get(f"/api/v1/events/{event.id}", HTTP_IF_NONE_MATCH=etag)

    assert second.status_code == 304


@pytest.mark.django_db
def test_public_detail_query_budget_cold_then_warm(
    api_client, make_event, django_assert_num_queries
):
    event = make_event(status=EventStatus.LIVE)
    url = f"/api/v1/events/{event.id}"

    with django_assert_num_queries(1):  # unauthenticated: just the event load
        assert api_client.get(url).status_code == 200

    with django_assert_num_queries(0):  # from Redis/locmem
        assert api_client.get(url).status_code == 200


@pytest.mark.django_db
def test_public_detail_reports_the_organizer_verification_honestly(
    api_client, make_event, unverified_organization, django_assert_num_queries
):
    """`organization_verified` is what lets the organiser card show a verified
    badge without inventing one — so it has to be TRUE only when an operator
    actually verified the organization, and false for `pending` as well as
    `unverified` (nobody has checked yet, either way).

    The budget assertion is the other half: it rides on the `select_related`
    join the org NAME already needs, and a field the serializer touches but the
    lean field set omits is a deferred load — one extra query per response,
    silently. That trap is exactly how adding three columns once turned this
    read from 1 query into 4.
    """
    verified = make_event(status=EventStatus.LIVE)
    unverified = make_event(status=EventStatus.LIVE, org=unverified_organization)

    with django_assert_num_queries(1):
        payload = api_client.get(f"/api/v1/events/{verified.id}").json()
    assert payload["organization_verified"] is True

    with django_assert_num_queries(1):
        other = api_client.get(f"/api/v1/events/{unverified.id}").json()
    assert other["organization_verified"] is False

    # `pending` is an internal review state, and to a buyer it means the same
    # thing as unverified: nobody has checked yet. It is deliberately not
    # exposed as a third value.
    unverified_organization.verified_level = VerifiedLevel.PENDING
    unverified_organization.save(update_fields=["verified_level"])
    in_review = make_event(status=EventStatus.LIVE, org=unverified_organization)

    assert api_client.get(f"/api/v1/events/{in_review.id}").json()["organization_verified"] is False


# --- create ----------------------------------------------------------------


@pytest.mark.django_db
def test_create_event_returns_201_draft(authed_client, organization):
    resp = authed_client.post(
        "/api/v1/events",
        {
            "organization_id": str(organization.id),
            "title": "New Event",
            "venue": "Hall",
            "city": "Pune",
            "starts_at": _future_iso(),
        },
        format="json",
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "draft"
    assert body["version"] == 1


@pytest.mark.django_db
def test_create_requires_authentication(api_client, organization):
    resp = api_client.post(
        "/api/v1/events",
        {
            "organization_id": str(organization.id),
            "title": "X",
            "venue": "V",
            "city": "C",
            "starts_at": _future_iso(),
        },
        format="json",
    )
    assert resp.status_code == 401


@pytest.mark.django_db
def test_create_under_someone_elses_org_is_403(api_client, organization, other_user, token_for):
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(other_user)}")

    resp = api_client.post(
        "/api/v1/events",
        {
            "organization_id": str(organization.id),
            "title": "X",
            "venue": "V",
            "city": "C",
            "starts_at": _future_iso(),
        },
        format="json",
    )

    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "not_event_owner"


@pytest.mark.django_db
def test_create_rejects_a_past_start(authed_client, organization):
    resp = authed_client.post(
        "/api/v1/events",
        {
            "organization_id": str(organization.id),
            "title": "X",
            "venue": "V",
            "city": "C",
            "starts_at": (timezone.now() - timedelta(days=1)).isoformat(),
        },
        format="json",
    )
    assert resp.status_code == 400


# --- patch / optimistic lock ----------------------------------------------


@pytest.mark.django_db
def test_patch_updates_and_bumps_version(authed_client, make_event):
    event = make_event(title="Old", status=EventStatus.DRAFT)

    resp = authed_client.patch(
        f"/api/v1/events/{event.id}", {"version": 1, "title": "New"}, format="json"
    )

    assert resp.status_code == 200
    assert resp.json()["title"] == "New"
    assert resp.json()["version"] == 2


@pytest.mark.django_db
def test_patch_with_stale_version_is_409(authed_client, make_event):
    event = make_event(title="Old", status=EventStatus.DRAFT)

    resp = authed_client.patch(
        f"/api/v1/events/{event.id}", {"version": 99, "title": "New"}, format="json"
    )

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "stale_event_version"


@pytest.mark.django_db
def test_patch_by_non_owner_is_403(api_client, make_event, other_user, token_for):
    event = make_event(status=EventStatus.DRAFT)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(other_user)}")

    resp = api_client.patch(
        f"/api/v1/events/{event.id}", {"version": 1, "title": "Hijacked"}, format="json"
    )

    assert resp.status_code == 403


@pytest.mark.django_db
def test_patch_live_event_invalidates_detail_cache(
    authed_client, make_event, django_capture_on_commit_callbacks
):
    event = make_event(title="Old Title", status=EventStatus.LIVE)
    api_client_get = f"/api/v1/events/{event.id}"
    authed_client.get(api_client_get)  # warm the detail cache

    with django_capture_on_commit_callbacks(execute=True):
        resp = authed_client.patch(
            api_client_get, {"version": 1, "title": "New Title"}, format="json"
        )
    assert resp.status_code == 200

    follow_up = authed_client.get(api_client_get)
    assert follow_up.json()["title"] == "New Title"


# --- publish ---------------------------------------------------------------


@pytest.mark.django_db
def test_publish_transitions_draft_to_live(authed_client, make_event, add_ticket_type):
    event = make_event(status=EventStatus.DRAFT)
    add_ticket_type(event)  # ticketing publish gate

    resp = authed_client.post(f"/api/v1/events/{event.id}/publish", format="json")

    assert resp.status_code == 200
    # Publishing now SUBMITS for review. Only an operator can make it live.
    assert resp.json()["status"] == "pending_review"


@pytest.mark.django_db
def test_publish_over_http_is_refused_for_an_unverified_organization(
    api_client, token_for, make_event, add_ticket_type, unverified_organization, other_user
):
    """The gate has to be here, not only in the dashboard.

    `POST /events/{id}/publish` is `IsAuthenticated` — a signed-in organizer
    whose organization nobody has approved can reach it with one curl, no
    matter what the frontend chooses to render. The envelope carries the level
    so the UI can say "waiting on us" rather than "go get verified".
    """
    event = make_event(status=EventStatus.DRAFT, org=unverified_organization)
    add_ticket_type(event)  # every other gate satisfied
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(other_user)}")

    resp = api_client.post(f"/api/v1/events/{event.id}/publish", format="json")

    assert resp.status_code == 403
    body = resp.json()["error"]
    assert body["code"] == "organization_not_verified"
    assert body["details"]["verified_level"] == "unverified"
    event.refresh_from_db()
    assert event.status == EventStatus.DRAFT


@pytest.mark.django_db
def test_publishing_does_not_make_the_event_public_until_an_operator_approves(
    authed_client,
    api_client,
    make_event,
    add_ticket_type,
    django_capture_on_commit_callbacks,
    django_user_model,
):
    """The moderation gate, end to end.

    The single most important test of the governance change: an organizer
    submitting an event must NOT put it in front of attendees. Only a platform
    operator's approval does that.
    """
    event = make_event(title="Soon Live", status=EventStatus.DRAFT)
    add_ticket_type(event)  # ticketing publish gate
    api_client.get("/api/v1/events")  # warm the (empty) public list cache

    with django_capture_on_commit_callbacks(execute=True):
        publish = authed_client.post(f"/api/v1/events/{event.id}/publish", format="json")
    assert publish.status_code == 200
    assert publish.json()["status"] == "pending_review"

    # Still invisible. The cache generation bumped, so this is a fresh read.
    listing = api_client.get("/api/v1/events")
    assert "Soon Live" not in [e["title"] for e in listing.json()["data"]]

    operator = django_user_model.objects.create_user(
        email="ops-mod@example.com", password="opspass12345", is_staff=True
    )
    staff_client = APIClient()
    staff_client.force_authenticate(user=operator)
    with django_capture_on_commit_callbacks(execute=True):
        decision = staff_client.post(
            f"/api/v1/admin/events/{event.id}/moderate", {"approve": True}, format="json"
        )
    assert decision.status_code == 200
    assert decision.json()["status"] == "live"

    listing = api_client.get("/api/v1/events")
    assert "Soon Live" in [e["title"] for e in listing.json()["data"]]


@pytest.mark.django_db
def test_publish_already_live_is_409(authed_client, make_event):
    event = make_event(status=EventStatus.LIVE)

    resp = authed_client.post(f"/api/v1/events/{event.id}/publish", format="json")

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "invalid_event_state"


@pytest.mark.django_db
def test_publish_a_past_draft_is_not_publishable(authed_client, make_event):
    event = make_event(status=EventStatus.DRAFT, starts_at=timezone.now() - timedelta(days=1))

    resp = authed_client.post(f"/api/v1/events/{event.id}/publish", format="json")

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "event_not_publishable"


# --- organizer dashboard ---------------------------------------------------


@pytest.mark.django_db
def test_organizer_list_includes_drafts_and_is_not_cacheable(authed_client, make_event):
    make_event(title="My Live", status=EventStatus.LIVE)
    make_event(title="My Draft", status=EventStatus.DRAFT)

    resp = authed_client.get("/api/v1/organizer/events")

    assert resp.status_code == 200
    titles = {e["title"] for e in resp.json()["data"]}
    assert {"My Live", "My Draft"} <= titles
    assert resp.headers["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
def test_organizer_list_requires_authentication(api_client):
    assert api_client.get("/api/v1/organizer/events").status_code == 401


@pytest.mark.django_db
def test_organizer_list_only_shows_my_events(authed_client, make_event, other_user):
    from apps.organizations.repositories import OrganizationRepository

    make_event(title="Mine", status=EventStatus.LIVE)
    rival = OrganizationRepository().create(owner_id=other_user.id, name="Rival")
    make_event(title="Theirs", status=EventStatus.LIVE, org=rival)

    resp = authed_client.get("/api/v1/organizer/events")

    titles = {e["title"] for e in resp.json()["data"]}
    assert titles == {"Mine"}


@pytest.mark.django_db
def test_organizer_list_query_budget(authed_client, make_event, django_assert_num_queries):
    make_event(title="A", status=EventStatus.LIVE)
    make_event(title="B", status=EventStatus.DRAFT)

    # auth user lookup + the list query; select_related keeps org name off the N+1 path.
    with django_assert_num_queries(2):
        resp = authed_client.get("/api/v1/organizer/events")
    assert resp.status_code == 200
    assert len(resp.json()["data"]) == 2


@pytest.mark.django_db
def test_event_rows_are_soft_deleted_never_hard_deleted(make_event):
    # Guard the invariant the indexes assume (partial on deleted_at IS NULL).
    event = make_event(status=EventStatus.LIVE)
    Event.objects.filter(pk=event.id).update(deleted_at=timezone.now())
    assert Event.objects.filter(pk=event.id).exists()


# ─────────────────────────────────────────────────────────────────────────────
# GET /events/sitemap — the crawler's index of every event page
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_sitemap_lists_only_publicly_visible_events(api_client, make_event):
    live = make_event(title="Live Show", status=EventStatus.LIVE)
    make_event(title="A Draft", status=EventStatus.DRAFT)
    make_event(title="Pending", status=EventStatus.PENDING_REVIEW)
    deleted = make_event(title="Deleted", status=EventStatus.LIVE)
    Event.objects.filter(pk=deleted.id).update(deleted_at=timezone.now())

    resp = api_client.get("/api/v1/events/sitemap")

    assert resp.status_code == 200
    ids = {row["id"] for row in resp.json()["data"]}
    assert ids == {str(live.id)}


@pytest.mark.django_db
def test_sitemap_includes_past_events_unlike_the_browse_list(api_client, make_event):
    # A past event's page still resolves, still carries its structured data,
    # and is still what somebody searching for last month's show should land
    # on. The browse list bounds itself to upcoming; this must not.
    past = make_event(
        title="Last Month", status=EventStatus.LIVE, starts_at=timezone.now() - timedelta(days=30)
    )

    resp = api_client.get("/api/v1/events/sitemap")

    assert str(past.id) in {row["id"] for row in resp.json()["data"]}


@pytest.mark.django_db
def test_sitemap_carries_the_slug_and_a_real_updated_at(api_client, make_event):
    make_event(title="Sunburn Arena 2026", status=EventStatus.LIVE)

    row = api_client.get("/api/v1/events/sitemap").json()["data"][0]

    assert row["slug"] == "sunburn-arena-2026"
    # `lastModified` is the point of this endpoint as much as the URL is: the
    # sitemap used to stamp the build time on every entry, which tells a
    # crawler that everything changed at once and nothing in particular is
    # worth re-fetching.
    assert row["updated_at"]


@pytest.mark.django_db
def test_sitemap_is_public_and_edge_cacheable(api_client, make_event):
    make_event(status=EventStatus.LIVE)

    resp = api_client.get("/api/v1/events/sitemap")

    assert resp.status_code == 200  # no auth
    cache_control = resp.headers["Cache-Control"]
    assert "public" in cache_control
    assert "s-maxage=3600" in cache_control
    assert resp.headers["ETag"]


@pytest.mark.django_db
def test_sitemap_query_budget(api_client, make_event, django_assert_num_queries):
    for i in range(5):
        make_event(title=f"Show {i}", status=EventStatus.LIVE)

    # ONE query for the whole document — no auth lookup (it is public), no
    # per-row join. Three columns off one partial index.
    with django_assert_num_queries(1):
        resp = api_client.get("/api/v1/events/sitemap")
    assert len(resp.json()["data"]) == 5


@pytest.mark.django_db
def test_sitemap_route_is_not_shadowed_by_the_detail_route(api_client, make_event):
    # An event titled "Sitemap" slugs to `sitemap`. It cannot reach this URL,
    # because the public path is `/events/{slug}-{uuid}` and the API's own
    # detail route is `<uuid:event_id>` — but the route ordering is asserted
    # here so a future looser converter cannot silently break it.
    make_event(title="Sitemap", status=EventStatus.LIVE)

    resp = api_client.get("/api/v1/events/sitemap")

    assert resp.status_code == 200
    assert isinstance(resp.json()["data"], list)


# ─────────────────────────────────────────────────────────────────────────────
# `slug` on the payloads that links are built from
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_slug_is_on_the_card_detail_and_organizer_payloads(authed_client, make_event):
    make_event(title="Comedy Night with Kanan Gill", status=EventStatus.LIVE)
    expected = "comedy-night-with-kanan-gill"

    card = authed_client.get("/api/v1/events").json()["data"][0]
    detail = authed_client.get(f"/api/v1/events/{card['id']}").json()
    organizer = authed_client.get("/api/v1/organizer/events").json()["data"][0]

    # The frontend CONCATENATES `{slug}-{id}`; it never re-derives the slug.
    # A slug computed independently on both sides eventually disagrees, and a
    # canonical tag that disagrees with the sitemap is an SEO fault nobody
    # notices for months.
    assert card["slug"] == expected
    assert detail["slug"] == expected
    assert organizer["slug"] == expected
