"""In-memory CachePort adapter — used whenever CACHE_BACKEND=locmem (tests)."""

from __future__ import annotations

import time
from typing import Any

from core.ports.cache_port import CachePort


class LocMemCacheAdapter(CachePort):
    def __init__(self) -> None:
        self._store: dict[str, tuple[Any, float | None]] = {}

    def _is_expired(self, expires_at: float | None) -> bool:
        return expires_at is not None and expires_at < time.monotonic()

    def get(self, key: str) -> Any | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if self._is_expired(expires_at):
            del self._store[key]
            return None
        return value

    def set(self, key: str, value: Any, *, timeout_seconds: int | None = None) -> None:
        expires_at = time.monotonic() + timeout_seconds if timeout_seconds else None
        self._store[key] = (value, expires_at)

    def delete(self, key: str) -> None:
        self._store.pop(key, None)

    def add(self, key: str, value: Any, *, timeout_seconds: int | None = None) -> bool:
        if self.get(key) is not None:
            return False
        self.set(key, value, timeout_seconds=timeout_seconds)
        return True

    def incr(self, key: str, *, delta: int = 1) -> int:
        current = self.get(key)
        new_value = (int(current) if current is not None else 0) + delta
        # Preserve any existing TTL semantics loosely: generation counters are
        # long-lived, so keep this key without an expiry (matches Redis INCR).
        self.set(key, new_value)
        return new_value

    def ping(self) -> bool:
        return True
