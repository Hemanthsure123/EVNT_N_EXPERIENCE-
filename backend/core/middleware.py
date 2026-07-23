from __future__ import annotations

from collections.abc import Callable

from django.http import HttpRequest, HttpResponse

from core.logging import new_request_id, request_id_var


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
