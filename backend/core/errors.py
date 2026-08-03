"""Domain exception hierarchy + the DRF exception handler that renders it.

Services and repositories raise these instead of talking HTTP status codes.
This keeps business rules framework-agnostic: the same DomainError could be
caught by a CLI command, a task worker, or (as here) turned into a REST
response — the exception handler is the only place that knows about HTTP.
"""

from __future__ import annotations

import logging
import math
import uuid

from rest_framework import exceptions as drf_exceptions
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger(__name__)


class DomainError(Exception):
    code = "domain_error"
    status_code = 400

    def __init__(self, message: str | None = None, **details: object) -> None:
        self.message = message or self.__class__.__doc__ or self.code
        self.details = details
        super().__init__(self.message)


class NotFoundError(DomainError):
    code = "not_found"
    status_code = 404


class ConflictError(DomainError):
    code = "conflict"
    status_code = 409


class InvalidInputError(DomainError):
    code = "invalid_input"
    status_code = 422


class PermissionDeniedError(DomainError):
    code = "permission_denied"
    status_code = 403


class AuthenticationError(DomainError):
    code = "authentication_error"
    status_code = 401


def _error_response(
    *,
    code: str,
    message: str,
    status_code: int,
    details: dict | None = None,
    headers: dict | None = None,
) -> Response:
    response = Response(
        {"error": {"code": code, "message": message, "details": details or {}}}, status=status_code
    )
    for name, value in (headers or {}).items():
        response[name] = value
    return response


def exception_handler(exc: Exception, context: dict) -> Response | None:
    if isinstance(exc, DomainError):
        return _error_response(
            code=exc.code, message=exc.message, status_code=exc.status_code, details=exc.details
        )

    response = drf_exception_handler(exc, context)
    if response is not None:
        code = getattr(exc, "default_code", exc.__class__.__name__.lower())
        message = str(exc) if not isinstance(exc, drf_exceptions.APIException) else str(exc.detail)
        # DRF attaches protocol headers to some exceptions, and rebuilding the
        # body used to drop them. Two matter and both are part of the response's
        # MEANING, not decoration:
        #
        # - `Retry-After` on a 429. Without it a throttled client is told "too
        #   many requests" and given no way to know when to come back, so it
        #   either gives up or retries immediately and stays throttled. Losing
        #   it turns a rate limit into an outage for well-behaved clients.
        # - `WWW-Authenticate` on a 401, which is what tells a client WHICH
        #   scheme to authenticate with.
        headers: dict[str, str] = {}
        wait = getattr(exc, "wait", None)
        if wait is not None:
            # Ceil, not floor: DRF's `wait` is fractional, and rounding down
            # tells a client to retry a moment before the window opens — which
            # produces a second 429 and, for a client that trusts the header,
            # a retry loop.
            headers["Retry-After"] = str(math.ceil(wait))
        auth_header = getattr(exc, "auth_header", None)
        if auth_header:
            headers["WWW-Authenticate"] = auth_header

        return _error_response(
            code=code,
            message=message,
            status_code=response.status_code,
            details={},
            headers=headers,
        )

    error_id = str(uuid.uuid4())
    logger.exception("unhandled_exception", extra={"error_id": error_id})
    return _error_response(
        code="internal_error",
        message="An unexpected error occurred.",
        status_code=500,
        details={"error_id": error_id},
    )
