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
  apps.py                    AppConfig; subscribe event handlers + register tasks in ready()
  tasks.py (if any)           @register_task background handlers (see core/tasks.py)
  admin.py (optional)         django admin registration, if operators need it
  migrations/
  tests/
    test_repositories.py
    test_services.py
    test_selectors.py (if the module caches anything)
    test_api.py
    test_handlers.py (if the module has any)
    test_tasks.py (if the module has any)
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

## Dev infrastructure: pooled Postgres + TLS Redis (simulating Neon/Upstash)

Local dev/CI run against a **transaction-mode PgBouncer** and a **TLS-enabled
Redis** in `docker-compose.yml` — local stand-ins for Neon's pooled
connection and Upstash's `rediss://` endpoint, proving the config-only
portability story for real instead of just in theory. Swapping to actual
Neon/Upstash in staging/prod is a `DATABASE_URL`/`REDIS_URL` change only.

- `docker/dev-tls/generate-certs.sh` creates a throwaway self-signed CA +
  leaf certs for `redis` and `pgbouncer` (gitignored — regenerate any time).
- **Two Postgres URLs, on purpose:**
  - `DATABASE_URL` — pooled, via PgBouncer (port 6432, `sslmode=require`).
    Used for the app's normal runtime queries.
  - `DIRECT_DATABASE_URL` — straight to Postgres (port 5432), no pooler.
    **Required** for anything that needs a database PgBouncer's static
    `[databases]` list doesn't know about — concretely, pytest-django's
    on-the-fly `test_<dbname>`. `config/settings/test.py` always uses this
    one, falling back to `DATABASE_URL` if unset (e.g. CI, which has no
    pooler in front of Postgres at all). This mirrors Neon's own guidance:
    pooled connection for the app, direct connection for migrations/admin/
    test tooling.
  - `DATABASES["default"]["CONN_MAX_AGE"]` and
    `["DISABLE_SERVER_SIDE_CURSORS"]` are read from env
    (`CONN_MAX_AGE`, `DISABLE_SERVER_SIDE_CURSORS`) — `0`/`true` behind a
    transaction pooler, since it already manages connection reuse and
    server-side cursors need session affinity pooling doesn't provide.
- `REDIS_URL=rediss://...?ssl_cert_reqs=none` — the `ssl_cert_reqs=none` is
  **only** because the local cert is self-signed; a real Upstash cert is
  CA-signed, so drop that query param outside local dev.
- `CACHE_BACKEND=redis` even in dev (not faked) — caching is exercised for
  real against this Redis, not skipped.

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

## Performance checklist (every module must satisfy this)

Established alongside the `organizations` module and binding on every module
after it. Application performance and low latency are an overriding
priority for this project — performance comes from good design applied
consistently, not from shortcuts that break the layering above.

1. **No N+1 queries.** Repositories use `.only()`/`.defer()` for lean reads
   and `select_related`/`prefetch_related` the moment a query crosses an FK.
   `organizations` has no FK traversals yet (owner_id is read straight off
   the row), so it doesn't need select_related — don't add it speculatively
   ahead of an actual join.
2. **Add the DB index the query actually needs, in the same migration.**
   Look at the WHERE/ORDER BY the repository method issues and index
   exactly that — see `Organization.Meta.indexes`'s `(owner, created_at)`
   compound index with a `deleted_at__isnull` condition, which exists
   because `list_active_by_owner` filters and sorts by precisely those
   columns.
3. **Selectors return only what the response needs**, never a blindly
   serialized full model. `get_organization_detail_payload` and the list
   endpoint both go through `.only(...)`-restricted querysets.
4. **Cache-aside caching via CachePort, with documented keys/TTLs and
   invalidation on every write:**
   - `org:{organization_id}` — 60s TTL — the org detail payload
     (`selectors.ORG_DETAIL_TTL_SECONDS`).
   - `orgs:owner:{owner_id}` — 30s TTL — the *first page only* of a user's
     org list, cached as the fully-rendered response body including DRF's
     own cursor-encoded `next` link (`selectors.ORG_LIST_TTL_SECONDS`).
     Replicating DRF's cursor token format by hand to cache raw rows
     instead would be fragile — deeper pages (`?cursor=...` present) always
     hit the DB, which is an accepted tradeoff since first-page access
     dominates real usage.
   - Every write path (`create_organization`, `update_organization`,
     `submit_verification`, `link_payout_account`, and the
     `process_verification` task) calls
     `selectors.invalidate_organization_cache(org_id, owner_id)` inside
     `transaction.on_commit(...)` — never before commit, or a concurrent
     reader could repopulate the cache with stale pre-write data in the
     race window before the write actually lands.
   - Stampede protection is a short non-blocking `CachePort.lock()`: only
     the request that wins it writes the cache entry, but every concurrent
     miss still reads the DB directly rather than queueing. This is
     "basic" protection, not full elimination — proportionate because a
     detail-by-PK/list-by-owner read is already a cheap, index-backed
     query, not the expensive case stampede protection usually guards.
     Reach for something stronger (stale-while-revalidate, a blocking
     retry loop) only when caching something genuinely expensive to
     rebuild.
