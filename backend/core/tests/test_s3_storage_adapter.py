"""The S3-compatible storage adapter.

Added because `STORAGE_BACKEND=local` was the only non-GCP option, and local
means every uploaded poster is written to the container filesystem and lost on
the next redeploy — while production preflight (correctly) refuses `local`, so
a production deployment had no storage backend at all.

What is worth pinning here is not "boto3 works". It is the four configuration
decisions that make this adapter work against a NON-AWS endpoint, each of
which fails in a way that looks like something else:

- path-style addressing — virtual-host style asks DNS for `bucket.host`, which
  Supabase and MinIO do not serve, so every request fails as a DNS error
- SigV4 — the older signature is rejected outright by current providers
- bounded timeouts and retries — the default is an unbounded wait while a
  gunicorn worker is held
- `CacheControl` on upload — absent, every poster view is billed egress
"""

from __future__ import annotations

import importlib.util

import pytest

from core.adapters.s3.adapter import S3StorageAdapter

# NOT `pytest.importorskip` at module level — that raises `Skipped` during
# collection and skips the WHOLE file, including the validation tests below
# which run before boto3 is ever imported and must not be skipped with it.
needs_boto3 = pytest.mark.skipif(
    importlib.util.find_spec("boto3") is None,
    reason='boto3 comes from the `s3` extra: pip install -e ".[s3]"',
)


def make_adapter(
    *,
    bucket_name: str = "curatix-uploads",
    endpoint_url: str = "https://ref.supabase.co/storage/v1/s3",
    access_key_id: str = "key",
    secret_access_key: str = "secret",
    region: str = "ap-south-1",
    public_base_url: str = "",
) -> S3StorageAdapter:
    """Explicit keywords rather than a spread dict, so a test that overrides
    one field still typechecks against the real signature."""
    return S3StorageAdapter(
        bucket_name=bucket_name,
        endpoint_url=endpoint_url,
        access_key_id=access_key_id,
        secret_access_key=secret_access_key,
        region=region,
        public_base_url=public_base_url,
    )


class TestRequiredConfiguration:
    """These raise BEFORE boto3 is imported, so they run everywhere.

    A misconfigured bucket must fail at construction — which is process start,
    via `di.storage_port()` — rather than on the first upload, which is an
    organizer losing the poster they just picked.
    """

    def test_a_missing_bucket_is_refused(self):
        with pytest.raises(ValueError, match="S3_BUCKET_NAME"):
            make_adapter(bucket_name="")

    def test_a_missing_endpoint_is_refused(self):
        # Blank would silently mean "real AWS S3" while the credentials are
        # Supabase's, and the failure would be an opaque signature error.
        with pytest.raises(ValueError, match="S3_ENDPOINT_URL"):
            make_adapter(endpoint_url="")

    def test_the_error_names_the_supabase_endpoint_shape(self):
        """The value is not guessable, so the message carries it."""
        with pytest.raises(ValueError, match=r"storage/v1/s3"):
            make_adapter(endpoint_url="")


class _Recorder:
    """Stands in for the boto3 client. Records calls rather than asserting on
    them, so each test asserts only what it is about."""

    def __init__(self) -> None:
        self.puts: list[dict] = []
        self.deletes: list[dict] = []

    def put_object(self, **kwargs) -> dict:
        self.puts.append(kwargs)
        return {}

    def delete_object(self, **kwargs) -> dict:
        self.deletes.append(kwargs)
        return {}

    def generate_presigned_url(self, operation, Params, ExpiresIn) -> str:  # noqa: N803
        return f"https://signed.example/{Params['Key']}?expires={ExpiresIn}"


@pytest.fixture
def adapter() -> S3StorageAdapter:
    return make_adapter()


@pytest.fixture
def recording(adapter: S3StorageAdapter) -> tuple[S3StorageAdapter, _Recorder]:
    recorder = _Recorder()
    adapter._client = recorder
    return adapter, recorder


