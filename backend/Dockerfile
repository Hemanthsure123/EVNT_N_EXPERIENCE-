# ── WHY THE EXTRAS ARE INSTALLED HERE AND NOT LEFT OPTIONAL ───────────────
#
# The previous image ran `pip install -e .` — base dependencies only. Every
# vendor SDK lives behind an optional extra, and `config/di.py` imports each
# one LAZILY, so nothing failed at build time or at boot. It failed on the
# first real request: with `PAYMENTS_BACKEND=razorpay` and no `razorpay`
# package installed, the first checkout raised ModuleNotFoundError and
# returned a 500 to a paying customer.
#
# The extras below are the ones this platform actually selects. `gcp` is
# deliberately NOT included — Google Cloud is not in use, and installing three
# unused Google client libraries costs ~40MB and a standing CVE surface for
# code that never runs. A deployment that adds a backend extends the build arg
# rather than editing this file.
#
# `core/preflight.py` now also verifies AT BOOT that the SDK for each selected
# backend can be imported, so a mismatch between this line and the runtime
# configuration stops the container rather than the checkout.
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

ARG INSTALL_EXTRAS="razorpay,push,observability,s3"

COPY pyproject.toml ./
# Build deps only for the pip resolve step, then dropped from the final layer.
#
# ── pip IS A BUILD TOOL, AND IT SHIPS ITS OWN CVEs ────────────────────────
#
# The last line of this RUN deletes pip. pip VENDORS its dependencies, and
# `pip/_vendor/vendor.txt` pins:
#
#     msgpack==1.1.2       GHSA-6v7p-g79w-8964  (out-of-bounds read)
#     setuptools==70.3.0   CVE-2025-47273       (path traversal)
#
# Trivy reads that file, so the image scan reported both as HIGH even though
# the APPLICATION's copies are already patched — msgpack 1.2.1 and setuptools
# 80.10.2 are installed below and appear in the very same scan. No dependency
# constraint can fix this: those versions are frozen inside pip and only a new
# pip release moves them.
#
# The container's entrypoint is gunicorn; it never installs anything, so pip is
# unreachable code that exists only to supply findings. Same argument that
# removed npm from the frontend runtime image.
#
# `pkg_resources` SURVIVES this and must: razorpay 1.4.2 imports it at module
# scope. It comes from the real setuptools in site-packages, not from pip's
# vendored copy — which is why the `<81` bound in pyproject.toml still matters.
# The import check on the last line fails the BUILD if any of that is wrong,
# rather than letting it surface as a 500 on the first checkout.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libpq-dev \
    && pip install --upgrade pip \
    && pip install -e ".[${INSTALL_EXTRAS}]" \
    && apt-get purge -y gcc libpq-dev \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/python3.12/site-packages/pip \
              /usr/local/lib/python3.12/site-packages/pip-*.dist-info \
              /usr/local/bin/pip /usr/local/bin/pip3 /usr/local/bin/pip3.12 \
    && python -c "import pkg_resources, razorpay, django; print('post-prune import check OK')"

COPY . .

# Non-root. A container compromise should not also be root on the writable
# layer, and `STORAGE_BACKEND=local` writes into MEDIA_ROOT — so that
# directory must be owned by the runtime user rather than by root.
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/media /app/staticfiles \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Container-level liveness, independent of any orchestrator. `/health/` probes
# the database and cache for real (core/health.py) and returns 503 when either
# is down, so a wedged dependency surfaces here rather than as slow 500s.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://127.0.0.1:8000/health/ || exit 1

# Gunicorn, configured in one file so tuning cannot drift between services.
# See docker/gunicorn.conf.py for the timeout and graceful-shutdown reasoning.
CMD ["gunicorn", "config.wsgi:application", "-c", "/app/docker/gunicorn.conf.py"]
