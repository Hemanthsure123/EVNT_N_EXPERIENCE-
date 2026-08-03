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

ARG INSTALL_EXTRAS="razorpay,push,observability,s3,tickets"

COPY pyproject.toml ./
# Build deps only for the pip resolve step, then dropped from the final layer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libpq-dev \
    && pip install --upgrade pip \
    && pip install -e ".[${INSTALL_EXTRAS}]" \
    && apt-get purge -y gcc libpq-dev \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

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
