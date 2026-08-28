"""Liveness/readiness endpoint. Deliberately a plain Django view (not a DRF
APIView): it must never require authentication or go through the DRF
exception envelope, and it must work even if the database migrations
haven't run yet.

── READINESS MEANS "CAN I SERVE", NOT "IS EVERYTHING PERFECT" ────────────

This returned 503 whenever ANY check failed, cache included. That looks
careful and is wrong, and it cost a rollback of a working deploy.

The sequence is worth keeping, because every step of it was individually
reasonable. Upstash's request quota ran out. `RedisCacheAdapter.ping()` did
not report that — a quota refusal arrives as a `ResponseError`, which the
adapter did not catch, so `ping` raised and `_check_cache` swallowed it into
`False`... except it never got that far in the outage, because the endpoint
answered before the quota mattered. The fix that made the adapter degrade
gracefully ALSO made `ping()` honest: it now returns `False` on a quota
refusal.

Which meant this endpoint started telling the truth — and the deploy pipeline
immediately refused to ship, because its first smoke test is
`[ "$code" = "200" ]`. A degraded CACHE blocked a release. The change being
blocked was the one that repairs the cache path.

So: the DATABASE decides readiness. Without it this process cannot answer a
request correctly and must be taken out of rotation. The cache is
cache-ASIDE — every read path falls through to a query the database can still
answer — so an instance with a cold cache is slower and completely correct,
which is the entire argument the adapter is built on. Refusing traffic over it
would be the same mistake the adapter exists to prevent, moved one layer up.

Nothing is hidden by this. `checks` still reports each probe, and `degraded`
names anything that is down while the instance keeps serving, so an operator
(or an alert) reads the real state from a 200 rather than inferring it from a
status code that could not distinguish "slower" from "broken".
"""

from __future__ import annotations

import logging

from django.db import connections
from django.http import JsonResponse

logger = logging.getLogger(__name__)


def health_check(request) -> JsonResponse:
    db_ok = _check_database()
    cache_ok = _check_cache()

    # Only the database gates readiness. See the module docstring.
    serving = db_ok
    degraded = [name for name, ok in (("cache", cache_ok),) if not ok]

    if not serving:
        status = "unhealthy"
    elif degraded:
        # NOT "degraded". `status` answers one question — can this instance
        # serve correctly — and with a cold cache the answer is yes. The
        # `degraded` list below is where "yes, but" is said, and it is said in
        # a field rather than by weakening the answer, because every readiness
        # consumer there is (the load balancer, the smoke test, the container
        # orchestrator) reads `status` and none of them can act on "slower".
        status = "ok"
    else:
        status = "ok"

    if degraded:
        logger.warning("health_check.degraded", extra={"degraded": degraded})

    return JsonResponse(
        {
            "status": status,
            "checks": {"database": db_ok, "cache": cache_ok},
            "degraded": degraded,
        },
        status=200 if serving else 503,
    )


def _check_database() -> bool:
    try:
        connections["default"].ensure_connection()
        return True
    except Exception:
        logger.exception("health_check.database_failed")
        return False


def _check_cache() -> bool:
    try:
        from config.di import cache_port

        return cache_port().ping()
    except Exception:
        logger.exception("health_check.cache_failed")
        return False
