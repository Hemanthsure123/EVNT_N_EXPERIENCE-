"""ETag + Cache-Control helpers for cacheable GET endpoints.

Kept as plain functions rather than a Django/DRF decorator: wrapping just a
DRF APIView method with Django's `@condition(...)` decorator runs before
DRF's own content negotiation/rendering has happened, which is fragile.
Calling these explicitly inside the view is simpler and behaves the same
regardless of DRF's internals.

IMPORTANT: use `private=True` (the default) for any response whose content
depends on WHO is asking (an ownership/permission check gates the data) —
a shared/CDN cache must never serve one user's cached response to another.
Only pass `private=False` for genuinely public, unauthenticated-safe reads.
"""

from __future__ import annotations

import hashlib
import json

from rest_framework.request import Request
from rest_framework.response import Response


def make_etag(payload: dict) -> str:
    digest = hashlib.md5(
        json.dumps(payload, sort_keys=True, default=str).encode(), usedforsecurity=False
    ).hexdigest()
    return f'"{digest}"'


def is_not_modified(request: Request, etag: str) -> bool:
    return request.headers.get("If-None-Match") == etag


def with_cache_headers(
    response: Response, *, etag: str, max_age_seconds: int, private: bool = True
) -> Response:
    response["ETag"] = etag
    visibility = "private" if private else "public"
    response["Cache-Control"] = f"{visibility}, max-age={max_age_seconds}"
    return response
