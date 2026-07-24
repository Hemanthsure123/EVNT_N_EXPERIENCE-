"""Port for cache + distributed locks (Redis in every real environment).

Redis itself isn't swapped for a different vendor in production the way
payments/storage/email are, but it's still a third-party dependency the
business layer must not talk to directly — services depend on this
interface so unit tests can use an in-memory fake with zero infra, and so
the health check can verify connectivity without knowing which client
library is behind it.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any


class CachePort(ABC):
    @abstractmethod
    def get(self, key: str) -> Any | None: ...

    @abstractmethod
    def set(self, key: str, value: Any, *, timeout_seconds: int | None = None) -> None: ...

    @abstractmethod
    def delete(self, key: str) -> None: ...

    @abstractmethod
    def add(self, key: str, value: Any, *, timeout_seconds: int | None = None) -> bool:
        """Set `key` only if it doesn't already exist. Returns True if it was set.
        The primitive building block for short-lived reservation locks."""

    @abstractmethod
    def incr(self, key: str, *, delta: int = 1) -> int:
        """Atomically add `delta` to the integer at `key` (treating a missing
        key as 0) and return the new value. The building block for a cache
        *generation* counter: bumping one integer atomically invalidates every
        cache entry whose key embeds the old generation, without having to
        track and delete each of those (hash-keyed) entries individually."""

    @abstractmethod
    def ping(self) -> bool:
        """Return True if the backing store is reachable (used by the health check)."""

    @contextmanager
    def lock(
        self, key: str, *, timeout_seconds: int = 10, blocking_timeout_seconds: float = 0
    ) -> Iterator[bool]:
        """Best-effort mutual-exclusion lock built on `add`/`delete`.

        Yields True if the lock was acquired. With `blocking_timeout_seconds > 0`
        a caller that loses the race waits up to that long for the holder to
        release — the basis for single-flight cache rebuilds (only one request
        rebuilds a hot key; the rest wait briefly, then read the freshly-cached
        value). This add-based fallback can't truly block, so it always makes a
        single non-blocking attempt regardless; real adapters (see the Redis
        adapter) override this with a native blocking lock."""
        acquired = self.add(f"lock:{key}", "1", timeout_seconds=timeout_seconds)
        try:
            yield acquired
        finally:
            if acquired:
                self.delete(f"lock:{key}")
