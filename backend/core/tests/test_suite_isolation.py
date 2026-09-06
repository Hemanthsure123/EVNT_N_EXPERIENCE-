"""The guarantees `backend/conftest.py` makes, pinned.

That file fixes a failure that was invisible on a developer machine and real on
CI — the anonymous rate limit is a 60-second sliding window over a bucket every
test shares, so it only trips when the suite runs fast enough to pack 120
anonymous requests into one of those windows. It cost five ticketing tests that
had nothing wrong with them.

A fix for a bug that only appears on a faster machine needs a test, or the next
person to tidy up an "unused" root conftest reintroduces it and finds out in CI.

Deliberately NOT in `test_throttling.py`: that module has its own autouse
fixture clearing the cache before AND after every test in it, which would
satisfy the leak probe below no matter what the root conftest did.
"""

from __future__ import annotations

from django.core.cache import cache

from config.di import cache_port

_SENTINEL = "suite-isolation-probe"


class TestThrottleStateDoesNotLeakBetweenTests:
    """Two tests, in definition order, because that IS the property.

    Isolation is a claim about the boundary between tests, so it cannot be
    demonstrated inside one. pytest runs tests within a module in definition
    order, and this suite installs no ordering plugin (`plugins: cov, django`)
    — if one is ever added, this is a legitimate thing for it to break.
    """

    def test_one_test_can_write_to_djangos_cache(self) -> None:
        cache.set(_SENTINEL, "written by the previous test", 300)
        assert cache.get(_SENTINEL) == "written by the previous test"

    def test_and_the_next_test_does_not_inherit_it(self) -> None:
        # The real leak was a throttle counter rather than this key, but it is
        # the same store and the same fixture standing between them. Failing
        # here means every anonymous request in the suite is once again sharing
        # one 120/min budget, and the tests that pay for it will be whichever
        # ones happen to sit where the window fills.
        assert cache.get(_SENTINEL) is None


class TestClearingIsSurgical:
    """The application's cache is a DIFFERENT store, and must stay untouched.

    This is what makes clearing safe to do before every test. Everything the
    app caches goes through `CachePort`; only DRF's throttling reaches for
    Django's cache directly. If those ever became one store, the root fixture
    would start resetting `event:{id}` payloads and the `events:list:gen`
    counter between tests — silently changing the cold/warm query budgets this
    repo pins in CI, which is a far worse failure than the one it fixed.
    """

    def test_clearing_djangos_cache_leaves_the_cacheport_store_alone(self) -> None:
        port = cache_port()
        port.set(_SENTINEL, "app-cached value", timeout_seconds=300)

        cache.clear()

        try:
            assert port.get(_SENTINEL) == "app-cached value"
        finally:
            # `cache_port()` is `lru_cache`d, so this adapter outlives the test.
            port.delete(_SENTINEL)
