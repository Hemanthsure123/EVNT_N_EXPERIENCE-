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

    # Unauthenticated: the tier list + ONE prefetch for every tier's phase
    # schedule — a fixed 2 however many tiers there are, never per-tier.
    with django_assert_num_queries(2):
        assert api_client.get(url).status_code == 200

    with django_assert_num_queries(0):  # served from cache
        assert api_client.get(url).status_code == 200


# --- the phase schedule on the wire ------------------------------------------


@pytest.mark.django_db
def test_create_ticket_type_accepts_a_phase_schedule(authed_client, event):
    ends_at = (timezone.now() + timedelta(days=3)).isoformat()

    resp = authed_client.post(
        f"/api/v1/events/{event.id}/ticket-types",
        {
            "name": "Gold",
            "price": 50000,
            "quantity": 50,
            "phases": [
                {"name": "Early bird", "price": 30000, "ends_at": ends_at, "quantity": 10},
                {"name": "Phase 2", "price": 40000, "quantity": 25},
            ],
        },
        format="json",
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["price"] == 50000  # the face price is still reported
    assert body["effective_price"] == 30000
    assert body["current_phase"] == {
        "name": "Early bird",
        "ends_at": body["phases"][0]["ends_at"],
        "remaining": 10,
    }
    assert body["next_price"] == 40000
    # The full schedule, ascending position — array order became position.
    assert [(p["name"], p["price"], p["position"]) for p in body["phases"]] == [
        ("Early bird", 30000, 0),
        ("Phase 2", 40000, 1),
    ]
    assert body["phases"][1]["ends_at"] is None
    assert body["phases"][1]["quantity"] == 25


@pytest.mark.django_db
def test_create_ticket_type_rejects_a_phase_above_the_price(authed_client, event):
    resp = authed_client.post(
        f"/api/v1/events/{event.id}/ticket-types",
        {
            "name": "Gold",
            "price": 50000,
            "quantity": 50,
            "phases": [{"name": "Early bird", "price": 60000, "quantity": 5}],
        },
        format="json",
    )

    assert resp.status_code == 400


@pytest.mark.django_db
def test_create_ticket_type_rejects_an_invalid_schedule_as_a_domain_error(authed_client, event):
    # Structurally valid JSON, domain-invalid schedule (no bound at all) —
    # the service's error envelope, not a serializer 400.
    resp = authed_client.post(
        f"/api/v1/events/{event.id}/ticket-types",
        {
            "name": "Gold",
            "price": 50000,
            "quantity": 50,
            "phases": [{"name": "Forever bird", "price": 30000}],
        },
        format="json",
    )

    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "invalid_phase_schedule"


@pytest.mark.django_db
def test_tier_list_reports_the_current_phase_and_remaining_seats(
    api_client, event, make_ticket_type
):
    make_ticket_type(
        name="Gold",
        price_minor=50000,
        quantity=50,
        sold=3,
        phases=[{"name": "Early bird", "price_minor": 30000, "quantity": 10}],
    )

    tier = api_client.get(f"/api/v1/events/{event.id}/ticket-types").json()["data"][0]

    assert tier["price"] == 50000
    assert tier["effective_price"] == 30000
    assert tier["current_phase"] == {"name": "Early bird", "ends_at": None, "remaining": 7}
    assert tier["next_price"] == 50000  # nothing scheduled after → face price


@pytest.mark.django_db
def test_tier_list_reports_no_remaining_count_for_a_seat_unbounded_phase(
    api_client, event, make_ticket_type
):
    """A phase with no seat threshold has no count to report, and the platform
    does not invent one — the deadline is what bounds it."""
    make_ticket_type(
        price_minor=50000,
        phases=[
            {
                "name": "Early bird",
                "price_minor": 30000,
                "ends_at": timezone.now() + timedelta(days=1),
            }
        ],
    )

    tier = api_client.get(f"/api/v1/events/{event.id}/ticket-types").json()["data"][0]

    assert tier["current_phase"]["name"] == "Early bird"
    assert tier["current_phase"]["remaining"] is None
    assert tier["current_phase"]["ends_at"] is not None


@pytest.mark.django_db
def test_tier_list_reports_a_lapsed_schedule_as_the_face_price(api_client, event, make_ticket_type):
    make_ticket_type(
        price_minor=50000,
        phases=[
            {
                "name": "Early bird",
                "price_minor": 30000,
                "ends_at": timezone.now() - timedelta(minutes=1),
                "quantity": 10,
            }
        ],
    )

    tier = api_client.get(f"/api/v1/events/{event.id}/ticket-types").json()["data"][0]

    assert tier["current_phase"] is None
    assert tier["effective_price"] == 50000
    assert tier["next_price"] is None  # no phase is active → nothing comes next
    # The schedule itself is still reported in full — it is the organizer's
    # configured history, not the live decision.
    assert [p["name"] for p in tier["phases"]] == ["Early bird"]


@pytest.mark.django_db
def test_tier_list_query_budget_is_a_fixed_two_with_phases(
    api_client, event, make_ticket_type, django_assert_num_queries
):
    """The schedule rides the prefetch: tiers + ONE phases query cold, zero
    warm — never a phases query per tier."""
    make_ticket_type(
        name="A",
        price_minor=50000,
        phases=[{"name": "Early bird", "price_minor": 30000, "quantity": 5}],
    )
    make_ticket_type(
        name="B",
        price_minor=60000,
        phases=[{"name": "Early bird", "price_minor": 40000, "quantity": 5}],
    )
    url = f"/api/v1/events/{event.id}/ticket-types"

    with django_assert_num_queries(2):
        assert api_client.get(url).status_code == 200
    with django_assert_num_queries(0):
        assert api_client.get(url).status_code == 200


@pytest.mark.django_db
def test_patch_can_clear_a_schedule(authed_client, make_ticket_type):
    tt = make_ticket_type(
        price_minor=50000,
        phases=[{"name": "Early bird", "price_minor": 30000, "quantity": 5}],
    )

    resp = authed_client.patch(
        f"/api/v1/ticket-types/{tt.id}",
        {"version": 1, "phases": []},
        format="json",
    )

    assert resp.status_code == 200
    assert resp.json()["current_phase"] is None
    assert resp.json()["effective_price"] == 50000
    assert resp.json()["phases"] == []


@pytest.mark.django_db
def test_patch_rejects_dropping_the_price_below_a_live_phase(authed_client, make_ticket_type):
    tt = make_ticket_type(
        price_minor=50000,
        phases=[{"name": "Early bird", "price_minor": 30000, "quantity": 5}],
    )

    resp = authed_client.patch(
        f"/api/v1/ticket-types/{tt.id}", {"version": 1, "price": 20000}, format="json"
    )

    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "phase_price_above_price"


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
def test_event_can_be_submitted_once_it_has_a_ticket_type(
    authed_client, organization, make_ticket_type
):
    draft = _draft_event(organization)
    make_ticket_type(ev=draft)

    resp = authed_client.post(f"/api/v1/events/{draft.id}/publish", format="json")

    assert resp.status_code == 200
    # The ticketing gate is satisfied, so the submission is accepted. Going
    # LIVE now needs an operator's approval — see the events moderation tests.
    assert resp.json()["status"] == "pending_review"


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
