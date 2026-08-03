"""Shared fixtures for the accounts tests.

The auth endpoints are the most heavily throttled surface on the platform
(`THROTTLE_AUTH`, 10/min, keyed by IP), and these tests drive them with real
HTTP requests from a single client address. That makes the throttle budget a
piece of state SHARED between tests in the process — and Django's locmem cache
does not reset between them.

The symptom is ugly and misleading: a test that has nothing to do with rate
limiting fails with 429, and only when run in a particular order or after a
file slow enough to shift the timing. It surfaced when a new test module was
added alongside these — the module added no HTTP requests at all, it simply
changed when these ran.

`core/tests/test_throttling.py` already carries this fixture for the same
reason ("the first test to exhaust a limit leaves the next one already
throttled"). This applies the same precedent here rather than leaving the
accounts suite a couple of requests below the limit and order-sensitive.
"""

from __future__ import annotations

import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _clean_throttle_cache():
    """Every test starts with a full rate-limit budget.

    Clearing on the way OUT as well means a test that deliberately exhausts a
    limit cannot leak that state into whatever runs next.
    """
    cache.clear()
    yield
    cache.clear()