5. **External I/O outside the transaction.** Storage uploads and payment-
   provider API calls (e.g. creating a Razorpay linked account) happen
   *before* `with UnitOfWork():` opens, never inside it — a DB transaction
   should hold connections/locks for as short a time as possible, and
   neither call needs to be atomic with the DB write (if the external call
   succeeds but the write then fails, the transaction rolls back and the
   orphaned external side effect is harmless).
6. **HTTP performance:** `GZipMiddleware` compresses every response.
   Cacheable GETs set `ETag` + `Cache-Control` (`core.http_caching`) and
   return 304 on a matching `If-None-Match`. **Always `private`** for any
   response whose content depends on who's asking (an ownership/permission
   check gates it) — a shared/CDN cache must never serve one user's cached
   response to another. Use `public` (with `s-maxage` + `stale-while-
   revalidate`) ONLY for genuinely unauthenticated-safe reads — the public
   `events` browse/detail endpoints are the first: identical for everyone,
   so a CDN can absorb the bulk of discovery traffic (the single biggest
   frontend-latency win). Owner/draft-bearing responses are `private,
   no-store`.
7. **List endpoints use cursor pagination**
   (`core.pagination.CursorPagination`, subclassed per view with `ordering`
   set to match that query's actual index — see
   `apps/organizations/pagination.py`), not the page-number
   `DefaultPagination`. No `COUNT(*)` query, stable under concurrent
   inserts/deletes. `DefaultPagination` still exists for the rare endpoint
   that genuinely needs a total count.
8. **Heavy/slow work goes through `TaskQueuePort`,** not inline in the
   request. `submit_verification` creates a PENDING record and returns
   immediately; the actual "processing" runs in
   `apps/organizations/tasks.process_verification`, registered via
   `core.tasks.register_task` (see "TaskQueuePort now has a registry"
   below).
9. **Performance observability in dev:** `core.middleware.
   PerformanceLoggingMiddleware` logs wall-clock time + DB query count per
   request (warns above 200ms), gated on `DEBUG` since query logging has
   real overhead. `ENABLE_SILK=true` turns on django-silk at `/silk/` for a
   much deeper per-query breakdown — off by default even in dev.
10. **Lock the query budget in with tests.** Use pytest-django's
    `django_assert_num_queries` on both list and detail endpoints — cold
    (cache miss) and warm (cache hit) — so an N+1 regression fails CI
    instead of surfacing in production. Also test an actual cache
    hit (second call issues fewer queries than the first) and an actual
    invalidation (a write followed by a GET reflects the write, not stale
    cached data).

**Query budget observed for `organizations`** (local dev, warm process):
`GET /organizations/{id}` — 2 queries cold (JWT auth user lookup + the org
`SELECT`), 1 query warm (auth lookup only; the org itself comes from
Redis). `GET /organizations/` (list, first page) — 2 queries cold, 1 query
warm, same pattern. Both measured directly via `django_assert_num_queries`
in `apps/organizations/tests/test_api.py` and
`apps/organizations/tests/test_selectors.py` — these numbers are enforced
by CI, not just observed once.

