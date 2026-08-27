"""An unreachable cache degrades. It does not raise, and it does not hang.

── WHY THIS BECAME NECESSARY ─────────────────────────────────────────────

With Redis in the same Docker network, a connection error was close to
impossible and an exception escaping `cache.get()` was a bug nobody could
trigger. Pointing `REDIS_URL` at a MANAGED, off-box instance changes that: the
cache is across the internet now, and an internet hop fails for ordinary
reasons — a dropped connection, a rate limit, a maintenance window, a laptop
sleeping mid-request.

Without the handling this file pins, one such blip would 500 the public event
page, the browse list and the ticket panel at once — every surface that reads
through the cache, which is every surface that matters.

── THE TEST POINTS AT A CLOSED PORT, NOT A MOCK ──────────────────────────

A mocked client proves the `except` clause is written; it does not prove the
exception a real socket raises is one of the three the clause catches. So
these connect to a port nothing is listening on and let redis-py produce the
genuine article. It is the same reasoning `FakePaymentAdapter` follows by
doing real HMAC rather than pretending.
"""

from __future__ import annotations

import time

import pytest
import redis

from core.adapters.redis.adapter import (
    _TIMEOUT_SECONDS,
    _UNAVAILABLE,
    RedisCacheAdapter,
    _is_degradable,
)

#: A port on the loopback with nothing behind it. Connecting is refused
#: immediately, which is the fastest honest way to produce a real
#: `redis.exceptions.ConnectionError`.
DEAD = "redis://127.0.0.1:6399/0"


@pytest.fixture
def dead() -> RedisCacheAdapter:
    return RedisCacheAdapter(url=DEAD)


class TestEveryReadDegradesToAMiss:
    def test_get_returns_None_rather_than_raising(self, dead):
        """The whole design. Every read path here is cache-ASIDE, so a miss
        makes the caller do what it would have done on a cold cache — slower,
        and completely correct."""
        assert dead.get("event:123") is None

    def test_set_is_a_silent_no_op(self, dead):
        """Nothing to recover: the value the caller just computed is already on
        its way to the client."""
        dead.set("event:123", {"title": "Anything"}, timeout_seconds=60)

    def test_delete_is_a_silent_no_op(self, dead):
        """The one degradation with a visible consequence — a stale entry until
        its TTL. Failing the WRITE that triggered it, which has already
        committed, would be strictly worse."""
        dead.delete("event:123")

    def test_add_reports_the_claim_was_NOT_made(self, dead):
        """False, not True. `add` means "claim this if nobody has", and the
        honest answer when the claim could not be made is that it was not —
        every caller treats a lost claim as a reason to do less, not more."""
        assert dead.add("idempotency:abc", 1, timeout_seconds=60) is False

    def test_incr_returns_zero(self, dead):
        """Safe for both callers: a generation that fails to advance orphans
        nothing, and the check-in counter's source of truth is the database."""
        assert dead.incr("events:list:gen") == 0

    def test_ping_reports_FALSE_rather_than_raising(self, dead):
        """The health endpoint probes this. A tile that is red because the
        cache is down is the point of having the tile."""
        assert dead.ping() is False


class TestTheLock:
    def test_it_yields_False_rather_than_raising(self, dead):
        """Callers treat a lost lock as "somebody else is rebuilding, do the
        cheap thing" — so an unreachable cache turns single-flight off and N
        requests rebuild concurrently. That is the pre-lock behaviour against a
        query that is already index-backed: a stampede, not an outage."""
        with dead.lock("event:123", timeout_seconds=5) as acquired:
            assert acquired is False

    def test_the_blocking_variant_also_yields_False(self, dead):
        """The single-flight path on the hottest public read."""
        with dead.lock("event:123", timeout_seconds=5, blocking_timeout_seconds=1) as acquired:
            assert acquired is False

    def test_it_does_not_try_to_release_a_lock_it_never_took(self, dead):
        """Releasing an unheld lock raises `LockNotOwnedError`, which is NOT in
        the unavailable set — it would escape the context manager and turn a
        degraded read into a 500 on the way out."""
        with dead.lock("event:123") as acquired:
            assert acquired is False
        # Reaching here at all is the assertion: the `finally` did not raise.


