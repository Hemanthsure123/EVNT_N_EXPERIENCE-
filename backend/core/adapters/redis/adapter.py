"""Real CachePort adapter backed by Redis — used whenever CACHE_BACKEND=redis
(the default in dev, staging and prod; only tests use the locmem fake).

── IT FAILS OPEN, AND THAT IS THE MOST IMPORTANT THING ON THIS PAGE ──────

Every read path on this platform is cache-ASIDE: the cache is an optimisation
over a query the database can still answer. So an unreachable Redis must
produce a MISS, not an exception — the request then does what it would have
done on a cold cache, which is slower and completely correct.

This was not always a live concern. With Redis in the same Docker network a
connection error was close to impossible, and an exception propagating out of
`cache.get()` would have been a real bug nobody could trigger. Pointing
`REDIS_URL` at a MANAGED, off-box instance (Upstash) changes that: the cache
is now across the internet, and an internet hop fails for ordinary reasons —
a dropped connection, a rate limit, a maintenance window, somebody's laptop
sleeping mid-request.

Without this, one such blip would 500 the public event page, the browse list
and the ticket panel simultaneously — every surface that reads through the
cache, which is every surface that matters. With it, they get slower.

That is the same posture `core/throttling.py` already takes for the same
reason it gives: a shut door at a venue is worse than a window of unmetered
requests. Correctness never depended on the cache — the reserve decision is
made under a row lock, and the CHECK constraint is the backstop — so
degrading is safe in the strong sense, not merely tolerable.

── AND IT NEVER HANGS ────────────────────────────────────────────────────

Timeouts are set explicitly. redis-py's default is to wait FOREVER on a
socket, which on a remote host turns a network stall into a request that
never returns and a worker that never comes back — strictly worse than an
error, because nothing reports it. Five seconds is far longer than a healthy
round trip (~25ms to a managed instance in another region) and far shorter
than a user's patience.
"""

from __future__ import annotations

import datetime
import decimal
import json
import logging
import uuid
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from typing import Any, cast

import redis

from core.ports.cache_port import CachePort

logger = logging.getLogger(__name__)

#: How long any single Redis call may take before it is treated as a miss.
#:
#: Applied to both the connect and the read. redis-py defaults BOTH to `None`
#: — wait forever — which is the wrong default for anything off-box.
_TIMEOUT_SECONDS = 5.0

#: What "the cache is unavailable" looks like. Deliberately NARROW: these are
#: transport failures, and anything else (a bad reply, a scripting error, a
#: bug in this file) is a real fault that must surface rather than be silently
#: swallowed into a cache miss nobody notices for a month.
_UNAVAILABLE = (
    redis.exceptions.ConnectionError,
    redis.exceptions.TimeoutError,
    redis.exceptions.BusyLoadingError,
)


class _CacheJSONEncoder(json.JSONEncoder):
    """CachePort.set(value: Any) doesn't promise callers a plain-JSON-safe
    value — and DRF serializer `.data` genuinely isn't one: it can still
    contain framework-native rich types (UUID, Decimal, datetime) that only
    become strings once DRF's own renderer runs. Concretely, a
    ModelSerializer field for an FK attname like "owner_id" resolves to a
    bare ReadOnlyField that passes the raw UUID through unchanged. Handling
    these here keeps every caller simple instead of requiring each one to
    remember to pre-sanitize its data."""

    def default(self, o: object) -> object:
        if isinstance(o, uuid.UUID | decimal.Decimal):
            return str(o)
        if isinstance(o, datetime.datetime | datetime.date):
            return o.isoformat()
        return super().default(o)


