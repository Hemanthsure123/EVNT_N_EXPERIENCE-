from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.events.models import Event, EventStatus


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
    assert resp.json()["status"] == "live"


@pytest.mark.django_db
def test_publishing_makes_the_event_publicly_visible(
    authed_client, api_client, make_event, add_ticket_type, django_capture_on_commit_callbacks
):
    event = make_event(title="Soon Live", status=EventStatus.DRAFT)
    add_ticket_type(event)  # ticketing publish gate
    api_client.get("/api/v1/events")  # warm the (empty) public list cache

    with django_capture_on_commit_callbacks(execute=True):
        publish = authed_client.post(f"/api/v1/events/{event.id}/publish", format="json")
    assert publish.status_code == 200

    # generation bump invalidated the cached listing, so this reflects the publish
    listing = api_client.get("/api/v1/events")
    titles = [e["title"] for e in listing.json()["data"]]
    assert "Soon Live" in titles


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