class TestItNeverHangs:
    def test_a_timeout_is_configured_on_both_the_connect_and_the_read(self, dead):
        """redis-py defaults BOTH to `None` — wait forever. On an off-box host
        that turns a network stall into a request that never returns and a
        worker that never comes back, which is strictly worse than an error
        because nothing reports it."""
        kwargs = dead._client.connection_pool.connection_kwargs
        assert kwargs["socket_connect_timeout"] == _TIMEOUT_SECONDS
        assert kwargs["socket_timeout"] == _TIMEOUT_SECONDS

    def test_a_dead_host_fails_FAST(self, dead):
        """A refused connection returns immediately. This guards the shape of
        the failure, not the exact number: a read that takes the full timeout
        on every request would be a five-second page."""
        started = time.monotonic()
        dead.get("event:123")
        assert time.monotonic() - started < _TIMEOUT_SECONDS


class TestWhatIsDeliberatelyNOTSwallowed:
    def test_the_unavailable_set_is_narrow(self):
        """Transport failures only. A bad reply, a scripting error or a bug in
        the adapter is a REAL fault that has to surface — swallowing those into
        a cache miss is how a broken cache goes unnoticed for a month."""
        assert (
            redis.exceptions.ConnectionError,
            redis.exceptions.TimeoutError,
            redis.exceptions.BusyLoadingError,
        ) == _UNAVAILABLE

    def test_a_data_error_is_NOT_treated_as_unavailable(self):
        assert not issubclass(redis.exceptions.DataError, _UNAVAILABLE)
        assert not issubclass(redis.exceptions.ResponseError, _UNAVAILABLE)

    def test_a_ResponseError_is_not_transport_but_MAY_still_degrade(self):
        """Read the assertion above carefully, because taken alone it states
        the belief that caused a production outage.

        `ResponseError` is correctly absent from `_UNAVAILABLE` — it is not a
        transport failure. But "not transport" does not mean "must always
        raise": when a hosted Redis answers `max requests limit exceeded`, it
        is refusing for a CAPACITY reason, which is identical in consequence
        to being unreachable. That case degraded nowhere, so it 500'd every
        read path that writes back to the cache.

        The rule is `_is_degradable`, not `_UNAVAILABLE` membership.
        See `test_redis_cache_quota_refusal.py`.
        """
        quota = redis.exceptions.ResponseError("max requests limit exceeded. Limit: 500000")
        our_bug = redis.exceptions.ResponseError("WRONGTYPE Operation against a key")

        assert not isinstance(quota, _UNAVAILABLE)
        assert _is_degradable(quota)
        assert not _is_degradable(our_bug)


@pytest.mark.django_db
def test_the_public_event_page_still_answers_with_the_cache_down(settings, client):
    """End to end, and the reason all of the above matters.

    The detail read is `cache.get` → miss → single-flight `lock` → DB → `set`.
    With the cache unreachable, every one of those degrades and the page is
    served from Postgres — which is exactly what a cold cache does.
    """
    import datetime as dt

    from django.utils import timezone

    from apps.accounts.models import User
    from apps.events.models import Event, EventStatus
    from apps.events.selectors import get_event_detail_payload
    from apps.organizations.models import Organization

    owner = User.objects.create_user(email="cache-down@example.com", password="owner12345")
    org = Organization.objects.create(owner=owner, name="Cache Co")
    event = Event.objects.create(
        organization=org,
        title="Still Serving",
        venue="V",
        city="Mumbai",
        starts_at=timezone.now() + dt.timedelta(days=5),
        status=EventStatus.LIVE,
    )

    payload = get_event_detail_payload(event.id, cache=RedisCacheAdapter(url=DEAD))

    assert payload is not None
    assert payload["title"] == "Still Serving"
