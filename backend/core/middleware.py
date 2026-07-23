from __future__ import annotations

import logging
import time
from collections.abc import Callable

from django.conf import settings
from django.http import HttpRequest, HttpResponse

from core.logging import new_request_id, request_id_var

logger = logging.getLogger("core.performance")


class RequestIDMiddleware:
    """Assigns (or forwards) a correlation id for every request, exposes it
    on the response, and makes it available to every log line via a
    contextvar-backed logging filter."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        request_id = request.headers.get("X-Request-ID") or new_request_id()
        token = request_id_var.set(request_id)
        try:
            response = self.get_response(request)
        finally:
            request_id_var.reset(token)
        response["X-Request-ID"] = request_id
        return response


class PerformanceLoggingMiddleware:
    """Dev-only: logs wall-clock time and DB query count per request, and
    flags anything slower than SLOW_REQUEST_THRESHOLD_MS. Gated on DEBUG —
    `connection.queries` is only populated when DEBUG=True, and per-query
    logging has real overhead that has no business running in staging/prod.
    This is a stopgap, not a replacement for real APM; django-silk (see
    ENABLE_SILK in settings) gives a much deeper per-query breakdown when
    you need it."""

    SLOW_REQUEST_THRESHOLD_MS = 200

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        if not settings.DEBUG:
            return self.get_response(request)

        from django.db import connection

        start = time.monotonic()
        queries_before = len(connection.queries)
        response = self.get_response(request)
        duration_ms = (time.monotonic() - start) * 1000
        query_count = len(connection.queries) - queries_before

        log = logger.warning if duration_ms > self.SLOW_REQUEST_THRESHOLD_MS else logger.info
        log(
            "request.performance",
            extra={
                "path": request.path,
                "method": request.method,
                "duration_ms": round(duration_ms, 2),
                "query_count": query_count,
                "status_code": response.status_code,
            },
        )
        return response
