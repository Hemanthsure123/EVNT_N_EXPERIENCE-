"""API tests — authZ (an organizer sees only their own), the error envelope,
cache headers, and the list query budget."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.events.models import Event, EventStatus
from apps.events.repositories import EventRepository
from apps.organizations.repositories import OrganizationRepository
from apps.settlements.repositories import SettlementRepository

LIST_URL = "/api/v1/organizer/settlements"


def _detail_url(event_id) -> str:
    return f"/api/v1/organizer/settlements/{event_id}"


def _release_url(settlement_id) -> str:
    return f"/api/v1/admin/settlements/{settlement_id}/release"


def _auth(client: APIClient, token_for, user) -> APIClient:
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(user)}")
    return client


def _make_settlement(event, *, releasable=True, gross=100000, fee=20):
    repo = SettlementRepository()
    releasable_at = (
        timezone.now() - timedelta(hours=1) if releasable else timezone.now() + timedelta(days=2)
    )
    repo.ensure_for_event(event.id, releasable_at=releasable_at)
    repo.add_confirmed(event.id, amount=gross, fee=fee)
    return repo.get_by_event(event.id)


@pytest.mark.django_db
def test_list_returns_only_the_callers_settlements(
    api_client, token_for, organizer, other_organizer, finished_event
):
    _make_settlement(finished_event)  # owned by `organizer`
    # A settlement for a DIFFERENT organizer.
    other_org = OrganizationRepository().create(owner_id=other_organizer.id, name="Other Co")
    other_event = EventRepository().create(
        organization_id=other_org.id,
        title="Other",
        venue="V",
        city="C",
        starts_at=timezone.now() - timedelta(days=5),
        ends_at=timezone.now() - timedelta(days=3),
    )
    Event.objects.filter(pk=other_event.id).update(status=EventStatus.LIVE)
    _make_settlement(other_event)

    _auth(api_client, token_for, organizer)
    resp = api_client.get(LIST_URL)

    assert resp.status_code == 200
    assert len(resp.data["data"]) == 1
    assert str(resp.data["data"][0]["event_id"]) == str(finished_event.id)
    assert resp["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
def test_list_requires_authentication(api_client, finished_event):
    assert api_client.get(LIST_URL).status_code == 401


@pytest.mark.django_db
def test_detail_owner_sees_it_non_owner_is_forbidden(
    api_client, token_for, organizer, other_organizer, finished_event
):
    _make_settlement(finished_event)

    _auth(api_client, token_for, organizer)
    ok = api_client.get(_detail_url(finished_event.id))
    assert ok.status_code == 200
    assert ok.data["net"] == 99980
    assert ok["Cache-Control"] == "private, no-store"

    _auth(api_client, token_for, other_organizer)
    forbidden = api_client.get(_detail_url(finished_event.id))
    assert forbidden.status_code == 403
    assert forbidden.data["error"]["code"] == "not_settlement_owner"


@pytest.mark.django_db
def test_detail_missing_settlement_is_404(api_client, token_for, organizer, upcoming_event):
    _auth(api_client, token_for, organizer)
    resp = api_client.get(_detail_url(upcoming_event.id))
    assert resp.status_code == 404
    assert resp.data["error"]["code"] == "settlement_not_found"


@pytest.mark.django_db
def test_admin_release_requires_staff(api_client, token_for, organizer, finished_event):
    s = _make_settlement(finished_event)
    _auth(api_client, token_for, organizer)  # a normal organizer, not staff
    assert api_client.post(_release_url(s.id)).status_code == 403


@pytest.mark.django_db
def test_admin_release_before_event_is_conflict(api_client, token_for, upcoming_event):
    s = _make_settlement(upcoming_event, releasable=False)
    admin = User.objects.create_user(email="admin@example.com", password="s3cur3pass")
    User.objects.filter(pk=admin.id).update(is_staff=True)

    _auth(api_client, token_for, admin)
    resp = api_client.post(_release_url(s.id))
    assert resp.status_code == 409
    assert resp.data["error"]["code"] == "event_not_finished"


@pytest.mark.django_db
def test_list_query_budget_is_tiny(
    api_client, token_for, organizer, finished_event, django_assert_num_queries
):
    _make_settlement(finished_event)
    _auth(api_client, token_for, organizer)
    # Auth user lookup + the single joined list query — no N+1.
    with django_assert_num_queries(2):
        resp = api_client.get(LIST_URL)
    assert resp.status_code == 200
    # Every serialized field must be in the repository's lean `.only()` set.
    # `releasable_at` is the one most recently added, and a field the
    # serializer reads but `.only()` omits is re-fetched PER ROW — which the
    # budget above would catch only once there were two rows to re-fetch.
    assert resp.data["data"][0]["releasable_at"] is not None


@pytest.mark.django_db
def test_pending_settlement_reports_when_it_releases(
    api_client, token_for, organizer, upcoming_event
):
    """The organizer's own question is "when am I paid".

    The payouts screen could previously only restate the rule, because the
    payload carried no date. This is the same instant `release_due_payouts`
    acts on, so the screen cannot promise a different day from the scheduler.
    """
    settlement = _make_settlement(upcoming_event, releasable=False)
    _auth(api_client, token_for, organizer)

    resp = api_client.get(LIST_URL)

    assert resp.status_code == 200
    row = next(r for r in resp.data["data"] if r["id"] == str(settlement.id))
    assert row["status"] == "pending"
    assert row["releasable_at"] is not None
