"""The endpoint Cloud Tasks delivers to.

Before this existed, `QUEUE_BACKEND=cloud_tasks` enqueued every task to a URL
that 404'd — so the queue reported success and the work never ran, forever,
with no error anywhere in the application.

The two things worth asserting are the credential (this runs handlers that
move money) and the retry semantics (Cloud Tasks retries any non-2xx, so a
status code chosen carelessly means an infinite retry loop or a dropped job).
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from django.test import Client
from django.urls import reverse

from core.tasks import _registry, register_task

SECRET = "an-internal-task-secret"
URL = "/internal/tasks/run"


@pytest.fixture
def configured(settings):
    settings.INTERNAL_TASK_SECRET = SECRET
    return settings


@pytest.fixture
def recorded_task():
    """A task registered just for these tests, removed afterwards so the
    global registry does not leak between test modules."""
    calls: list[dict] = []

    @register_task("tests.record")
    def _record(payload: dict) -> None:
        calls.append(payload)

    yield calls
    _registry.pop("tests.record", None)


@pytest.fixture
def exploding_task():
    @register_task("tests.explode")
    def _explode(payload: dict) -> None:
        raise RuntimeError("the handler failed")

    yield
    _registry.pop("tests.explode", None)


def _post(body: dict, *, secret: str | None = SECRET) -> Any:
    # `headers=` rather than `HTTP_*` in `**extra`: Django 4.2+ takes real
    # header names here, and it is the typed spelling.
    headers = {"x-internal-task-secret": secret} if secret is not None else {}
    return Client().post(
        URL, data=json.dumps(body), content_type="application/json", headers=headers
    )


def test_the_route_is_mounted_outside_the_public_api():
    # Deliberately not under /api/v1/: it is not part of the public surface and
    # should be blocked at the edge for everything but the queue's egress.
    assert reverse("internal-task-run") == URL


class TestAuthentication:
    def test_a_correct_secret_runs_the_handler(self, configured, recorded_task):
        response = _post({"task_name": "tests.record", "payload": {"n": 1}})
        assert response.status_code == 200
        assert recorded_task == [{"n": 1}]

    def test_a_wrong_secret_is_refused_and_runs_nothing(self, configured, recorded_task):
        response = _post({"task_name": "tests.record", "payload": {}}, secret="wrong")
        assert response.status_code == 403
        assert recorded_task == []

    def test_a_missing_header_is_refused(self, configured, recorded_task):
        response = _post({"task_name": "tests.record", "payload": {}}, secret=None)
        assert response.status_code == 403
        assert recorded_task == []

    def test_no_configured_secret_refuses_rather_than_allowing_everything(
        self, settings, recorded_task
    ):
        # The failure mode this prevents: a missing env var turning an
        # authenticated endpoint into an open one.
        settings.INTERNAL_TASK_SECRET = ""
        response = _post({"task_name": "tests.record", "payload": {}}, secret=None)
        assert response.status_code == 503
        assert recorded_task == []

    def test_get_is_not_allowed(self, configured):
        assert Client().get(URL).status_code == 405


class TestRetrySemantics:
    """Cloud Tasks retries any non-2xx. Every status here is chosen for what
    the queue will do with it, not for what looks correct in isolation."""

    def test_an_unknown_task_returns_200_so_the_queue_stops_retrying(self, configured):
        # A task queued by a previous release whose handler is gone can never
        # succeed. A 404 would make the queue retry it until its deadline.
        response = _post({"task_name": "gone.forever", "payload": {}})
        assert response.status_code == 200
        assert response.json()["status"] == "unknown_task"

    def test_a_failing_handler_returns_500_so_the_queue_retries(self, configured, exploding_task):
        response = _post({"task_name": "tests.explode", "payload": {}})
        assert response.status_code == 500

    def test_a_malformed_body_is_a_400(self, configured):
        response = Client().post(
            URL,
            data="not json",
            content_type="application/json",
            headers={"x-internal-task-secret": SECRET},
        )
        assert response.status_code == 400

    def test_a_missing_task_name_is_a_400(self, configured):
        assert _post({"payload": {}}).status_code == 400

    def test_a_non_object_payload_is_a_400(self, configured):
        # Handlers are typed `(payload: dict)`. A list would fail inside the
        # handler with a confusing AttributeError and then be RETRIED as a 500.
        assert _post({"task_name": "tests.record", "payload": ["nope"]}).status_code == 400

    def test_an_absent_payload_defaults_to_an_empty_dict(self, configured, recorded_task):
        assert _post({"task_name": "tests.record"}).status_code == 200
        assert recorded_task == [{}]
