"""GET /admin/health?deep=1 — probing vendors instead of naming adapters.

Six of the eight tiles were permanently grey: the endpoint reported WHICH
adapter was configured for payments, storage, queue, event bus, email and SMS,
and contacted none of them. That was the honest thing to do by default, and it
still is — but an operator wants to know the payment provider is reachable
BEFORE a Friday on-sale, and there was no way to ask.

Three properties are load-bearing and each is asserted below:

1. **Deep is OPT-IN and CACHED.** A dashboard left open on a wall must not
   become a load test against Razorpay.
2. **Unconfigured is not degraded.** A fake adapter in development is working
   as intended; reporting it red would train operators to ignore red.
3. **`deep` is on the wire.** Without it a shallow `unknown` tile and a deep
   one look identical, and an operator cannot tell "we did not check" from "we
   checked and it is fine" — the entire distinction this endpoint draws.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.console import health
from core.models import OutboxEvent

URL = "/api/v1/admin/health"


@pytest.fixture
def staff(db) -> User:
    return User.objects.create_user(
        email="ops-health@example.com", password="opsadmin12345", is_staff=True
    )


def auth(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _by_name(body: dict) -> dict:
    return {check["name"]: check for check in body["checks"]}


@pytest.mark.django_db
class TestTheShallowDefault:
    def test_it_stays_the_default(self, staff):
        """Deep must be asked for. A dashboard polling every ten seconds gets
        the cheap answer unless somebody chooses otherwise."""
        body = auth(staff).get(URL).json()
        assert body["deep"] is False

    def test_database_and_cache_are_genuinely_probed(self, staff):
        checks = _by_name(auth(staff).get(URL).json())
        assert checks["database"]["status"] == health.OK
        assert checks["cache"]["status"] == health.OK

    def test_everything_else_is_unknown_rather_than_green(self, staff):
        """The rule the tile design is built on: a tile that is green because
        nothing checked it is the one an operator would trust to page somebody."""
        checks = _by_name(auth(staff).get(URL).json())
        for name in ("payments", "storage", "queue", "event_bus", "email", "sms"):
            assert checks[name]["status"] == health.UNKNOWN

    def test_the_shallow_answer_has_no_outbox_tile(self, staff):
        """It is a query, and the shallow path is meant to be free."""
        assert "outbox" not in _by_name(auth(staff).get(URL).json())


@pytest.mark.django_db
class TestTheDeepAnswer:
    def test_deep_1_says_so_on_the_wire(self, staff):
        body = auth(staff).get(f"{URL}?deep=1").json()
        assert body["deep"] is True

    @pytest.mark.parametrize("value", ["1", "true", "True", "yes"])
    def test_the_usual_truthy_spellings_all_work(self, staff, value):
        assert auth(staff).get(f"{URL}?deep={value}").json()["deep"] is True

    @pytest.mark.parametrize("value", ["0", "false", "", "maybe"])
    def test_anything_else_is_shallow_rather_than_an_error(self, staff, value):
        """A malformed query param widens to the cheap answer, never a 400.
        Same reasoning as the organizer lists' date filters: this is the page
        somebody opens WHEN infrastructure is broken, and it must not be the
        second thing that fails."""
        assert auth(staff).get(f"{URL}?deep={value}").json()["deep"] is False

    def test_a_fake_adapter_is_still_unknown_not_degraded(self, staff, settings):
        """Development runs on fakes by default. Reporting that red would make
        red meaningless."""
        settings.PAYMENTS_BACKEND = "fake"
        health_body = auth(staff).get(f"{URL}?deep=1").json()

        payments = _by_name(health_body)["payments"]
        assert payments["status"] == health.UNKNOWN
        assert "local/fake" in payments["detail"]
        # ...and a fake adapter cannot drag the overall status down.
        assert health_body["status"] == health.OK

    def test_the_outbox_is_checked_only_on_the_deep_path(self, staff):
        assert "outbox" in _by_name(auth(staff).get(f"{URL}?deep=1").json())

    def test_a_draining_outbox_is_ok(self, staff):
        body = auth(staff).get(f"{URL}?deep=1").json()
        assert _by_name(body)["outbox"]["status"] == health.OK

    def test_a_STUCK_outbox_degrades(self, staff):
        """The most useful signal on the page and the one nothing else
        surfaces: a backlog means tickets are not being emailed while every
        other tile is green."""
        stale = OutboxEvent.objects.create(event_type="test.stuck", payload={}, aggregate_id="x")
        OutboxEvent.objects.filter(pk=stale.id).update(
            created_at=timezone.now() - dt.timedelta(minutes=30), published_at=None
        )

        body = auth(staff).get(f"{URL}?deep=1").json()

        outbox = _by_name(body)["outbox"]
        assert outbox["status"] == health.DEGRADED
        assert "1 event" in outbox["detail"]
        # A probed failure DOES degrade the overall status — unlike an
        # unconfigured adapter.
        assert body["status"] == health.DEGRADED

    def test_a_RECENT_unpublished_event_is_not_a_backlog(self, staff):
        """Every write creates one of these and they drain in milliseconds.
        Flagging them instantly would make this tile permanently red."""
        OutboxEvent.objects.create(event_type="test.fresh", payload={}, aggregate_id="y")

        body = auth(staff).get(f"{URL}?deep=1").json()

        assert _by_name(body)["outbox"]["status"] == health.OK


@pytest.mark.django_db
class TestTheCache:
    def test_the_deep_result_is_cached(self, staff):
        """The property that stops a wall dashboard becoming vendor traffic:
        the second call within the TTL does not re-probe."""
        client = auth(staff)
        client.get(f"{URL}?deep=1")

        calls: list[int] = []
        original = health._deep_checks

        def counting():
            calls.append(1)
            return original()

        health._deep_checks = counting
        try:
            client.get(f"{URL}?deep=1")
            client.get(f"{URL}?deep=1")
        finally:
            health._deep_checks = original

        assert calls == []

    def test_the_shallow_path_is_never_served_from_the_deep_cache(self, staff):
        """They answer different questions. A cached deep result returned for a
        shallow request would report `deep: false` beside probed tiles."""
        client = auth(staff)
        client.get(f"{URL}?deep=1")

        body = client.get(URL).json()

        assert body["deep"] is False
        assert "outbox" not in _by_name(body)


@pytest.mark.django_db
class TestAccess:
    def test_a_non_operator_cannot_probe_vendors(self, db):
        """Deep probing costs money and touches third parties. It must not be
        reachable by anyone who is merely signed in."""
        member = User.objects.create_user(email="member-h@example.com", password="member12345")
        assert auth(member).get(f"{URL}?deep=1").status_code == 403

    def test_anonymous_is_refused(self, db):
        assert APIClient().get(f"{URL}?deep=1").status_code == 401

    def test_health_is_never_shared_cached(self, staff):
        resp = auth(staff).get(f"{URL}?deep=1")
        assert resp["Cache-Control"] == "private, no-store"
