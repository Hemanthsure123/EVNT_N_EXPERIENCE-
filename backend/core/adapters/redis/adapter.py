"""Real CachePort adapter backed by Redis — used whenever CACHE_BACKEND=redis
(the default in dev, staging and prod; only tests use the locmem fake)."""

from __future__ import annotations

import datetime
import decimal
import json
import uuid
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from typing import Any, cast

import redis

from core.ports.cache_port import CachePort


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
        self._client = redis.Redis.from_url(url, decode_responses=True)

    def get(self, key: str) -> Any | None:
        # redis-py's command mixins are shared with its async client, so
        # `.get()` is stub-typed as `Awaitable[Any] | Any` even on this sync
        # client — decode_responses=True makes the real runtime type `str`.
        raw = cast("str | None", self._client.get(key))
        return None if raw is None else json.loads(raw)

    def set(self, key: str, value: Any, *, timeout_seconds: int | None = None) -> None:
        self._client.set(key, json.dumps(value, cls=_CacheJSONEncoder), ex=timeout_seconds)

    def delete(self, key: str) -> None:
        self._client.delete(key)

    def add(self, key: str, value: Any, *, timeout_seconds: int | None = None) -> bool:
        return bool(
            self._client.set(
                key, json.dumps(value, cls=_CacheJSONEncoder), ex=timeout_seconds, nx=True
            )
        )

    def incr(self, key: str, *, delta: int = 1) -> int:
        # Redis INCRBY is atomic and creates the key at 0 if missing. Its
        # integer string is also valid JSON, so a later get() (which json.loads)
        # reads it back as an int without special-casing.
        return int(cast(int, self._client.incrby(key, delta)))

    def ping(self) -> bool:
        return bool(self._client.ping())

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
        acquired = lock.acquire(blocking=blocking_timeout_seconds > 0)
        try:
            yield acquired
        finally:
            if acquired:
                # A slow rebuild can outlast the lock's own timeout; releasing a
                # lock we no longer hold raises LockNotOwnedError, which is
                # harmless here (the point of releasing is just to let waiters in).
                with suppress(redis.exceptions.LockError):
                    lock.release()