class RedisCacheAdapter(CachePort):
    def __init__(self, *, url: str) -> None:
        self._client = redis.Redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=_TIMEOUT_SECONDS,
            socket_timeout=_TIMEOUT_SECONDS,
            # Reconnect rather than hand back a socket the peer closed. A
            # managed instance drops idle connections, and without this the
            # first request after a quiet spell fails on a dead socket that
            # looked fine.
            health_check_interval=30,
            retry_on_timeout=True,
        )

    def _unavailable(self, operation: str, key: str, exc: Exception) -> None:
        """One log line per degraded call, at WARNING.

        Not ERROR: the request succeeded, just slowly. Not silence either —
        "the cache has been down for a week and everything is fine" is a
        sentence somebody should be able to disprove from the logs.
        """
        logger.warning(
            "cache.unavailable",
            extra={"operation": operation, "cache_key": key, "error": str(exc)},
        )

    def get(self, key: str) -> Any | None:
        # redis-py's command mixins are shared with its async client, so
        # `.get()` is stub-typed as `Awaitable[Any] | Any` even on this sync
        # client — decode_responses=True makes the real runtime type `str`.
        try:
            raw = cast("str | None", self._client.get(key))
        except _UNAVAILABLE as exc:
            # A MISS, which is the whole design: the caller falls through to
            # the query the cache was standing in front of.
            self._unavailable("get", key, exc)
            return None
        return None if raw is None else json.loads(raw)

    def set(self, key: str, value: Any, *, timeout_seconds: int | None = None) -> None:
        try:
            self._client.set(key, json.dumps(value, cls=_CacheJSONEncoder), ex=timeout_seconds)
        except _UNAVAILABLE as exc:
            # Nothing to recover: the value the caller just computed is already
            # on its way to the client. The next read simply recomputes it.
            self._unavailable("set", key, exc)

    def delete(self, key: str) -> None:
        try:
            self._client.delete(key)
        except _UNAVAILABLE as exc:
            # The one degradation with a visible consequence: an invalidation
            # that did not land leaves a stale entry until its TTL expires.
            # Every key on this platform carries one (30s-5min), so the window
            # is bounded — and failing the WRITE that triggered it, which has
            # already committed, would be strictly worse.
            self._unavailable("delete", key, exc)

    def add(self, key: str, value: Any, *, timeout_seconds: int | None = None) -> bool:
        try:
            return bool(
                self._client.set(
                    key, json.dumps(value, cls=_CacheJSONEncoder), ex=timeout_seconds, nx=True
                )
            )
        except _UNAVAILABLE as exc:
            # FALSE, not True. `add` is "claim this if nobody has" — the honest
            # answer when the claim could not be made is that it was not made,
            # and every caller treats a lost claim as a reason to do less
            # rather than more.
            self._unavailable("add", key, exc)
            return False

    def incr(self, key: str, *, delta: int = 1) -> int:
        # Redis INCRBY is atomic and creates the key at 0 if missing. Its
        # integer string is also valid JSON, so a later get() (which json.loads)
        # reads it back as an int without special-casing.
        try:
            return int(cast(int, self._client.incrby(key, delta)))
        except _UNAVAILABLE as exc:
            # 0 is the safe answer for both callers. The events list keys on a
            # GENERATION counter, and a generation that fails to advance
            # orphans nothing — readers keep the current one until the TTL
            # expires. The check-in admitted counter is a display value whose
            # source of truth is the database, and it self-heals on the next
            # reconcile.
            self._unavailable("incr", key, exc)
            return 0

    def ping(self) -> bool:
        try:
            return bool(self._client.ping())
        except _UNAVAILABLE:
            # The health endpoint PROBES this, and it must report the truth
            # rather than an exception: a tile that is red because the cache is
            # down is the point. No log line — the caller is asking, so it is
            # not an incidental degradation.
            return False

    @contextmanager
    def lock(
        self, key: str, *, timeout_seconds: int = 10, blocking_timeout_seconds: float = 0
    ) -> Iterator[bool]:
        # blocking_timeout_seconds > 0 → a loser waits up to that long for the
        # winner to release (single-flight rebuild); 0 → one non-blocking try.
        lock = self._client.lock(
            f"lock:{key}",
            timeout=timeout_seconds,
            blocking_timeout=blocking_timeout_seconds or None,
        )
        try:
            acquired = lock.acquire(blocking=blocking_timeout_seconds > 0)
        except _UNAVAILABLE as exc:
            # NOT acquired. Every caller of this treats a lost lock as "somebody
            # else is rebuilding, do the cheap thing" — so an unreachable cache
            # means single-flight protection is off and N requests rebuild
            # concurrently. That is precisely the pre-lock behaviour, and it is
            # a stampede against a query that is already index-backed rather
            # than an outage.
            self._unavailable("lock", key, exc)
            yield False
            return
        try:
            yield acquired
        finally:
            if acquired:
                # A slow rebuild can outlast the lock's own timeout; releasing a
                # lock we no longer hold raises LockNotOwnedError, which is
                # harmless here (the point of releasing is just to let waiters in).
                with suppress(redis.exceptions.LockError):
                    lock.release()
