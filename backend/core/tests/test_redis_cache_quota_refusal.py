"""A cache that ANSWERS "no" degrades exactly like one that never answered.

── THE OUTAGE THIS FILE EXISTS TO PREVENT ────────────────────────────────

`test_redis_cache_fails_open.py` already pins the unreachable case, and its
docstring names "a rate limit" among the ordinary reasons a managed cache
fails. But every test in it points at a CLOSED PORT, which can only ever
produce `redis.exceptions.ConnectionError`. The rate-limit case was named and
never actually exercised — so nobody noticed that `_UNAVAILABLE` did not
contain the exception a rate limit actually raises.

It does not raise a connection error. Upstash accepts the connection and
replies, in-band:

    ResponseError: max requests limit exceeded. Limit: 500000, Usage: 500000

`ResponseError` was uncaught, so it propagated out of `cache.set()` — and
because it is the WRITE-BACK half of cache-aside that failed, it took down
every read path that had already done its real work:

    GET /api/v1/events        500     <- rows fetched, then died caching them
    GET /api/v1/homepage      500
    GET /api/v1/announcements 500
    GET /health/              200     <- database: true, cache: true

The database was healthy. The rows were in hand. The response died putting a
copy into a cache it did not need, and the platform served no events at all
until somebody read a traceback.

── WHY THESE INJECT INSTEAD OF POINTING AT A REAL SERVER ─────────────────

The sibling file's "point at a dead port, not a mock" reasoning is right and
is not abandoned lightly. It does not transfer here: a refused CONNECTION is
free to produce on demand, and an exhausted monthly QUOTA is not — there is
no way to make a real Redis emit one without actually exhausting it. So the
exception is injected at the client boundary, and the strings are copied
VERBATIM from the production log and from Redis's own error table, because
the classifier reads those strings and a paraphrase would test nothing.
"""

from __future__ import annotations

import pytest
import redis

from core.adapters.redis.adapter import (
    RedisCacheAdapter,
    _is_capacity_refusal,
    _is_degradable,
)

#: Copied verbatim from the production log line that caused the outage.
UPSTASH_QUOTA = "max requests limit exceeded. Limit: 500000, Usage: 500000"

#: Redis's own capacity refusals, as the server words them.
OOM = "OOM command not allowed when used memory > 'maxmemory'."
READONLY = "READONLY You can't write against a read only replica."
MISCONF = "MISCONF Redis is configured to save RDB snapshots, but is currently not able to persist"

#: A real fault. Ours, not the server's, and it must never be swallowed.
WRONGTYPE = "WRONGTYPE Operation against a key holding the wrong kind of value"
UNKNOWN_COMMAND = "unknown command 'GTE', with args beginning with:"


class _RefusingClient:
    """Answers every command with the same server-side refusal."""

    def __init__(self, message: str) -> None:
        self._exc = redis.exceptions.ResponseError(message)

    def _raise(self, *args: object, **kwargs: object) -> object:
        raise self._exc

    get = set = delete = incrby = ping = _raise

    def lock(self, *args: object, **kwargs: object) -> _RefusingClient:
        return self

    def acquire(self, *args: object, **kwargs: object) -> object:
        raise self._exc


@pytest.fixture
def refusing():
    def _build(message: str) -> RedisCacheAdapter:
        adapter = RedisCacheAdapter(url="redis://127.0.0.1:6399/0")
        adapter._client = _RefusingClient(message)  # type: ignore[assignment]
        return adapter

    return _build


class TestTheClassifier:
    """The one rule, tested directly so its edges are pinned independently of
    any single call site."""

    @pytest.mark.parametrize("message", [UPSTASH_QUOTA, OOM, READONLY, MISCONF])
    def test_capacity_refusals_are_recognised(self, message):
        assert _is_capacity_refusal(redis.exceptions.ResponseError(message))
        assert _is_degradable(redis.exceptions.ResponseError(message))

    @pytest.mark.parametrize("message", [WRONGTYPE, UNKNOWN_COMMAND])
    def test_our_own_bugs_are_not(self, message):
        """The widened catch must not become a blanket amnesty. A WRONGTYPE
        means this file sent the wrong command for the key — swallowing it is
        how a cache silently stops working and nobody finds out for a month."""
        assert not _is_capacity_refusal(redis.exceptions.ResponseError(message))
        assert not _is_degradable(redis.exceptions.ResponseError(message))

    def test_transport_failures_still_degrade(self):
        assert _is_degradable(redis.exceptions.ConnectionError("refused"))
        assert _is_degradable(redis.exceptions.TimeoutError("slow"))


class TestQuotaExhaustionDegrades:
    """Every method, because the outage proved that missing ONE of them is
    enough to take the platform down."""

    def test_set_does_not_raise(self, refusing):
        """THE regression. `apps/events/api.py` calls this after the rows are
        already fetched and serialized; raising here threw away a complete,
        correct response."""
        refusing(UPSTASH_QUOTA).set("events:list:v1:abc", {"data": []}, timeout_seconds=30)

    def test_get_is_a_miss(self, refusing):
        assert refusing(UPSTASH_QUOTA).get("event:123") is None

    def test_delete_does_not_raise(self, refusing):
        refusing(UPSTASH_QUOTA).delete("event:123")

    def test_add_reports_the_claim_was_not_made(self, refusing):
        assert refusing(UPSTASH_QUOTA).add("lock:x", 1, timeout_seconds=5) is False

    def test_incr_returns_zero(self, refusing):
        assert refusing(UPSTASH_QUOTA).incr("events:list:gen") == 0

    def test_lock_yields_not_acquired(self, refusing):
        with refusing(UPSTASH_QUOTA).lock("event:123") as acquired:
            assert acquired is False

    def test_ping_reports_degraded_rather_than_raising(self, refusing):
        """`/health/` PROBES this. A quota-exhausted cache is degraded, and the
        health tile must say so — it reported `cache: true` throughout the
        outage because `ping` never got as far as the quota."""
        assert refusing(UPSTASH_QUOTA).ping() is False

    @pytest.mark.parametrize("message", [OOM, READONLY, MISCONF])
    def test_redis_own_capacity_refusals_degrade_too(self, refusing, message):
        refusing(message).set("k", {"v": 1}, timeout_seconds=30)
        assert refusing(message).get("k") is None


class TestRealFaultsStillSurface:
    """The other half, and the reason this is a classifier rather than a
    blanket `except redis.exceptions.RedisError`."""

    @pytest.mark.parametrize("message", [WRONGTYPE, UNKNOWN_COMMAND])
    def test_set_still_raises(self, refusing, message):
        with pytest.raises(redis.exceptions.ResponseError):
            refusing(message).set("k", {"v": 1}, timeout_seconds=30)

    @pytest.mark.parametrize("message", [WRONGTYPE, UNKNOWN_COMMAND])
    def test_get_still_raises(self, refusing, message):
        with pytest.raises(redis.exceptions.ResponseError):
            refusing(message).get("k")

    def test_ping_still_raises(self, refusing):
        with pytest.raises(redis.exceptions.ResponseError):
            refusing(WRONGTYPE).ping()
