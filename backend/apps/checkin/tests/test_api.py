"""API tests — status codes, the response/error envelope, cache headers, and
query budgets. Side effects (marks-used, audit rows) are covered in the
service/repository tests; here we assert the boundary contract."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

VERIFY_URL = "/api/v1/checkin/verify"


def _attendance_url(event_id) -> str:
    return f"/api/v1/events/{event_id}/attendance"


def _auth(client: APIClient, token_for, user) -> APIClient:
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(user)}")
    return client


@pytest.mark.django_db
def test_verify_admits_a_valid_ticket(api_client, token_for, issued_ticket, event, organizer):
    _auth(api_client, token_for, organizer)
    resp = api_client.post(
        VERIFY_URL,
        {"event_id": str(event.id), "qr_token": issued_ticket.qr_token, "gate": "North"},
        format="json",
    )

    assert resp.status_code == 200
    assert resp.data["allowed"] is True
    assert resp.data["reason"] == "allowed"
    assert resp.data["ticket_id"] == str(issued_ticket.id)
    assert resp["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
def test_verify_rescan_is_denied_but_still_200(
    api_client, token_for, issued_ticket, event, organizer
):
    _auth(api_client, token_for, organizer)
    body = {"event_id": str(event.id), "qr_token": issued_ticket.qr_token, "gate": "North"}
    api_client.post(VERIFY_URL, body, format="json")
    resp = api_client.post(VERIFY_URL, body, format="json")

    assert resp.status_code == 200
    assert resp.data["allowed"] is False
    assert resp.data["reason"] == "denied_already_used"


@pytest.mark.django_db
def test_verify_forged_token_is_denied(api_client, token_for, event, organizer):
    _auth(api_client, token_for, organizer)
    resp = api_client.post(
        VERIFY_URL,
        {"event_id": str(event.id), "qr_token": "v1.forged.sig", "gate": "North"},
        format="json",
    )

    assert resp.status_code == 200
    assert resp.data["allowed"] is False
    assert resp.data["reason"] == "denied_invalid"


@pytest.mark.django_db
def test_verify_requires_authentication(api_client, event, issued_ticket):
    resp = api_client.post(
        VERIFY_URL,
        {"event_id": str(event.id), "qr_token": issued_ticket.qr_token},
        format="json",
    )
    assert resp.status_code == 401


@pytest.mark.django_db
def test_verify_by_non_organizer_is_forbidden(
    api_client, token_for, issued_ticket, event, other_user
):
    _auth(api_client, token_for, other_user)
    resp = api_client.post(
        VERIFY_URL,
        {"event_id": str(event.id), "qr_token": issued_ticket.qr_token, "gate": "North"},
        format="json",
    )
    assert resp.status_code == 403
    assert resp.data["error"]["code"] == "not_allowed_to_check_in"


@pytest.mark.django_db
def test_attendance_returns_admitted_vs_capacity(
    api_client, token_for, issued_ticket, event, organizer
):
    _auth(api_client, token_for, organizer)
    # Admit one ticket first.
    api_client.post(
        VERIFY_URL,
        {"event_id": str(event.id), "qr_token": issued_ticket.qr_token, "gate": "North"},
        format="json",
    )

    resp = api_client.get(_attendance_url(event.id))

    assert resp.status_code == 200
    assert resp.data["admitted"] == 1
    assert resp.data["capacity"] == 100
    assert resp["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
def test_attendance_by_non_organizer_is_forbidden(api_client, token_for, event, tier, other_user):
    _auth(api_client, token_for, other_user)
    resp = api_client.get(_attendance_url(event.id))
    assert resp.status_code == 403
    assert resp.data["error"]["code"] == "not_allowed_to_check_in"


@pytest.mark.django_db
def test_attendance_is_cache_backed_warm_read_hits_fewer_queries(
    api_client, token_for, event, tier, organizer, django_assert_num_queries
):
    _auth(api_client, token_for, organizer)
    # Cold read reconciles from the DB; warm read is served from the cache.
    with django_assert_num_queries(4):
        api_client.get(_attendance_url(event.id))
    with django_assert_num_queries(2):
        resp = api_client.get(_attendance_url(event.id))
    assert resp.status_code == 200


@pytest.mark.django_db
def test_verify_query_budget_is_tiny(
    api_client, token_for, issued_ticket, event, organizer, django_assert_num_queries
):
    _auth(api_client, token_for, organizer)
    body = {"event_id": str(event.id), "qr_token": issued_ticket.qr_token, "gate": "North"}
    # A fixed, N+1-free budget: JWT auth user, event load, pre-lock ticket load,
    # then the tiny locked section (SELECT ... FOR UPDATE, mark-used UPDATE,
    # ScanLog INSERT, outbox INSERT) — 7 real statements, plus the SAVEPOINT /
    # RELEASE pair the test's outer transaction wraps the UnitOfWork in (BEGIN/
    # COMMIT in production autocommit).
    with django_assert_num_queries(9):
        resp = api_client.post(VERIFY_URL, body, format="json")
    assert resp.data["allowed"] is True
