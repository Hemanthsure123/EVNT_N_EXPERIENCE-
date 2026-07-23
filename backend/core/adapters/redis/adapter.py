"""Real CachePort adapter backed by Redis — used whenever CACHE_BACKEND=redis
(the default in dev, staging and prod; only tests use the locmem fake)."""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, cast

import redis

from core.ports.cache_port import CachePort


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
        self._client.set(key, json.dumps(value), ex=timeout_seconds)

    def delete(self, key: str) -> None:
        self._client.delete(key)

    def add(self, key: str, value: Any, *, timeout_seconds: int | None = None) -> bool:
        return bool(self._client.set(key, json.dumps(value), ex=timeout_seconds, nx=True))

    def ping(self) -> bool:
        return bool(self._client.ping())

    @contextmanager
    def lock(self, key: str, *, timeout_seconds: int = 10) -> Iterator[bool]:
        lock = self._client.lock(f"lock:{key}", timeout=timeout_seconds, blocking_timeout=0)
        acquired = lock.acquire()
        try:
            yield acquired
        finally:
            if acquired:
                lock.release()
