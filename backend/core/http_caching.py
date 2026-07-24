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
    response: Response,
    *,
    etag: str,
    max_age_seconds: int,
    private: bool = True,
    s_maxage_seconds: int | None = None,
    stale_while_revalidate_seconds: int | None = None,
) -> Response:
    """Attach an ETag + Cache-Control to a cacheable GET response.

    `max_age_seconds` governs the browser cache. For genuinely public,
    unauthenticated-safe reads (`private=False`), `s_maxage_seconds` governs a
    shared/CDN cache separately — usually set a bit higher than max-age so the
    edge absorbs most traffic while browsers revalidate sooner — and
    `stale_while_revalidate_seconds` lets the edge serve a just-expired copy
    while it refreshes in the background (no request ever waits on a rebuild).
    `s-maxage`/`stale-while-revalidate` are meaningless (and must not be sent)
    on `private` responses, so they're only emitted when `private=False`.
    """
    response["ETag"] = etag
    directives = ["private" if private else "public", f"max-age={max_age_seconds}"]
    if not private and s_maxage_seconds is not None:
        directives.append(f"s-maxage={s_maxage_seconds}")
    if not private and stale_while_revalidate_seconds is not None:
        directives.append(f"stale-while-revalidate={stale_while_revalidate_seconds}")
    response["Cache-Control"] = ", ".join(directives)
    return response
