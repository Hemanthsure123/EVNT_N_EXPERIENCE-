"""Suite-wide test isolation.

## Why this file exists: a rate limit is a clock, and a test suite is fast

`core/tests/test_throttling.py` has carried this fixture, and this exact
reasoning, since throttling landed:

    # Throttle counters live in Django's cache. Without this, the first test
    # to exhaust a limit leaves the next one already throttled.

That was correct and it was scoped to one file, so it protected the throttle
tests from each other and nothing else from either. Everything below is what
that gap eventually cost.

`BurstAnonThrottle` is a DEFAULT throttle class (`REST_FRAMEWORK
["DEFAULT_THROTTLE_CLASSES"]`), so it applies to EVERY unauthenticated request
this suite makes — every public event read, every tier list, every offers
lookup. `AnonRateThrottle` keys on the client IP, and every request from
`APIClient` arrives from `127.0.0.1`. So the whole suite shares ONE bucket.

The rate is `120/min`, and `SimpleRateThrottle` measures that as a sliding
window over WALL CLOCK: it keeps a list of request timestamps and drops the
ones older than 60 seconds. Nothing about that is per-test.

**Which makes the failure a function of how FAST the machine is**, and that is
why it hid for so long. The same commit, on the same commit content:

    CI (2 vCPU runner)   2873 tests in  91.7s  ->  5 failed
    a local container    2873 tests in ~200s   ->  0 failed

Under 200 seconds the anonymous requests spread thinly enough that no 60-second
window ever held 120 of them. Under 92 seconds they did, and from that moment
until the window drained, every anonymous read in the suite answered `429`. It
landed on `apps/ticketing/tests/` purely because of where those tests sit in
collection order — the five that failed had nothing in common except being
anonymous and being in the wrong place at the wrong second.

Read that failure without this note and it looks like a ticketing regression:
one `assert 429 == 200` and four `KeyError: 'data'`, which is the same 429
error envelope being subscripted for a payload it does not carry.

**It was also going to get worse on its own.** Every API test added moves the
suite further over the line, and which tests fail depends on collection order
and machine speed — so the same commit can be green locally, red in CI, and red
on a DIFFERENT five tests tomorrow.

## Why clearing the cache is the fix, and not turning the limiter off

The tempting fix is to raise or disable the rates under `config/settings/test`.
`core/tests/test_throttling.py` already refuses that, in a docstring, twice:

    Fired at the REAL shipped rate, not an overridden one. [...] a test that
    appeared to pass against an override would be testing a rate that does not
    ship.

The limiter in this codebase has been silently broken once already — it
subclassed `ScopedRateThrottle`, which returns True when `view.throttle_scope`
is absent, so every rate test passed while nothing was limited. Weakening the
rates in test settings is how that returns. The limits stay exactly as they
ship; what changes is that each test starts from zero, which is what "isolated"
means and what every other piece of per-test state here already gets.

## Why this is surgical rather than broad

`django.core.cache` and the application's cache are **different stores** in this
codebase, and that is not an accident of this change — it is how the ports and
adapters layer is built. Everything the app caches goes through `CachePort`, and
under `CACHE_BACKEND=locmem` that is `LocMemCacheAdapter`, which holds its own
private `_store` dict (`core/adapters/local/locmem_cache.py`). DRF's throttling
is the one thing in the system that reaches for Django's cache directly.

So `cache.clear()` here empties throttle counters and **nothing else**. No
cached org payload, no `event:{id}` entry, no `events:list:gen` generation
counter moves. That matters: the query-budget assertions this repo pins in CI
(`django_assert_num_queries`, cold vs warm) are measured through `CachePort`,
and a fixture that reset those would change the numbers it is supposed to be
protecting.

Cleared on SETUP only. Clearing on teardown as well would be harmless but adds
nothing — a test's isolation is established by what it starts with, and doing it
one way means there is one place to look.
"""

from __future__ import annotations

import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _isolate_throttle_state() -> None:
    """Give every test its own rate-limit budget.

    Autouse and unscoped on purpose: the anonymous throttle applies to every
    unauthenticated request, so opting in per module would leave exactly the
    silent, order-dependent gap this exists to close.
    """
    cache.clear()
