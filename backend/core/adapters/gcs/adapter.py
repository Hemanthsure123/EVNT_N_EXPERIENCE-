"""Real StoragePort adapter backed by Google Cloud Storage.

Requires the optional `gcp` extra (`pip install -e ".[gcp]"`). Only
imported by config/di.py when STORAGE_BACKEND=gcs. In production this runs
with an attached, least-privilege service account — never a downloaded key
file (GOOGLE_APPLICATION_CREDENTIALS is a *local-dev-only* convenience)."""

from __future__ import annotations

from google.cloud import storage

from core.ports.storage_port import StoragePort


class GCSStorageAdapter(StoragePort):
    def __init__(self, *, bucket_name: str, project_id: str) -> None:
        self._client = storage.Client(project=project_id)
        self._bucket = self._client.bucket(bucket_name)

    def upload(self, *, path: str, content: bytes, content_type: str) -> str:
        blob = self._bucket.blob(path)
        blob.upload_from_string(content, content_type=content_type)
        return blob.public_url

    def delete(self, *, path: str) -> None:
        self._bucket.blob(path).delete()

    def signed_url(self, *, path: str, expires_in_seconds: int = 3600) -> str:
        blob = self._bucket.blob(path)
        return blob.generate_signed_url(expiration=expires_in_seconds)
