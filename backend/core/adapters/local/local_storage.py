"""Local-disk StoragePort adapter — used whenever STORAGE_BACKEND=local."""

from __future__ import annotations

import logging
from pathlib import Path

from django.conf import settings

from core.ports.storage_port import StoragePort

logger = logging.getLogger(__name__)


class LocalStorageAdapter(StoragePort):
    def __init__(self, *, root: Path | None = None, base_url: str = "/media/") -> None:
        self._root = root or Path(settings.MEDIA_ROOT)
        self._base_url = base_url
        self._root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, path: str) -> Path:
        full_path = (self._root / path).resolve()
        if self._root.resolve() not in full_path.parents and full_path != self._root.resolve():
            raise ValueError(f"Path escapes storage root: {path}")
        return full_path

    def upload(self, *, path: str, content: bytes, content_type: str) -> str:
        full_path = self._resolve(path)
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_bytes(content)
        logger.info("local_storage.uploaded", extra={"path": path, "content_type": content_type})
        return f"{self._base_url}{path}"

    def delete(self, *, path: str) -> None:
        full_path = self._resolve(path)
        full_path.unlink(missing_ok=True)

    def signed_url(self, *, path: str, expires_in_seconds: int = 3600) -> str:
        # Local dev has no notion of a signed URL — plain media URLs are
        # already served directly by the dev server.
        return f"{self._base_url}{path}"