@needs_boto3
class TestClientConfiguration:
    """Built from the real boto3 client, because the point is the config."""

    def test_addressing_is_path_style(self, adapter: S3StorageAdapter):
        """Virtual-host style resolves `bucket.ref.supabase.co`, which does not
        exist — so the symptom is a DNS failure rather than a config error."""
        assert adapter._client.meta.config.s3["addressing_style"] == "path"

    def test_signing_is_sigv4(self, adapter: S3StorageAdapter):
        assert adapter._client.meta.config.signature_version == "s3v4"

    def test_timeouts_are_bounded(self, adapter: S3StorageAdapter):
        """The default is an unbounded wait, and the thing waiting is a
        gunicorn worker that could be serving a checkout."""
        config = adapter._client.meta.config
        assert config.connect_timeout == 3.0
        assert config.read_timeout == 10.0

    def test_retries_are_capped(self, adapter: S3StorageAdapter):
        """`total_max_attempts`, not `max_attempts`.

        botocore reads `max_attempts` as a RETRY count and stores
        `max_attempts + 1`, so writing 3 there silently buys four attempts —
        a budget a third larger than the one written down, on the request
        path. This asserts the resolved value, which is the one enforced.
        """
        assert adapter._client.meta.config.retries["total_max_attempts"] == 3

    def test_the_worst_case_wait_fits_inside_the_gunicorn_worker_timeout(
        self, adapter: S3StorageAdapter
    ):
        """An upload holds a gunicorn worker for its whole duration.

        If the retry budget can outlast `timeout`, a storage outage stops
        presenting as slow uploads and starts presenting as killed workers —
        which looks like an application fault rather than a vendor one. This
        ties the two files together so raising either alone fails here.
        """
        import re
        from pathlib import Path

        config = adapter._client.meta.config
        attempts = config.retries["total_max_attempts"]
        # Backoff between attempts is bounded by the same count; standard mode
        # is exponential from ~1s, so this is a generous upper bound.
        worst_case = attempts * (config.connect_timeout + config.read_timeout) + 2**attempts

        gunicorn_conf = (
            Path(__file__).resolve().parents[2] / "docker" / "gunicorn.conf.py"
        ).read_text(encoding="utf-8")
        match = re.search(r'WEB_TIMEOUT", (\d+)', gunicorn_conf)
        assert match, "WEB_TIMEOUT default not found in gunicorn.conf.py"
        worker_timeout = int(match.group(1))

        assert worst_case < worker_timeout, (
            f"a stalled S3 endpoint could hold a worker for ~{worst_case:.0f}s "
            f"against a {worker_timeout}s worker timeout — the worker would be "
            f"killed mid-request. Lower the timeouts or the attempt count."
        )

    def test_the_endpoint_is_the_configured_one_not_aws(self, adapter: S3StorageAdapter):
        assert "supabase.co" in adapter._client.meta.endpoint_url


@needs_boto3
class TestUpload:
    def test_the_object_is_written_to_the_configured_bucket(self, recording):
        adapter, recorder = recording
        adapter.upload(path="posters/a.jpg", content=b"bytes", content_type="image/jpeg")

        assert recorder.puts[0]["Bucket"] == "curatix-uploads"
        assert recorder.puts[0]["Key"] == "posters/a.jpg"
        assert recorder.puts[0]["Body"] == b"bytes"
        assert recorder.puts[0]["ContentType"] == "image/jpeg"

    def test_a_leading_slash_does_not_become_an_empty_key_segment(self, recording):
        """S3 accepts `/posters/a.jpg` as a key whose first segment is empty,
        which then does not match the URL the adapter returned."""
        adapter, recorder = recording
        url = adapter.upload(path="/posters/a.jpg", content=b"x", content_type="image/jpeg")

        assert recorder.puts[0]["Key"] == "posters/a.jpg"
        assert url.endswith("/posters/a.jpg")
        assert "//posters" not in url.replace("https://", "")

    def test_uploads_are_immutably_cacheable(self, recording):
        """The key changes when the image does, so the bytes at a key never
        change. Without this every poster view is billed origin egress."""
        adapter, recorder = recording
        adapter.upload(path="p.jpg", content=b"x", content_type="image/jpeg")

        assert recorder.puts[0]["CacheControl"] == "public, max-age=31536000, immutable"

    def test_a_missing_content_type_falls_back_rather_than_being_omitted(self, recording):
        """An object with no content type is served as one, and a browser then
        downloads the poster instead of rendering it."""
        adapter, recorder = recording
        adapter.upload(path="p.bin", content=b"x", content_type="")

        assert recorder.puts[0]["ContentType"] == "application/octet-stream"


@needs_boto3
class TestPublicUrl:
    def test_a_configured_public_base_is_used(self):
        """Normally a CDN. Serving public assets from the origin means paying
        egress on every view."""
        adapter = make_adapter(public_base_url="https://cdn.example/")
        adapter._client = _Recorder()

        url = adapter.upload(path="p.jpg", content=b"x", content_type="image/jpeg")
        assert url == "https://cdn.example/p.jpg"

    def test_without_one_it_falls_back_to_the_endpoint_and_bucket(self, recording):
        """Works, and is neither cached nor cheap — documented as such rather
        than left to fail."""
        adapter, _ = recording
        url = adapter.upload(path="p.jpg", content=b"x", content_type="image/jpeg")
        assert url == "https://ref.supabase.co/storage/v1/s3/curatix-uploads/p.jpg"


@needs_boto3
class TestDeleteAndSign:
    def test_delete_passes_the_normalised_key(self, recording):
        adapter, recorder = recording
        adapter.delete(path="/posters/a.jpg")
        assert recorder.deletes[0] == {"Bucket": "curatix-uploads", "Key": "posters/a.jpg"}

    def test_deleting_a_missing_object_is_not_an_error(self, recording):
        """S3's own `delete_object` is idempotent, which matches the port's
        contract without a pre-check round trip."""
        adapter, _ = recording
        adapter.delete(path="never-existed.jpg")  # must not raise

    def test_a_signed_url_carries_the_requested_expiry(self, recording):
        adapter, _ = recording
        assert "expires=60" in adapter.signed_url(path="private.pdf", expires_in_seconds=60)
