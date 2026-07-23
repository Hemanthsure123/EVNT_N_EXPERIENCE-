# CLAUDE.md — conventions and how to work in this repo

This is a real, income-generating ticketing platform. The foundation exists
so the codebase can absorb years of new features, be reformatted, or be
re-platformed with minimal churn. Read this before adding a module.

## Layering (non-negotiable)

```
API (views/serializers) -> Service (business rules) -> Repository (ORM) -> Models
```

- **Views are thin.** Parse/validate at the boundary, call exactly one
  service method or selector, serialize the result. No business rules, no
  `Model.objects` calls, in a view.
- **Services hold business rules.** Constructed with their dependencies
  (repositories, ports) injected via `__init__` — never import a repository
  class or vendor SDK at call time inside a service method. Services raise
  `core.errors.DomainError` subclasses, never HTTP status codes.
- **Repositories are the ONLY place with ORM queries.** Everything else
  depends on a repository's methods, never on `Model.objects` directly.
- **Selectors are read-only queries**, kept separate from services'
  write-side command handling (CQRS-lite) so read paths can be optimised
  independently later without touching business rules.

## Module shape (copy `apps/accounts/` exactly)

Every business module under `backend/apps/` has the **same** files, so the
codebase stays predictable as it grows:

```
apps/<module>/
  models.py          Django models (UUID primary keys — see below)
  repositories.py     subclasses of core.base_repository.BaseRepository
  services.py         business rules, subclasses touch core.unit_of_work.UnitOfWork
  selectors.py         read-only query functions
  handlers.py           Observer callbacks for domain events this module reacts to
  schemas.py            DRF serializers used as the boundary DTO layer (see below)
  api.py                 thin DRF APIViews, one @extend_schema per method
  permissions.py          DRF permission classes (object-level checks)
  exceptions.py            DomainError subclasses specific to this module
  urls.py                   urlpatterns, included from config/urls.py
  apps.py                    AppConfig; subscribe event handlers in ready()
  admin.py (optional)         django admin registration, if operators need it
  migrations/
  tests/
    test_repositories.py
    test_services.py
    test_api.py
    test_handlers.py (if the module has any)
```

New modules go in `INSTALLED_APPS` (`config/settings/base.py`) as
`"apps.<module>"` with `app_label = "<module>"`, and get a service factory
function added to `config/di.py`.

### UUID primary keys

Every model gets `id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)`.
IDs get exposed in URLs, tickets, and QR codes on this platform — sequential
integer IDs would leak row counts and be guessable.

### schemas.py: DRF serializers, not a parallel DTO layer

DRF serializers are used directly as the schema/validation layer. A second,
framework-agnostic DTO layer (e.g. pydantic) was deliberately **not** added
— DRF already owns boundary parsing/validation, and a parallel layer would
duplicate that responsibility without earning its place. Revisit only if a
module needs validation independent of HTTP (e.g. a CLI import job).

## Ports & adapters (hexagonal architecture)

Every third-party dependency (payments, storage, email, SMS, cache, event
bus, task queue) sits behind an abstract interface in `backend/core/ports/`.
Each port has:

- a **local/fake adapter** in `core/adapters/local/` — used by default in
  dev/test, zero real credentials, zero network calls.
- a **real adapter** in its own `core/adapters/<vendor>/` package — only
  imported lazily (inside the matching `config/di.py` factory function), so
  selecting a different backend never even attempts to import an SDK the
  environment doesn't have installed.

Selection is entirely driven by env vars read into Django settings
(`PAYMENTS_BACKEND`, `STORAGE_BACKEND`, `QUEUE_BACKEND`, `EVENT_BUS_BACKEND`,
`EMAIL_PROVIDER`, `SMS_PROVIDER`, `CACHE_BACKEND`) — never by branching on
`ENVIRONMENT` directly, and never hard-coded in business code.

**To add a new port:**

1. Define the ABC in `core/ports/<name>_port.py`. Keep it minimal — only the
   methods a real caller needs *right now*.
2. Add a local/fake adapter in `core/adapters/local/`.
3. Add the real adapter in `core/adapters/<vendor>/adapter.py`, imported
   lazily.
4. Add a cached factory function to `config/di.py` (`@lru_cache` — one
   instance per process, never a bare module-level global).
5. Add the vendor's env vars to `.env.example` **and** `.env`, and expose
   them as Django settings in `config/settings/base.py`.

### Composition root (`config/di.py`)

The only file allowed to know which concrete adapter backs each port, and
the only file that ever imports both a repository and a vendor adapter side
by side. Views and services depend on abstractions and get instances from
factory functions here (`build_<module>_service()`) — never from a
hand-rolled global singleton inside business code.

