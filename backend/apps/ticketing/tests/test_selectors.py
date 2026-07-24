from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.ticketing.selectors import (
    event_tiers_cache_key,
    get_event_tiers_payload,
    invalidate_event_tiers_cache,
)
from core.adapters.local.locmem_cache import LocMemCacheAdapter


@pytest.fixture
def cache() -> LocMemCacheAdapter:
    return LocMemCacheAdapter()


@pytest.mark.django_db
def test_tiers_payload_includes_availability_and_on_sale_flag(event, make_ticket_type, cache):
    make_ticket_type(name="Gold", price_minor=5000, quantity=50, reserved=10)

    payload = get_event_tiers_payload(event.id, cache=cache)

    assert len(payload) == 1
    tier = payload[0]
    assert tier["name"] == "Gold"
    assert tier["price"] == 5000
    assert tier["available"] == 40  # 50 - 0 sold - 10 reserved
    assert tier["is_on_sale"] is True


@pytest.mark.django_db
def test_tiers_payload_marks_sold_out_tier_not_on_sale(event, make_ticket_type, cache):
    make_ticket_type(name="Gone", quantity=5, reserved=5)  # nothing left

    payload = get_event_tiers_payload(event.id, cache=cache)

    assert payload[0]["available"] == 0
    assert payload[0]["is_on_sale"] is False


@pytest.mark.django_db
def test_tiers_payload_marks_future_sale_not_on_sale(event, make_ticket_type, cache):
    make_ticket_type(quantity=10, sale_start=timezone.now() + timedelta(days=1))

    payload = get_event_tiers_payload(event.id, cache=cache)

    assert payload[0]["is_on_sale"] is False


@pytest.mark.django_db
def test_tiers_payload_serves_from_cache_without_hitting_the_db(
    event, make_ticket_type, cache, django_assert_num_queries
):
    make_ticket_type()
    get_event_tiers_payload(event.id, cache=cache)  # warm

    with django_assert_num_queries(0):
        payload = get_event_tiers_payload(event.id, cache=cache)
    assert len(payload) == 1


@pytest.mark.django_db
def test_invalidate_clears_the_tiers_cache(event, make_ticket_type, cache):
    make_ticket_type()
    get_event_tiers_payload(event.id, cache=cache)
    assert cache.get(event_tiers_cache_key(event.id)) is not None

    invalidate_event_tiers_cache(event.id, cache=cache)

    assert cache.get(event_tiers_cache_key(event.id)) is None
