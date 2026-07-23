import logging
from typing import cast

import pytest
from django.http import HttpRequest, HttpResponse

from core.middleware import PerformanceLoggingMiddleware, RequestIDMiddleware


class _FakeRequest:
    def __init__(self, *, path: str = "/x", method: str = "GET", headers: dict | None = None):
        self.path = path
        self.method = method
        self.headers = headers or {}


def _req(*, path: str = "/x", method: str = "GET", headers: dict | None = None) -> HttpRequest:
    return cast(HttpRequest, _FakeRequest(path=path, method=method, headers=headers))


def test_request_id_middleware_generates_a_request_id_when_none_is_given():
    middleware = RequestIDMiddleware(lambda request: HttpResponse())

    response = middleware(_req())

    assert response["X-Request-ID"]


def test_request_id_middleware_forwards_an_incoming_request_id():
    middleware = RequestIDMiddleware(lambda request: HttpResponse())

    response = middleware(_req(headers={"X-Request-ID": "abc123"}))

    assert response["X-Request-ID"] == "abc123"


def test_performance_middleware_skips_measurement_when_debug_is_false(settings):
    settings.DEBUG = False
    calls = []

    def get_response(request: HttpRequest) -> HttpResponse:
        calls.append(1)
        return HttpResponse()

    response = PerformanceLoggingMiddleware(get_response)(_req())

    assert len(calls) == 1
    assert response.status_code == 200


@pytest.mark.django_db
def test_performance_middleware_logs_timing_and_query_count_when_debug_is_true(settings, caplog):
    settings.DEBUG = True
    from apps.accounts.repositories import UserRepository

    def get_response(request: HttpRequest) -> HttpResponse:
        UserRepository().email_exists("nobody@example.com")  # forces a real query
        return HttpResponse()

    with caplog.at_level(logging.INFO, logger="core.performance"):
        response = PerformanceLoggingMiddleware(get_response)(_req())

    assert response.status_code == 200
    [record] = [r for r in caplog.records if r.message == "request.performance"]
    assert record.query_count >= 1
    assert record.path == "/x"


@pytest.mark.django_db
def test_performance_middleware_logs_as_a_warning_when_the_request_is_slow(
    settings, caplog, monkeypatch
):
    settings.DEBUG = True
    monkeypatch.setattr(PerformanceLoggingMiddleware, "SLOW_REQUEST_THRESHOLD_MS", -1)

    with caplog.at_level(logging.INFO, logger="core.performance"):
        PerformanceLoggingMiddleware(lambda request: HttpResponse())(_req(path="/slow"))

    [record] = [r for r in caplog.records if r.message == "request.performance"]
    assert record.levelname == "WARNING"
