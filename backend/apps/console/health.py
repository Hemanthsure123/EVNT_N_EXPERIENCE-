"""Dependency health for the console's status tiles.

Its own file for the same reason `events` has `publish_checks.py` and
`booking` has `qr.py`: it is a self-contained concern with a registry other
code may extend, and burying it in selectors would hide that.

TWO KINDS OF ANSWER, and the distinction is the point:

- **Probed** — database and cache are actually touched (a connection, a
  cache round-trip). These report `ok` or `degraded` from evidence.
- **Configured** — payments, storage, queue, email and SMS report WHICH
  adapter is selected, and whether it is a real vendor or a local/fake one.
  That is a true and operationally useful statement.

What this deliberately does NOT do is show a green light for a vendor it has
not contacted. Probing a payment provider on every dashboard poll would put
real traffic on a third party to decorate a widget, and a tile that is green
because nothing checked it is worse than no tile — on an operations screen
it is the tile people trust to page someone.
"""

from __future__ import annotations

import logging
from typing import Any

from django.conf import settings
from django.db import connections

logger = logging.getLogger(__name__)

OK = "ok"
DEGRADED = "degraded"
#: Configured, but not contacted by this endpoint. Rendered distinctly.
UNKNOWN = "unknown"

#: Adapter selections that mean "no real vendor is wired up here".
_LOCAL_BACKENDS = {"fake", "local", "console", "sync", "inmemory", "in_memory", "dummy"}


def _probe_database() -> dict[str, Any]:
    try:
        connections["default"].ensure_connection()
        return {"name": "database", "status": OK, "detail": "Postgres reachable"}
    except Exception:
        logger.exception("console.health.database_failed")
        return {"name": "database", "status": DEGRADED, "detail": "Connection failed"}


def _probe_cache() -> dict[str, Any]:
    from config.di import cache_port

    try:
        cache = cache_port()
        cache.set("console:health:ping", "1", timeout_seconds=10)
        ok = cache.get("console:health:ping") == "1"
        return {
            "name": "cache",
            "status": OK if ok else DEGRADED,
            "detail": "Redis round-trip" if ok else "Wrote but could not read back",
        }
    except Exception:
        logger.exception("console.health.cache_failed")
        return {"name": "cache", "status": DEGRADED, "detail": "Connection failed"}


def _configured(name: str, setting: str) -> dict[str, Any]:
    backend = str(getattr(settings, setting, "") or "unset")
    local = backend.lower() in _LOCAL_BACKENDS
    return {
        "name": name,
        "status": UNKNOWN,
        "detail": f"{backend} adapter" + (" (local/fake)" if local else ""),
    }


def get_health() -> dict[str, Any]:
    checks = [
        _probe_database(),
        _probe_cache(),
        _configured("payments", "PAYMENTS_BACKEND"),
        _configured("storage", "STORAGE_BACKEND"),
        _configured("queue", "QUEUE_BACKEND"),
        _configured("event_bus", "EVENT_BUS_BACKEND"),
        _configured("email", "EMAIL_PROVIDER"),
        _configured("sms", "SMS_PROVIDER"),
    ]
    # Only PROBED checks can degrade the overall status. A configured-but-
    # uncontacted adapter is not evidence of a problem.
    degraded = any(check["status"] == DEGRADED for check in checks)
    return {"status": DEGRADED if degraded else OK, "checks": checks}