## Unit of Work + Outbox

Multi-step writes that must succeed or fail together go inside
`with UnitOfWork() as uow:`. Call `uow.publish(event_type, payload,
aggregate_id=...)` to record a domain event in the **same transaction** —
this is what makes the outbox pattern work: the event can't be lost because
the business write and the event write commit or roll back together.

- `core.events` holds the well-known event-type string constants — add new
  ones there, don't hand-type literals at call sites.
- `UnitOfWork` drains the outbox synchronously via `transaction.on_commit`
  after every successful commit — this keeps dev/test deterministic.
- `config/worker.py` (`python -m config.worker`) polls the outbox
  independently in staging/prod, so a crash between commit and that
  on-commit hook still gets the event published eventually.
- Observers subscribe in `apps.py`'s `AppConfig.ready()`:
  `event_bus_port().subscribe(event_type, handler)`. Only the in-process
  adapter does anything with `subscribe` — real message-bus adapters manage
  subscriptions as infrastructure, not runtime code.

## Errors

Services/repositories raise `core.errors.DomainError` subclasses
(`NotFoundError`, `ConflictError`, `InvalidInputError`,
`PermissionDeniedError`, `AuthenticationError`, or a module-specific
subclass in that module's `exceptions.py`). `core.errors.exception_handler`
(wired as DRF's `EXCEPTION_HANDLER`) turns these into a consistent envelope:

```json
{"error": {"code": "email_already_registered", "message": "...", "details": {}}}
```

Never return a raw DRF/Django exception's default shape from a view; raise
a `DomainError` (or let DRF's own validation errors flow through the
handler, which normalizes them into the same envelope).

## Testing conventions

- `@pytest.mark.django_db` wraps each test in an outer transaction that's
  rolled back — `transaction.on_commit()` callbacks registered inside it
  **never fire** during a normal test. To test on-commit behavior
  (including anything that goes through `UnitOfWork`), use the
  `django_capture_on_commit_callbacks(execute=True)` fixture from
  pytest-django. To test something that specifically requires *not* being
  inside an outer transaction (e.g. `record_event`'s "must be in a
  transaction" guard), use `@pytest.mark.django_db(transaction=True)`.
- Services are tested by constructing them directly with local/fake
  adapters — never via `config.di.build_*_service()` in a unit test (that
  would make the test depend on Django settings' backend selection).
- API tests use `rest_framework.test.APIClient` and assert on status codes
  and the response/error envelope shape, not on side effects (side effects
  belong in service/handler tests).

## What's deliberately NOT built yet (don't add it speculatively)

- **`TaskQueuePort` has no task-name registry.** No module needs async
  execution yet. Add a registry alongside the first real consumer (e.g.
  settlement payouts, reminder emails), not before.
- **`StoragePort` and `SmsPort` are wired up but unused** — no module needs
  file uploads or SMS yet. That's fine; the port + local adapter existing
  from day one is the requirement, not that something calls it immediately.
- Future modules explicitly deferred until their turn: `teams`,
  `communities`/collaboration, `venues`/seat-maps, `marketing`.

## Build order

`accounts` (done) → `organizations` → `events` → `ticketing` → `booking` →
`payments` → `checkin` → `notifications` → `settlements`.

## Money-path rules (bake in when building ticketing/booking/payments)

- Reserve tickets with a short hold + a per-tier row lock (`CachePort.lock`
  or `select_for_update`); auto-release on expiry via a scheduled task.
- Create a ticket **only** after the payment webhook is signature-verified
  (`PaymentPort.verify_webhook_signature`) **and** deduplicated by an
  idempotency key. Mark-paid + issue-tickets + write-outbox happen in ONE
  `UnitOfWork` transaction.
- Split via `PaymentPort.split_transfer`: organizer's share goes to their
  linked account, the platform fee stays with the platform. The platform
  must never hold organizer funds beyond that split; payout happens after
  the event via `settlements`.
- One check-in scan marks a ticket used under a row lock; reuse is denied;
  every scan is audited (`core.audit.record_audit`). Never store card data.

## Known benign quirks

- Registering a user in dev logs an `InsecureKeyLengthWarning` from PyJWT
  if `JWT_SIGNING_KEY` is shorter than 32 bytes — the shipped dummy value is
  already long enough; if you shorten it, expect the warning back.
- The dev server's autoreloader occasionally logs a
  `AttributeError: 'NoneType' object has no attribute 'getpid'` traceback
  from redis-py's `Redis.__del__` during a reload-triggered process
  restart. It's an interpreter-shutdown GC-ordering artifact in redis-py,
  not a bug in this codebase, and doesn't affect the running process.
