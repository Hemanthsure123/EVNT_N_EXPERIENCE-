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
    detail = f"{backend} adapter" + (" (local/fake)" if local else "")
    # The payment MODE rides on the configured line rather than on a probe.
    #
    # It is read off the key's own prefix, so it costs no network call and
    # breaks none of this module's rules — a probe reports what it contacted,
    # and this reports what is configured, which is exactly what the rest of
    # this line already does.
    #
    # It has to be here rather than only in the probed branch, because the
    # Razorpay adapter has no `health_check()` and so never reaches that
    # branch. "razorpay adapter" is true of a test key and a live one, and
    # those are the two states an operator most needs to tell apart: one demo
    # taken on live keys moves real money, one launch left on test keys takes
    # none. Neither announces itself.
    if name == "payments" and not local:
        detail = f"{detail} · {payments_mode()} mode"
    return {"name": name, "status": UNKNOWN, "detail": detail}


# ── The DEEP probes ─────────────────────────────────────────────────────────
#
# An operator wants to know the payment provider is reachable BEFORE a Friday
# on-sale, not after. But probing a vendor on every dashboard poll would put
# real traffic on a third party to decorate a widget, so this is opt-in
# (`?deep=1`) and the result is CACHED — a wall-mounted dashboard refreshing
# every ten seconds must not become a load test against Razorpay.
#
# Three rules hold for every probe below, and they are what keep this honest:
#
# 1. **A probe reports what it actually established, and nothing more.** The
#    detail string names the check performed, so "ok" is never a claim nobody
#    can trace.
# 2. **Unconfigured is not degraded.** A fake payment adapter in development is
#    working exactly as intended; reporting it red would train operators to
#    ignore red. It stays `unknown` with its adapter named.
# 3. **A probe never mutates anything.** Nothing here creates an order, sends a
#    message or writes an object — a health check that leaves artefacts behind
#    is a health check somebody eventually disables.

#: How long a deep result is reused. Long enough that a dashboard poll is free,
#: short enough that an operator re-checking after a fix sees the change within
#: a minute.
DEEP_CACHE_TTL_SECONDS = 60
_DEEP_CACHE_KEY = "console:health:deep"

# NOTE ON TIMEOUTS. There is deliberately no `_PROBE_TIMEOUT_SECONDS` here.
# The timeout belongs to whichever HTTP client the adapter uses, and a constant
# in this file that nothing applied would be exactly the kind of decorative
# reassurance this module exists to refuse. If a vendor probe is found to hang,
# the fix goes in that adapter's client configuration, where it can actually
# take effect.


def payments_mode() -> str:
    """ "test", "live", or "no key" — read off the key itself.

    Razorpay encodes it in the prefix (`rzp_test_` / `rzp_live_`), which makes
    this a FACT rather than a second setting somebody has to keep in step with
    the credentials. A `PAYMENTS_MODE` env var would be a thing that can
    disagree with the key it describes, and the disagreement would be silent.
    """
    key = str(getattr(settings, "RAZORPAY_KEY_ID", "") or "")
    if key.startswith("rzp_live_"):
        return "live"
    if key.startswith("rzp_test_"):
        return "test"
    return "no key"


def _deep_payments() -> dict[str, Any]:
    """Is the configured payment provider reachable and are the keys accepted?

    Uses the port's own `health_check()` where the adapter offers one, so this
    module never learns a vendor's API. An adapter without one degrades to the
    configured answer rather than this file growing a Razorpay import — which
    would break the lazy-import rule the composition root exists to enforce.
    """
    from config.di import payment_port

    backend = str(getattr(settings, "PAYMENTS_BACKEND", "") or "unset")
    if backend.lower() in _LOCAL_BACKENDS:
        return _configured("payments", "PAYMENTS_BACKEND")
    mode = payments_mode()
    try:
        port = payment_port()
        check = getattr(port, "health_check", None)
        if check is None:
            return _configured("payments", "PAYMENTS_BACKEND")
        healthy = bool(check())
        return {
            "name": "payments",
            "status": OK if healthy else DEGRADED,
            # The MODE is on the tile, not just the adapter name. "razorpay"
            # is true of a test key and a live one, and those are the two
            # states an operator most needs to tell apart: one demo taken on
            # live keys moves somebody's real money, and one launch left on
            # test keys takes none of it. Neither failure announces itself.
            "detail": (
                f"{backend} ({mode}): credentials accepted"
                if healthy
                else f"{backend} ({mode}): refused"
            ),
        }
    except Exception:
        logger.exception("console.health.payments_failed")
        return {
            "name": "payments",
            "status": DEGRADED,
            "detail": f"{backend} ({mode}): unreachable",
        }


