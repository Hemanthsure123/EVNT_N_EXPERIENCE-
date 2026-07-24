from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.events.repositories import EventRepository


def _draft_event(organization):
    return EventRepository().create(
        organization_id=organization.id,
        title="Draft Concert",
        venue="Hall",
        city="Pune",
        starts_at=timezone.now() + timedelta(days=20),
    )


# --- create tier -----------------------------------------------------------


@pytest.mark.django_db
def test_create_ticket_type_returns_201(authed_client, event):
    resp = authed_client.post(
        f"/api/v1/events/{event.id}/ticket-types",
        {"name": "Gold", "price": 5000, "quantity": 50, "max_per_order": 6},
        format="json",
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Gold"
    assert body["price"] == 5000
    assert body["available"] == 50
    assert body["version"] == 1


@pytest.mark.django_db
def test_create_ticket_type_requires_authentication(api_client, event):
    resp = api_client.post(
        f"/api/v1/events/{event.id}/ticket-types",
        {"name": "Gold", "price": 5000, "quantity": 50},
        format="json",
    )
    assert resp.status_code == 401


@pytest.mark.django_db
def test_create_ticket_type_by_non_owner_is_403(api_client, event, other_user, token_for):
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(other_user)}")

    resp = api_client.post(
        f"/api/v1/events/{event.id}/ticket-types",
        {"name": "Gold", "price": 5000, "quantity": 50},
        format="json",
    )

    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "not_ticket_type_owner"


@pytest.mark.django_db
def test_create_ticket_type_rejects_zero_quantity(authed_client, event):
    resp = authed_client.post(
        f"/api/v1/events/{event.id}/ticket-types",
        {"name": "Gold", "price": 5000, "quantity": 0},
        format="json",
    )
    assert resp.status_code == 400


# --- public tier list ------------------------------------------------------


@pytest.mark.django_db
def test_public_tier_list_is_edge_cacheable(api_client, event, make_ticket_type):
    make_ticket_type(name="Gold", price_minor=5000, quantity=50)

    resp = api_client.get(f"/api/v1/events/{event.id}/ticket-types")

    assert resp.status_code == 200
    assert [t["name"] for t in resp.json()["data"]] == ["Gold"]
    assert "public" in resp.headers["Cache-Control"]
    assert "s-maxage=" in resp.headers["Cache-Control"]
    assert resp.headers["ETag"]


@pytest.mark.django_db
def test_public_tier_list_returns_304_on_matching_etag(api_client, event, make_ticket_type):
    make_ticket_type()
    first = api_client.get(f"/api/v1/events/{event.id}/ticket-types")
    etag = first.headers["ETag"]

    second = api_client.get(f"/api/v1/events/{event.id}/ticket-types", HTTP_IF_NONE_MATCH=etag)

    assert second.status_code == 304


@pytest.mark.django_db
def test_public_tier_list_query_budget_cold_then_warm(
    api_client, event, make_ticket_type, django_assert_num_queries
):
    make_ticket_type(name="A", price_minor=1000)
    make_ticket_type(name="B", price_minor=2000)
    url = f"/api/v1/events/{event.id}/ticket-types"

    with django_assert_num_queries(1):  # unauthenticated: just the tier list
        assert api_client.get(url).status_code == 200

    with django_assert_num_queries(0):  # served from cache
        assert api_client.get(url).status_code == 200


# --- patch tier ------------------------------------------------------------


@pytest.mark.django_db
def test_patch_ticket_type_updates_and_bumps_version(authed_client, make_ticket_type):
    tt = make_ticket_type(name="Old", price_minor=1000)

    resp = authed_client.patch(
        f"/api/v1/ticket-types/{tt.id}", {"version": 1, "price": 2000}, format="json"
    )

    assert resp.status_code == 200
    assert resp.json()["price"] == 2000
    assert resp.json()["version"] == 2


@pytest.mark.django_db
def test_patch_ticket_type_stale_version_is_409(authed_client, make_ticket_type):
    tt = make_ticket_type()

    resp = authed_client.patch(
        f"/api/v1/ticket-types/{tt.id}", {"version": 99, "name": "New"}, format="json"
    )

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "stale_ticket_type_version"


@pytest.mark.django_db
def test_patch_ticket_type_below_committed_is_409(authed_client, make_ticket_type):
    tt = make_ticket_type(quantity=100, sold=40, reserved=20)  # 60 committed

    resp = authed_client.patch(
        f"/api/v1/ticket-types/{tt.id}", {"version": 1, "quantity": 30}, format="json"
    )

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "quantity_below_committed"


@pytest.mark.django_db
def test_patch_ticket_type_by_non_owner_is_403(api_client, make_ticket_type, other_user, token_for):
    tt = make_ticket_type()
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(other_user)}")

    resp = api_client.patch(
        f"/api/v1/ticket-types/{tt.id}", {"version": 1, "name": "Hijacked"}, format="json"
    )

    assert resp.status_code == 403


# --- closes the events loops -----------------------------------------------


@pytest.mark.django_db
def test_event_cannot_be_published_without_a_ticket_type(authed_client, organization):
    draft = _draft_event(organization)

    resp = authed_client.post(f"/api/v1/events/{draft.id}/publish", format="json")

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "event_not_publishable"


@pytest.mark.django_db
def test_event_can_be_published_once_it_has_a_ticket_type(
    authed_client, organization, make_ticket_type
):
    draft = _draft_event(organization)
    make_ticket_type(ev=draft)

    resp = authed_client.post(f"/api/v1/events/{draft.id}/publish", format="json")

    assert resp.status_code == 200
    assert resp.json()["status"] == "live"


@pytest.mark.django_db
def test_creating_a_tier_populates_event_from_price_and_availability(
    authed_client, event, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        authed_client.post(
            f"/api/v1/events/{event.id}/ticket-types",
            {"name": "Basic", "price": 1500, "quantity": 80},
            format="json",
        )

    # The public event detail now shows the denormalized ticketing fields.
    detail = authed_client.get(f"/api/v1/events/{event.id}")
    assert detail.json()["from_price"] == 1500
    assert detail.json()["tickets_available"] == 80


@pytest.mark.django_db
def test_editing_a_tier_is_reflected_after_cache_invalidation(
    api_client, event, make_ticket_type, authed_client, django_capture_on_commit_callbacks
):
    tt = make_ticket_type(name="Gold", price_minor=5000, quantity=50)
    url = f"/api/v1/events/{event.id}/ticket-types"
    api_client.get(url)  # warm the tiers cache

    with django_capture_on_commit_callbacks(execute=True):
        authed_client.patch(
            f"/api/v1/ticket-types/{tt.id}", {"version": 1, "price": 7000}, format="json"
        )

    follow_up = api_client.get(url)
    assert follow_up.json()["data"][0]["price"] == 7000
