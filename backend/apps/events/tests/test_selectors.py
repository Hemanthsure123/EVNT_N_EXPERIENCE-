from __future__ import annotations

import pytest

from apps.events.models import EventStatus
from apps.events.selectors import (
    bump_events_list_generation,
    event_detail_cache_key,
    events_list_cache_key,
    get_event_detail_payload,
    get_events_list_generation,
    invalidate_event_caches,
)
from core.adapters.local.locmem_cache import LocMemCacheAdapter


@pytest.fixture
def cache() -> LocMemCacheAdapter:
    return LocMemCacheAdapter()


@pytest.mark.django_db
def test_detail_payload_is_none_for_a_draft(make_event, cache):
    draft = make_event(status=EventStatus.DRAFT)
    assert get_event_detail_payload(draft.id, cache=cache) is None


@pytest.mark.django_db
def test_detail_payload_is_none_for_a_missing_event(cache):
    assert get_event_detail_payload("00000000-0000-0000-0000-000000000000", cache=cache) is None


@pytest.mark.django_db
def test_detail_payload_populates_the_cache_on_a_miss(make_event, cache):
    event = make_event(title="Cached Show", status=EventStatus.LIVE)

    payload = get_event_detail_payload(event.id, cache=cache)

    assert payload is not None
    assert payload["title"] == "Cached Show"
    assert cache.get(event_detail_cache_key(event.id)) == payload


@pytest.mark.django_db
def test_detail_payload_serves_from_cache_without_hitting_the_db(
    make_event, cache, django_assert_num_queries
):
    event = make_event(status=EventStatus.LIVE)
    get_event_detail_payload(event.id, cache=cache)  # warm

    with django_assert_num_queries(0):
        payload = get_event_detail_payload(event.id, cache=cache)

    assert payload is not None


@pytest.mark.django_db
def test_detail_single_flight_loser_still_returns_data_without_writing_cache(make_event, cache):
    event = make_event(status=EventStatus.LIVE)
    key = event_detail_cache_key(event.id)
    # Simulate a concurrent request already holding the rebuild lock.
    cache.set(f"lock:{key}", "1", timeout_seconds=30)

    payload = get_event_detail_payload(event.id, cache=cache)

    assert payload is not None
    # Lost the lock → serves correct data but doesn't write the cache.
    assert cache.get(key) is None


@pytest.mark.django_db
def test_invalidate_clears_detail_and_bumps_list_generation(make_event, cache):
    event = make_event(status=EventStatus.LIVE)
    get_event_detail_payload(event.id, cache=cache)
    gen_before = get_events_list_generation(cache)

    invalidate_event_caches(event.id, cache=cache)

    assert cache.get(event_detail_cache_key(event.id)) is None
    assert get_events_list_generation(cache) == gen_before + 1


def test_list_generation_bumps_change_the_cache_key(cache):
    gen0 = get_events_list_generation(cache)
    key0 = events_list_cache_key(gen0, "abc")

    bump_events_list_generation(cache)

    key1 = events_list_cache_key(get_events_list_generation(cache), "abc")
    assert key0 != key1