def _deep_storage() -> dict[str, Any]:
    """Can we reach the bucket?

    A READ of a key that is not expected to exist. It proves the endpoint
    answers and the credentials are accepted, and it writes nothing — an upload
    probe would leave a file behind on every poll, which is how a bucket fills
    with health checks.
    """
    from config.di import storage_port

    backend = str(getattr(settings, "STORAGE_BACKEND", "") or "unset")
    if backend.lower() in _LOCAL_BACKENDS:
        return _configured("storage", "STORAGE_BACKEND")
    try:
        port = storage_port()
        check = getattr(port, "health_check", None)
        if check is None:
            return _configured("storage", "STORAGE_BACKEND")
        healthy = bool(check())
        return {
            "name": "storage",
            "status": OK if healthy else DEGRADED,
            "detail": f"{backend}: bucket reachable" if healthy else f"{backend}: refused",
        }
    except Exception:
        logger.exception("console.health.storage_failed")
        return {"name": "storage", "status": DEGRADED, "detail": f"{backend}: unreachable"}


def _deep_outbox() -> dict[str, Any]:
    """Is the outbox draining?

    Not a vendor call — a query. It is here because it is the single most
    useful signal on this page and nothing else surfaces it: the outbox is how
    every domain event reaches every consumer, and a backlog means tickets are
    not being emailed and reminders are not being scheduled while every other
    tile is green.

    The threshold is a rate rather than a total: a large outbox that is moving
    is fine, and a small one that has not moved in an hour is not.
    """
    import datetime as dt

    from django.utils import timezone

    from core.models import OutboxEvent

    try:
        cutoff = timezone.now() - dt.timedelta(minutes=15)
        stuck = OutboxEvent.objects.filter(published_at__isnull=True, created_at__lt=cutoff).count()
        if stuck == 0:
            return {"name": "outbox", "status": OK, "detail": "No events older than 15 minutes"}
        return {
            "name": "outbox",
            "status": DEGRADED,
            "detail": f"{stuck} event(s) unpublished for over 15 minutes",
        }
    except Exception:
        logger.exception("console.health.outbox_failed")
        return {"name": "outbox", "status": DEGRADED, "detail": "Could not read the outbox"}


def _shallow_checks() -> list[dict[str, Any]]:
    return [
        _probe_database(),
        _probe_cache(),
        _configured("payments", "PAYMENTS_BACKEND"),
        _configured("storage", "STORAGE_BACKEND"),
        _configured("queue", "QUEUE_BACKEND"),
        _configured("event_bus", "EVENT_BUS_BACKEND"),
        _configured("email", "EMAIL_PROVIDER"),
        _configured("sms", "SMS_PROVIDER"),
    ]


def _deep_checks() -> list[dict[str, Any]]:
    """The shallow set with the three probes that CAN be made real swapped in.

    Queue, event bus, email and SMS stay `configured`. Each would need a side
    effect to probe — enqueuing a job, publishing an event, sending a message —
    and a health check that does any of those is one that fills a queue with
    health checks. They are named as unprobed rather than guessed at.
    """
    checks = [check for check in _shallow_checks() if check["name"] not in {"payments", "storage"}]
    checks.insert(2, _deep_payments())
    checks.insert(3, _deep_storage())
    checks.append(_deep_outbox())
    return checks


def get_health(*, deep: bool = False) -> dict[str, Any]:
    """The status tiles.

    `deep=True` additionally contacts the payment provider and the storage
    bucket and inspects the outbox, and CACHES the result for
    `DEEP_CACHE_TTL_SECONDS` so a dashboard poll never becomes vendor traffic.

    The cache is read-through and failures are non-fatal: a cache outage makes
    deep probing uncached rather than making the health endpoint — the thing
    you look at when infrastructure is broken — itself fail.
    """
    checks = _cached_deep_checks() if deep else _shallow_checks()

    # Only PROBED checks can degrade the overall status. A configured-but-
    # uncontacted adapter is not evidence of a problem.
    degraded = any(check["status"] == DEGRADED for check in checks)
    return {"status": DEGRADED if degraded else OK, "checks": checks, "deep": deep}


def _cached_deep_checks() -> list[dict[str, Any]]:
    from config.di import cache_port

    try:
        cache = cache_port()
        cached = cache.get(_DEEP_CACHE_KEY)
        if cached:
            import json

            return list(json.loads(cached))
    except Exception:
        logger.warning("console.health.deep_cache_read_failed", exc_info=True)

    checks = _deep_checks()
    try:
        import json

        cache_port().set(
            _DEEP_CACHE_KEY, json.dumps(checks), timeout_seconds=DEEP_CACHE_TTL_SECONDS
        )
    except Exception:
        logger.warning("console.health.deep_cache_write_failed", exc_info=True)
    return checks
