# Event & Experience Platform

A production-track event ticketing & experience platform (Eventbrite/Meetup
class): organizers create events and ticket tiers, attendees book and pay,
the platform takes a fee per ticket and splits the rest to the organizer,
tickets get checked in at the door. This repo currently contains the
**foundation** plus seven complete modules (`accounts`, `organizations`,
`events`, `ticketing`, `booking`, `payments`, `checkin`) proving the whole
stack works end to end — architecture, caching, full-text search, correct-
under-concurrency reservations, the reserve→hold→confirm→pay money-path
lifecycle with signature-verified webhooks and automatic refunds, one-scan
gate entry that can't admit a ticket twice, and performance discipline
included.

## Stack

- **Backend**: Python 3.12, Django 5 + Django REST Framework, PostgreSQL
  (behind a transaction-mode connection pooler), Redis (over TLS).
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

This builds the backend image and starts Postgres, a PgBouncer in front of
it (transaction-pooling mode, TLS required — a local stand-in for Neon's
pooled connection), Redis with a TLS listener (a local stand-in for
Upstash), waits for them to be healthy, runs migrations, and starts the
dev server on `http://localhost:8000`.

- Health check: `GET /health/`
- OpenAPI schema: `GET /api/schema/` — Swagger UI: `/api/docs/`
- Accounts API: `POST /api/v1/auth/register`, `/login`, `/refresh`,
  `/logout`, `GET /api/v1/auth/me`
- Organizations API: `POST /api/v1/organizations/`, `GET /api/v1/organizations/{id}`,
  `PATCH /api/v1/organizations/{id}`, `GET /api/v1/organizations/` (mine,
  cursor-paginated), `POST /api/v1/organizations/{id}/verification`,
  `POST /api/v1/organizations/{id}/payout-account`
- Events API — public discovery (unauthenticated, CDN-cacheable):
  `GET /api/v1/events` (browse + full-text search `?q=` + `?city=` filter,
  cursor-paginated), `GET /api/v1/events/{id}`. Organizer (authenticated):
  `POST /api/v1/events` (draft), `PATCH /api/v1/events/{id}` (optimistic-
  locked), `POST /api/v1/events/{id}/publish`, `GET /api/v1/organizer/events`.
- Ticketing API — public availability: `GET /api/v1/events/{id}/ticket-types`
  (tiers + live availability, short-TTL cached). Organizer:
  `POST /api/v1/events/{id}/ticket-types`, `PATCH /api/v1/ticket-types/{id}`.
  The `reserve`/`release`/`confirm_sold` primitives (per-tier row lock, zero
  oversell) are an internal service API `booking` calls — not HTTP.
- Booking API (authenticated): `POST /api/v1/bookings` (reserve all items
  all-or-nothing, hold, create payment order; honours an `Idempotency-Key`
  header), `GET /api/v1/bookings/{id}`, `POST /api/v1/bookings/{id}/cancel`,
  `GET /api/v1/me/tickets`. `ConfirmBooking` (issue signed-QR tickets,
  idempotent) is an internal service API `payments` calls from the verified
  webhook. A sweeper task auto-releases expired holds.
- Payments API: `POST /api/v1/payments/webhook` (Razorpay only — no user
  token, authenticated by HMAC signature over the raw body; verifies →
  dedupes → amount-checks → confirms the booking → 200 fast, refunds
  offloaded), `GET /api/v1/payments/{id}` (owner/organizer),
  `POST /api/v1/payments/{id}/refund` (organizer/admin). The order carries a
  Route split (organizer share on-hold until the event; platform fee retained);
  hold-expired/amount-mismatch payments auto-refund — money is never kept
  without a ticket.
- Check-in API (organizer-only, `private, no-store`):
  `POST /api/v1/checkin/verify` (verify a signed QR at the gate and mark the
  ticket used exactly once — a per-ticket row lock makes double-entry
  impossible even under simultaneous scans; forged/wrong-event/void/expired
  scans are denied and audited), `GET /api/v1/events/{id}/attendance` (live
  admitted-vs-capacity, cached for display but reconciled from the DB). Reuses
  booking's signed-token verifier; a refund voids the ticket so it can't enter.

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
from the repo root; add `pgbouncer` too if you want the pooled path
exercised, though tests connect directly via `DIRECT_DATABASE_URL` and
don't need it) — pytest-django creates and tears down its own test database
against Postgres directly, bypassing the pooler (see CLAUDE.md's dev
infrastructure section for why). One test suite (`test_redis_adapter.py`)
talks to real Redis to verify cache serialization; everything else uses
the local/fake adapters.

Want a deep per-request profiler instead of the built-in slow-request log?
Set `ENABLE_SILK=true` in `.env` and hit `/silk/` — off by default even in
dev, since it has real overhead.

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
    organizations/   orgs/brands, verification, payout-account linking, caching
    events/          public discovery: full-text search, edge caching,
                     single-flight detail cache, optimistic-locked edits
    ticketing/       tiers + authoritative availability; per-tier row-lock
                     reserve/release/confirm primitives (zero oversell)
    booking/         reserve→hold→confirm money-path lifecycle; all-or-nothing
                     reserve, auto-release sweeper, signed-QR ticket issuance
    payments/        signature-verified Razorpay webhooks, idempotency ledger,
                     Route split (on-hold), auto-refunds when unfulfillable
    checkin/         one-scan gate entry under a per-ticket row lock, live
                     attendance (cache the count, trust the DB), scan audit log
    (notifications, settlements — not built yet)
frontend/            placeholder, see frontend/README.md
```
