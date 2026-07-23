"""Liveness/readiness endpoint. Deliberately a plain Django view (not a DRF
APIView): it must never require authentication or go through the DRF
exception envelope, and it must work even if the database migrations
haven't run yet."""

from __future__ import annotations

import logging

from django.db import connections
from django.http import JsonResponse

logger = logging.getLogger(__name__)


def health_check(request) -> JsonResponse:
    db_ok = _check_database()
    cache_ok = _check_cache()
    healthy = db_ok and cache_ok
    return JsonResponse(
        {
            "status": "ok" if healthy else "degraded",
            "checks": {"database": db_ok, "cache": cache_ok},
        },
        status=200 if healthy else 503,
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
