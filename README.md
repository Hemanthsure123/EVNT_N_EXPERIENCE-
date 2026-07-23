# Event & Experience Platform

A production-track event ticketing & experience platform (Eventbrite/Meetup
class): organizers create events and ticket tiers, attendees book and pay,
the platform takes a fee per ticket and splits the rest to the organizer,
tickets get checked in at the door. This repo currently contains the
**foundation** — a clean, modular backend architecture plus one complete
vertical slice (`accounts`) proving the whole stack works end to end.

## Stack

- **Backend**: Python 3.12, Django 5 + Django REST Framework, PostgreSQL, Redis.
- **Frontend**: Next.js + TypeScript + Tailwind + shadcn/ui — not started yet
  (see `frontend/README.md`); comes after more backend modules exist.
- **Tooling**: ruff (lint), black (format), mypy + django-stubs (types),
  pytest + pytest-django + coverage, pre-commit, drf-spectacular (OpenAPI),
  django-environ (config).

## Quickstart

### Option A — Docker (closest to production)

```bash
cp .env.example .env      # already has safe dummy values, edit if you like
docker compose up -d
```

This builds the backend image, starts Postgres + Redis, waits for them to
be healthy, runs migrations, and starts the dev server on
`http://localhost:8000`.

- Health check: `GET /health/`
- OpenAPI schema: `GET /api/schema/` — Swagger UI: `/api/docs/`
- Accounts API: `POST /api/v1/auth/register`, `/login`, `/refresh`,
  `/logout`, `GET /api/v1/auth/me`

### Option B — local venv (faster iteration)

```bash
cd backend
python -m venv .venv
./.venv/Scripts/python -m pip install -e ".[dev]"   # Windows
# source .venv/bin/activate && pip install -e ".[dev]"  # macOS/Linux

docker compose up -d postgres redis   # from repo root, in another shell
python manage.py migrate
python manage.py runserver
```

Everything runs with **zero real credentials** — every third-party
dependency (payments, storage, email, SMS, event bus, task queue) defaults
to a local/fake adapter (see `.env.example`'s `*_BACKEND`/`*_PROVIDER`
switches). Nothing needs a Razorpay key, a GCP project, or an SMTP server
to run locally.

## Running tests, lint, types

```bash
cd backend
./.venv/Scripts/python -m pytest --cov=core --cov=apps --cov-report=term-missing
./.venv/Scripts/python -m ruff check .
./.venv/Scripts/python -m black --check .
./.venv/Scripts/python -m mypy .
```

Tests need Postgres + Redis running (`docker compose up -d postgres redis`
from the repo root) — pytest-django creates and tears down its own test
database against that same server.

Install the git hooks once so these run automatically before every commit:

```bash
pip install pre-commit   # or use the one in backend/.venv
pre-commit install
```

## Architecture

See [CLAUDE.md](CLAUDE.md) for the full conventions doc (layering rules,
how to add a module, how to add a port/adapter, why certain things are
deliberately kept simple). Short version:

```
API (views/serializers, thin) -> Service (business rules) -> Repository (ORM) -> Models
```

Every third-party dependency sits behind a **port** (an abstract interface
in `backend/core/ports/`), with a **local/fake adapter** for dev/test and a
**real adapter** for production, selected at runtime by `backend/config/di.py`
(the single composition root) based on env-var switches. Business logic
never imports a vendor SDK directly.

## Repository layout

```
backend/
  config/            settings (base/dev/staging/prod/test), di.py, urls, asgi/wsgi, worker
  core/              shared kernel: ports, adapters (local + real), base repo/service,
                     unit of work, outbox, audit, errors, pagination, logging
  apps/
    accounts/        reference module — copy this shape for every new module
    (organizations, events, ticketing, booking, payments, checkin,
     notifications, settlements — not built yet)
frontend/            placeholder, see frontend/README.md
```
