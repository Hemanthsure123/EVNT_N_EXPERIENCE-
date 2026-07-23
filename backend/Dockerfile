FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
# Install build deps only for the pip resolve step, then drop them from the final layer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libpq-dev \
    && pip install --upgrade pip \
    && pip install -e . \
    && apt-get purge -y gcc libpq-dev \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY . .

EXPOSE 8000

CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3"]