**Query budget observed for `events`** (the public read path is
unauthenticated, so there's no JWT user lookup to pay for): `GET /events/{id}`
and `GET /events` (list/search, first page) are both **1 query cold** (the
event/list `SELECT`) and **0 queries warm** (served entirely from Redis).
`GET /organizer/events` is 2 cold (auth + list). All enforced via
`django_assert_num_queries` in `apps/events/tests/test_api.py`. Local-dev
latency (5k-row table, DEBUG on, TLS Redis): detail ~7-8ms warm / ~22ms
cold; list ~8ms warm / ~60ms cold; a 20-card page is 6.4KB → 1.3KB gzipped.

### The public read path (events): full-text search, edge cache, single-flight

The `events` module is the discovery surface and hottest read path; four
patterns there are now the standard for any read-heavy public endpoint:

1. **Postgres full-text search, never `ILIKE '%...%'`.** `Event.search_vector`
   is a `tsvector` kept in sync by a DB **trigger** (see
   `apps/events/migrations/0001_initial.py`) with weights — title `A`,
   venue/city `B`, description `C` — and a **GIN index**. Queries use
   `SearchQuery(..., search_type="websearch")` (never raises on arbitrary
   user input). The trigger (`BEFORE INSERT`; `BEFORE UPDATE OF title,
   venue, city, description`) means the vector is always consistent with
   zero application code and isn't recomputed on a status-only/poster
   update. Verified with `EXPLAIN ANALYZE`: a selective term is a
   `Bitmap Index Scan on event_search_vector_gin`; a common term + `ORDER
   BY starts_at LIMIT` is an index scan on `(status, starts_at)` with a
   filter — both index-backed, never a seq scan.
2. **Two DTOs, never the whole model.** A tiny `EventCard` for lists/search
   and a fuller `EventDetail`, both from `.only(...)`-restricted querysets
   with `select_related("organization")` so a card never N+1s on the org
   name. Public visibility (`status=live`, not deleted, upcoming) is
   enforced in the repository queryset, not the view.
3. **Single-flight detail caching.** `event:{id}` is rebuilt under a
   *blocking* `CachePort.lock` (`blocking_timeout_seconds > 0`): on a hot-key
   expiry exactly one request rebuilds while the rest wait briefly for it,
   instead of all stampeding the DB. This is the stronger protection the
   `organizations` checklist said to reach for "only when caching something
   genuinely expensive" — here justified by a viral event, not rebuild cost.
4. **Generation-based list-cache invalidation.** Listing/search caches are
   keyed `events:list:v{gen}:{filter_hash}` — there are unboundedly many
   filter hashes, so instead of tracking and deleting each, a single
   `events:list:gen` counter (`CachePort.incr`, atomic) is bumped on every
   publicly-visible write; every prior-generation key is orphaned at once
   and TTLs out. Detail caches (keyed by id) are still deleted directly.
   Both invalidations run in `transaction.on_commit`, and only fire for
   changes that are actually public (a live event or a publish) — editing a
   draft touches no public cache.

**Cross-module denormalization.** `Event.from_price_minor` /
`tickets_available` are columns the (later) `ticketing` module will own and
keep current, so an event card shows "from ₹X" without joining/aggregating
ticket rows. Null until then — the clean spot to populate, documented so
ticketing knows where to write.

**Extensible publish gate.** `apps/events/publish_checks.py` holds a list
of readiness checks run before draft→live; `register_publish_check(...)`
lets a module add one from its `AppConfig.ready()` without editing `events`
(ticketing will add "has ≥1 ticket type"). Dependencies point one way:
ticketing→events, never the reverse.

**Optimistic locking.** Content edits go through a single race-free
conditional `UPDATE ... WHERE version = :expected` (`update_if_version_
matches` / `publish_if_draft`), not read-modify-write — concurrent editors
can't clobber each other; a mismatch is `409 stale_event_version`.

### TaskQueuePort now has a registry

The foundation slice deliberately shipped `TaskQueuePort` with no task-name
registry (nothing needed async execution). `organizations.submit_verification`
is the first real consumer, so `core/tasks.py` (a `register_task`/`run_task`
registry) was added alongside it — this is the "add it when the first real
consumer needs it" moment the foundation's CLAUDE.md called out in advance.
`SyncTaskQueueAdapter.enqueue()` now actually runs the registered task
synchronously (catching and logging any exception rather than propagating —
a bug in background work must never break the request that enqueued it, in
any environment). Modules register their tasks via `@register_task` in
their own `tasks.py`, imported from `AppConfig.ready()` so registration
always happens before a request could enqueue one (see
`apps/organizations/apps.py`). The Cloud Tasks real adapter's internal HTTP
endpoint still doesn't exist — that's a separate, later concern for whenever
`QUEUE_BACKEND=cloud_tasks` is actually deployed.

### Object-level ownership checks live in the service, not a DRF permission

`update_organization`/`submit_verification`/`link_payout_account` all load
the `Organization` row and check `owner_id` inside the **service**, not via
a DRF `has_object_permission` on a separately `get_object()`-fetched
instance — the latter would mean fetching the same row twice per request.
`permissions.py` still exists (per the module shape) with an `IsOrganizationOwner`
class, documented as unused for this reason, kept ready for a future
endpoint built around DRF's own `get_object()` flow where that redundancy
wouldn't apply.

## What's deliberately NOT built yet (don't add it speculatively)

- **`TaskQueuePort` has a registry now** (`core/tasks.py`, added alongside
  `organizations`'s verification flow — see the Performance checklist
  above), but the Cloud Tasks real adapter's internal HTTP dispatch
  endpoint still doesn't exist. Add it when `QUEUE_BACKEND=cloud_tasks` is
  actually deployed, not before.
- **`SmsPort` is wired up but unused** — no module needs SMS yet. That's
  fine; the port + local adapter existing from day one is the requirement,
  not that something calls it immediately. (`StoragePort` is used by
  `organizations` for logo uploads and `events` for posters.)
- **`Event.from_price_minor` / `tickets_available` are null placeholders**
  for `ticketing` to fill — don't populate them from a fake source now.
- **Relevance-ranked search ordering is deferred.** Search filters, then
  orders by `starts_at` (keeps it index-backed + cursor-paginatable). A
  `sort=relevance` mode (SearchRank) can come later if product wants it.
- Future modules explicitly deferred until their turn: `teams`,
  `communities`/collaboration, `venues`/seat-maps, `marketing`.

## Build order

`accounts` (done) → `organizations` (done) → `events` (done) → `ticketing` →
`booking` → `payments` → `checkin` → `notifications` → `settlements`.

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
