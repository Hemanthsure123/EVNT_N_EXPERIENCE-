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
    def ping(self) -> bool:
        """Return True if the backing store is reachable (used by the health check)."""

    @contextmanager
    def lock(self, key: str, *, timeout_seconds: int = 10) -> Iterator[bool]:
        """Best-effort mutual-exclusion lock built on `add`/`delete`.
        Yields True if the lock was acquired. Adapters may override this with a
        native locking primitive (e.g. redis-py's Lock) for stronger guarantees."""
        acquired = self.add(f"lock:{key}", "1", timeout_seconds=timeout_seconds)
        try:
            yield acquired
        finally:
            if acquired:
                self.delete(f"lock:{key}")
