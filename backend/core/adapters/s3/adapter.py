"""Real StoragePort adapter for S3-compatible object storage.

Exists because `STORAGE_BACKEND=local` was the only non-GCP option, and local
means every uploaded poster and performer photo is written to the container
filesystem and lost on the next redeploy. `core/preflight.py` refuses `local`
in production — correctly — which left a production deployment with no
storage backend at all.

── ONE ADAPTER, FOUR PROVIDERS ──────────────────────────────────────────

Supabase Storage, Cloudflare R2, AWS S3 and MinIO all speak the S3 protocol.
The only thing that differs is `S3_ENDPOINT_URL`, so a single adapter covers
all of them and switching provider is a URL change. Supabase Storage is the
natural fit here because the database is already Supabase — one vendor, one
bill, one region.

── WHY `boto3` AND NOT `django-storages` ────────────────────────────────

`django-storages` swaps Django's `DEFAULT_FILE_STORAGE` globally, which would
route every `FileField` through it and bypass `StoragePort` entirely — the
opposite of what the ports/adapters split is for. This implements the four
methods the port actually declares and nothing else.

── PUBLIC URL vs SIGNED URL ─────────────────────────────────────────────

`upload` returns a PUBLIC url and `signed_url` returns a time-limited one.
Both exist because this platform stores both kinds of object: an event poster
is public by design (it renders on an unauthenticated page and should be
CDN-cacheable), while a future private object — an organizer's verification
document — must never be. Callers choose; the adapter does not guess.
"""

from __future__ import annotations

import logging
from typing import Any

from core.ports.storage_port import StoragePort

logger = logging.getLogger(__name__)


class S3StorageAdapter(StoragePort):
    def __init__(
        self,
        *,
        bucket_name: str,
        endpoint_url: str,
        access_key_id: str,
        secret_access_key: str,
        region: str = "auto",
        public_base_url: str = "",
        connect_timeout: float = 3.0,
        read_timeout: float = 10.0,
    ) -> None:
        if not bucket_name:
            raise ValueError("S3_BUCKET_NAME is required with STORAGE_BACKEND=s3.")
        if not endpoint_url:
            raise ValueError(
                "S3_ENDPOINT_URL is required with STORAGE_BACKEND=s3 "
                "(Supabase: https://<ref>.supabase.co/storage/v1/s3)."
            )

        try:
            import boto3
            from botocore.config import Config
        except ImportError as exc:  # pragma: no cover - guarded by preflight
            raise RuntimeError('STORAGE_BACKEND=s3 requires boto3: pip install -e ".[s3]"') from exc

        self._bucket = bucket_name
        # Where a browser fetches the object from. Usually a CDN in front of
        # the bucket rather than the bucket itself — serving public assets
        # straight from the origin means paying egress on every view.
        self._public_base_url = (
            public_base_url or f"{endpoint_url.rstrip('/')}/{bucket_name}"
        ).rstrip("/")

        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name=region,
            config=Config(
                # Path-style is required by Supabase Storage and MinIO;
                # virtual-host style assumes a `bucket.host` DNS name that
                # neither provides. AWS accepts path-style too, so this is the
                # one setting that works everywhere.
                s3={"addressing_style": "path"},
                signature_version="s3v4",
                connect_timeout=connect_timeout,
                read_timeout=read_timeout,
                # ── THE RETRY BUDGET IS BOUNDED BY THE WORKER TIMEOUT ────
                #
                # An upload runs on the request path (outside the transaction,
                # but a gunicorn worker is held for its whole duration), so
                # the worst case here must sit comfortably inside gunicorn's
                # `timeout` — otherwise a storage outage stops presenting as a
                # slow upload and starts presenting as killed workers.
                #
                #   3 attempts x (3s connect + 10s read) + ~3s backoff = ~42s
                #   gunicorn WEB_TIMEOUT default                       =  60s
                #
                # `total_max_attempts`, NOT `max_attempts`: botocore reads the
                # latter as a RETRY count and stores `max_attempts + 1`, so
                # `max_attempts=3` silently means four attempts and a budget
                # 33% larger than written. Setting the total directly removes
                # the off-by-one. Asserted in test_s3_storage_adapter.py
                # against gunicorn.conf.py's own default.
                retries={"total_max_attempts": 3, "mode": "standard"},
            ),
        )

    def upload(self, *, path: str, content: bytes, content_type: str) -> str:
        key = path.lstrip("/")
        extra: dict[str, Any] = {
            "ContentType": content_type or "application/octet-stream",
            # A poster's bytes never change — the key changes when the image
            # does — so a long immutable cache is safe and removes the object
            # from the origin's traffic entirely after the first fetch.
            "CacheControl": "public, max-age=31536000, immutable",
        }
        self._client.put_object(Bucket=self._bucket, Key=key, Body=content, **extra)
        return f"{self._public_base_url}/{key}"

    def delete(self, *, path: str) -> None:
        # S3 `delete_object` is already idempotent — deleting a key that does
        # not exist returns 204 — which matches the port's "no-op if it
        # doesn't exist" contract without a pre-check round trip.
        self._client.delete_object(Bucket=self._bucket, Key=path.lstrip("/"))

    def signed_url(self, *, path: str, expires_in_seconds: int = 3600) -> str:
        return str(
            self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": path.lstrip("/")},
                ExpiresIn=expires_in_seconds,
            )
        )
