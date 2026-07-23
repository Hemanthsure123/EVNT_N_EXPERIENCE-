"""Exercises the real RedisCacheAdapter against a live Redis — the one
adapter test in the suite that needs real infra, deliberately: this is the
adapter that caught the "DRF .data isn't plain-JSON-safe" bug (a ReadOnlyField
for an FK attname like owner_id passes a raw UUID straight through) that the
in-memory locmem fake can't catch, since it never serializes at all. Uses
whatever REDIS_URL the environment provides (TLS locally via docker-compose,
plain in CI) rather than hard-coding either."""

from __future__ import annotations

import datetime
import decimal
import uuid

import pytest
from django.conf import settings

from core.adapters.redis.adapter import RedisCacheAdapter


@pytest.fixture
def redis_cache() -> RedisCacheAdapter:
    return RedisCacheAdapter(url=settings.REDIS_URL)


def test_round_trips_plain_json_values(redis_cache):
    key = "test:redis-adapter:plain"
    redis_cache.set(key, {"a": 1, "b": [1, 2, 3]}, timeout_seconds=30)

    assert redis_cache.get(key) == {"a": 1, "b": [1, 2, 3]}

    redis_cache.delete(key)
    assert redis_cache.get(key) is None


def test_serializes_uuid_decimal_and_datetime_values(redis_cache):
    key = "test:redis-adapter:rich-types"
    value = {
        "id": uuid.uuid4(),
        "amount": decimal.Decimal("19.99"),
        "when": datetime.datetime(2026, 1, 1, 12, 30),
        "day": datetime.date(2026, 1, 1),
    }

    redis_cache.set(key, value, timeout_seconds=30)

    assert redis_cache.get(key) == {
        "id": str(value["id"]),
        "amount": "19.99",
        "when": "2026-01-01T12:30:00",
        "day": "2026-01-01",
    }

    redis_cache.delete(key)


def test_add_only_sets_when_the_key_is_absent(redis_cache):
    key = "test:redis-adapter:add"
    redis_cache.delete(key)

    assert redis_cache.add(key, {"first": True}, timeout_seconds=30) is True
    assert redis_cache.add(key, {"first": False}, timeout_seconds=30) is False
    assert redis_cache.get(key) == {"first": True}

    redis_cache.delete(key)


def test_lock_prevents_concurrent_acquisition(redis_cache):
    key = "test:redis-adapter:lock"

    with redis_cache.lock(key, timeout_seconds=5) as acquired:
        assert acquired is True
        with redis_cache.lock(key, timeout_seconds=5) as acquired_again:
            assert acquired_again is False

    with redis_cache.lock(key, timeout_seconds=5) as acquired_after_release:
        assert acquired_after_release is True


def test_ping(redis_cache):
    assert redis_cache.ping() is True
