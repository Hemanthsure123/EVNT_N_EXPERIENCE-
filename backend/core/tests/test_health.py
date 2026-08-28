"""Readiness, and the distinction that cost a rollback.

This endpoint returned 503 whenever any probe failed. When the Redis adapter
was fixed to degrade gracefully on Upstash's quota refusal, `ping()` started
reporting the cache as down honestly — and the deploy pipeline's first smoke
test (`[ "$code" = "200" ]`) refused to ship. A degraded CACHE blocked a
release, and the release being blocked was the one repairing the cache path.

The rule these tests pin: the DATABASE decides readiness; the cache is
cache-aside and its absence makes an instance slower, not wrong.
"""

from __future__ import annotations

import pytest


@pytest.mark.django_db
def test_health_check_reports_ok(client):
    response = client.get("/health/")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["checks"] == {"database": True, "cache": True}
    assert body["degraded"] == []


@pytest.mark.django_db
def test_a_dead_cache_still_serves_traffic(monkeypatch, client):
    """THE regression. Every read path falls through to a query the database
    can still answer, so an instance with no cache is slower and completely
    correct — and taking it out of rotation is the same mistake the cache
    adapter's fail-open design exists to prevent, moved one layer up."""
    monkeypatch.setattr("core.health._check_cache", lambda: False)

    response = client.get("/health/")

    assert response.status_code == 200, "a cold cache must not fail readiness"
    body = response.json()
    # `status` answers "can this instance serve correctly". It can.
    assert body["status"] == "ok"
    # ...and nothing is hidden: the probe and the summary both say so.
    assert body["checks"]["cache"] is False
    assert body["degraded"] == ["cache"]


@pytest.mark.django_db
def test_a_dead_database_is_not_ready(monkeypatch, client):
    """The other half. Without the database this process cannot answer a
    request correctly, so it must be taken out of rotation — which is the
    only thing 503 should ever mean here."""
    monkeypatch.setattr("core.health._check_database", lambda: False)

    response = client.get("/health/")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "unhealthy"
    assert body["checks"]["database"] is False


@pytest.mark.django_db
def test_the_smoke_test_contract_holds(monkeypatch, client):
    """The deploy pipeline greps the body for `"status": "ok"` and the code for
    200. Both must hold while the cache is down, or a release is blocked by
    something that does not stop the platform working.

    Pinned as the CONTRACT rather than left implicit, because the pipeline is
    in another repository directory and cannot fail this file's build.
    """
    monkeypatch.setattr("core.health._check_cache", lambda: False)

    response = client.get("/health/")

    assert response.status_code == 200
    assert '"status": "ok"' in response.content.decode()


@pytest.mark.django_db
def test_health_check_does_not_require_authentication(client):
    response = client.get("/health/")

    assert response.status_code != 401
    assert response.status_code != 403
