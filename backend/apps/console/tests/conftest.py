"""Shared fixtures for console tests.

The console's selectors are cache-aside (see selectors.py), and a cache is
exactly the state Django's per-test transaction rollback does NOT undo — so
without this, the first test to read the overview serves its numbers to every
test after it. That is the classic "passes alone, fails in the suite" shape,
and it showed up here immediately.

It has to clear the DI cache, not `django.core.cache`. `cache_port()` is an
`@lru_cache` singleton wrapping the adapter's OWN dict (see
`core/adapters/local/locmem_cache.py`), which Django's cache framework knows
nothing about. Busting the lru_cache hands each test a brand-new adapter,
which is both simpler and more thorough than reaching into `_store`.
"""

from __future__ import annotations

import pytest

from config.di import cache_port


@pytest.fixture(autouse=True)
def _fresh_cache():
    cache_port.cache_clear()
    yield
    cache_port.cache_clear()
