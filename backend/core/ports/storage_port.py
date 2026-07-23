"""Port for object storage (Google Cloud Storage in production, local disk in dev)."""

from __future__ import annotations

from abc import ABC, abstractmethod


class StoragePort(ABC):
    @abstractmethod
    def upload(self, *, path: str, content: bytes, content_type: str) -> str:
        """Store `content` at `path` and return a URL clients can use to fetch it."""

    @abstractmethod
    def delete(self, *, path: str) -> None:
        """Remove the object at `path`. No-op if it doesn't exist."""

    @abstractmethod
    def signed_url(self, *, path: str, expires_in_seconds: int = 3600) -> str:
        """Return a time-limited URL for private objects."""
