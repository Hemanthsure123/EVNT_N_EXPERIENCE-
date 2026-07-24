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

## Ticketing: cache-for-display, decide-under-lock (the money-path rule)

`ticketing` is the first module where a bug costs real money (overselling =
selling tickets that don't exist). The governing rule, binding on every
money-path module after it:

> **Availability *display* is cached and fast. The reserve *decision* is
> ALWAYS made under a per-row database lock, never from a cache.**

- **Per-tier pessimistic lock.** `reserve`/`release`/`confirm_sold` each do
  `SELECT ... FOR UPDATE` on the single `TicketType` row
  (`TicketTypeRepository.lock_for_update`), check the invariant + sale window
  + max-per-order against the *freshly locked row*, write the counters, and
  commit. Each tier is its own row, so buying Gold never waits on Basic.
- **Hard DB backstop.** A `CheckConstraint` — `sold >= 0 AND reserved >= 0
  AND sold + reserved <= quantity` (`ticket_type_no_oversell`) — makes
  overselling physically impossible even if app logic has a bug. Defense in
  depth, verified by a test that tries to oversell via a raw `UPDATE` and
  gets an `IntegrityError`.
- **The locked section is tiny.** Lock → check → update counters → commit.
  No I/O, no cross-table work, nothing slow while the lock is held —
  contention during a ticket rush stays low. Display refresh (the tiers
  cache + the event's denormalized `from_price`/`tickets_available`) happens
  in `transaction.on_commit`, AFTER the lock is released.
- **The Strategy pattern** (`strategies.py`, `ReservationStrategy` ->
  `RowLockReservationStrategy`) encapsulates the locked decision so it's
  pluggable and unit-testable apart from the service that orchestrates
  events/caches.

**The reservation contract `booking` will consume** (each is one atomic,
retry-safe operation; the service opens a `UnitOfWork`, so wrapping a call in
your own `UnitOfWork` nests it as a savepoint — keep the enclosing
transaction short, i.e. no payment call while a lock is held):

- `reserve(ticket_type_id, quantity)` → holds `quantity` into `reserved`;
  raises `SaleNotStarted` / `SaleClosed` / `ExceedsMaxPerOrder` / `SoldOut` /
  `TicketTypeNotFound`. Publishes `TICKET_TYPE_SOLD_OUT` (in the same txn)
  when it takes the last tickets.
- `release(ticket_type_id, quantity)` → frees up to `quantity` from
  `reserved`. Clamped to what's reserved, so a duplicate/expired-hold release
  is a safe no-op.
- `confirm_sold(ticket_type_id, quantity)` → moves up to `quantity` from
  `reserved` to `sold` (availability unchanged). Clamped to `reserved`, so a
  retried confirm can't double-count a sale.

Exactly-once accounting (which hold maps to which release/confirm) is the
CALLER's job — `booking` owns holds, timers, and orders; ticketing owns only
these primitives and the authoritative counters.

**Concurrency is proven, not asserted.** `test_concurrency.py` uses
`@pytest.mark.django_db(transaction=True)` + a thread pool to fire N real
concurrent reserves at the last tickets and asserts exactly the right number
succeed with zero oversell — plus release-restores and confirm-converts. This
is the module's most important test; every money-path module needs its
equivalent.

**Closed events loops.** Ticketing registers the "event needs ≥ 1 ticket
type" publish check (`publish_gate.py`, via events' `register_publish_check`)
and keeps `Event.from_price_minor` (cheapest active tier) /
`tickets_available` (total remaining) current — recomputed from the
authoritative tier rows in `on_commit` and written through
`EventRepository.set_ticketing_fields`, then the event's public caches are
invalidated so the fast events read path reflects the change. These are also
display denormals: the reserve decision never reads them.

## Booking: the money-path lifecycle + the ConfirmBooking contract

`booking` orchestrates the money path on top of ticketing's primitives.
Lifecycle: **reserved → (paid | cancelled | expired)**. The invariant: every
reserved ticket ends up EITHER paid (a Ticket issued, tier `reserved`→`sold`)
OR released (tier `reserved` freed) — never stuck, leaked, or double-issued.

Two rules, binding on every money-path module:

1. **All-or-nothing reserve.** CreateBooking reserves every item inside ONE
   `UnitOfWork`; if any single `ticketing.reserve` fails, the whole
   transaction rolls back, which *automatically* releases everything already
   reserved. A partial reservation can never persist — the atomicity does the
   "release on partial failure" for free.
2. **No DB lock across an external call.** The `PaymentPort.create_order`
   call happens AFTER the reserve transaction commits — never while a tier or
   booking row is locked. The reserve/confirm/release lock windows stay tiny;
   a caller (booking here, payments next) must keep the enclosing transaction
   short, with no network call inside it.

**Authoritative hold = the DB** (`status == reserved AND hold_expires_at` in
the future). A Redis hold key was deliberately NOT added — confirm/cancel/
sweep already read the booking row, so a hint would earn nothing, and the
**sweeper is the reliability backstop**: `booking.release_expired`
(TaskQueuePort, scheduler-fired in prod) finds lapsed reserved holds,
releases their inventory via `ticketing.release`, and marks them `expired` —
each in its own short transaction under a booking-row lock, re-checked after
locking. Inventory is freed even if every best-effort signal is missed.

**Lock ordering** to avoid deadlocks: confirm/cancel/sweep always lock the
*booking* row first (`SELECT ... FOR UPDATE`), then tier rows (via ticketing).
CreateBooking locks only tier rows (the booking doesn't exist yet).

**Idempotency, two layers:**
- CreateBooking accepts a client `Idempotency-Key` (header → a `(user,
  idempotency_key)` unique constraint). A retry returns the original booking.
  Race-safe: a concurrent same-key insert hits the unique constraint, its
  reserves roll back with the transaction, and it returns the winner. A short
  `CachePort.lock` on the key is a best-effort optimization to avoid the
  wasted reserve+rollback — correctness is the DB constraint, not the lock.
- ConfirmBooking is idempotent on the booking itself (a webhook can fire
  twice): once `paid`, it returns the SAME tickets, never re-issues.

**The ConfirmBooking contract `payments` will consume** (called from the
verified webhook, in payments' own transaction):

`confirm_booking(booking_id, payment_ref) -> ConfirmResult(issued, reason, tickets)`
- `issued=True` → tickets freshly issued (`tickets` populated); tier
  `reserved`→`sold`; outbox `BOOKING_CONFIRMED` + `TICKET_ISSUED`.
- `issued=False, reason="already_confirmed"` → idempotent replay; the SAME
  tickets returned, nothing re-issued.
- `issued=False, reason="hold_expired"` → the hold lapsed (cancelled/expired,
  or reserved-but-past-expiry); NO tickets issued. The caller should REFUND
  (payments/settlements) — booking does not.

It runs entirely under the booking-row lock in one transaction: mark paid →
`ticketing.confirm_sold` per item → create `Ticket` rows (each a signed QR
token) → write the outbox. Ticket issuance is the confirm's own step, so it
can never happen without the sale being recorded.

**Signed QR tokens** (`qr.py`): `v1.<payload>.<hmac>` where payload is compact
JSON of ids only (ticket + event) — NO PII. HMAC-SHA256 with
`TICKET_QR_SIGNING_KEY`; `verify_ticket_token` constant-time-compares and
returns the ids or `None` (never raises). Any tamper invalidates it. `checkin`
will verify with the same key.

**Reads are private, never cached.** A booking and a user's tickets are
per-user, security-sensitive data → `private, no-store`. GET /bookings/{id}
(booking+event+items in a fixed 3 queries incl. auth) and GET /me/tickets
(auth + one joined query) both avoid N+1, enforced by
`django_assert_num_queries`.

## Payments: the signed webhook is the only source of truth

`payments` is the security boundary of the money path. Two absolute rules:

> **1. Never trust anything unsigned.** The browser redirect is NOT proof of
> payment. The signed, server-to-server webhook is the ONLY source of truth.
> **2. Never take money without delivering a ticket.** If tickets can't be
> issued (the hold lapsed, or the amount was tampered), the customer is
> AUTOMATICALLY refunded.

**The webhook flow** (`POST /payments/webhook`, no user token — the signature
IS the credential; verified over the RAW request body, never the re-parsed
data):
1. **Verify the HMAC signature** (`RAZORPAY_WEBHOOK_SECRET`). Missing/forged →
   `400`, nothing happens. This runs before anything else touches the DB.
2. **Idempotency.** Dedupe on `{event}:{payment_id}` via the `ProcessedWebhook`
   ledger — written in the SAME transaction as the processing it guards, so a
   rollback un-records it and Razorpay's retry reprocesses rather than being
   swallowed. A concurrent duplicate is caught by the unique constraint.
3. **Amount check.** The captured amount must equal `booking.total_amount_minor`
   — a mismatch is recorded but NOT confirmed; it's refunded.
4. **Confirm.** Call `booking.confirm_booking(booking_id, payment_ref=rzp_
   payment_id)` (itself idempotent). `issued`/`already_confirmed` → emit
   `PAYMENT_CONFIRMED`; `hold_expired` → schedule an auto-refund.
5. **Return 200 fast** once safely recorded. The external refund is offloaded
   to `TaskQueuePort` — no slow work runs inline or inside a transaction/lock.

**Idempotency is layered** and correctness never rests on one mechanism: the
`ProcessedWebhook` ledger dedupes deliveries, AND booking's confirm dedupes on
`payment_ref`, AND the refund dedupes on `refund:{payment_id}`. A ticket is
never double-issued; a refund never double-runs.

**Refunds** (`PaymentService.execute_refund`, run via the queue for retry +
dead-letter): idempotent and concurrency-safe — a payment already refunded is
a no-op; the external `PaymentPort.refund` carries an `idempotency_key` so the
vendor never double-refunds; the record step re-checks under a row lock. The
external call happens OUTSIDE any lock. `hold_expired` / `amount_mismatch`
auto-refund; the organizer refund endpoint (`POST /payments/{id}/refund`,
organizer/admin only) refunds a paid payment on demand.

**The Route split (define at payment, release after the event).**
`create_order` carries `transfers=[OrderTransfer(account_id, amount_minor,
on_hold=True)]`: the organizer's share (total − platform fee) is transferred
to their linked account (`organizations.payout_account_id`) ON HOLD until
`settlements` releases it after the event; the platform fee is retained by
simply not transferring it. The platform never holds the organizer's funds,
and the organizer isn't paid before the event. Booking builds the transfer
when it creates the order (resolving the linked account via
`EventRepository.get_organizer_payout_account`) — the one, minimal booking↔
payments integration point.

**The fake adapter verifies signatures for real.** Signature verification is
pure HMAC (no network), so `FakePaymentAdapter` does exactly what production
does — real HMAC with the configured secret. That keeps the security-critical
path honest under `PAYMENTS_BACKEND=fake`: tests build a correctly-signed
webhook (it passes) and a mis-signed one (it's rejected). Fake order ids are
uuid-based (like real Razorpay ids), so they never collide across restarts in
a persistent dev DB.

**No card data is ever stored** — only Razorpay reference ids (order id,
payment id, refund id) and amounts.

## Check-in: fast, correct one-scan entry (cache the count, decide under the lock)

`checkin` is the gate. People are physically queuing, so a scan must be
low-latency; and the same ticket must NEVER admit two people, even if scanned
at two gates in the same millisecond. Both matter; neither is sacrificed. It
REUSES booking's signed-token verifier and Ticket record — it never mints
tokens or tickets. It's the door analog of ticketing's no-oversell rule:

> **Attendance *display* is cached and fast. The admit *decision* is ALWAYS
> made under a per-ticket database row lock, never from a cache.**

**The VerifyAndMarkUsed flow** (`POST /checkin/verify` — `{event_id, qr_token,
gate}`; `event_id` is the event this gate is stationed for, driving both the
authorization and the wrong-event checks):

1. **Verify the signature** with `apps.booking.qr.verify_ticket_token` (same
   `TICKET_QR_SIGNING_KEY`; constant-time; never raises). A forged/tampered
   token → `denied_invalid` with **zero DB access** — the fast reject, and the
   only denial not written to the audit trail (there's no trustworthy ticket to
   attribute it to).
2. **Authorize**: only the event's organizer (or an admin) may verify for it.
   The check loads the event once (`EventRepository.get_for_checkin`) and
   compares `organization.owner_id` — the same in-service ownership pattern the
   other modules use. (Delegated gate-staff permissions arrive with `teams`
   later — `permissions.py`'s `IsEventOrganizer` is the clean seam, kept unused
   for now.)
3. **Lock-free denials** (a single audited insert each): the ticket's event ≠
   the gate's event → `denied_wrong_event`; already-used (a re-scan or a
   screenshot of a used ticket) → `denied_already_used`; void/refunded →
   `denied_not_active`; well outside the configurable scan window
   (`CHECKIN_WINDOW_OPENS_BEFORE_MINUTES` before start …
   `CHECKIN_WINDOW_GRACE_AFTER_MINUTES` after end) → `denied_out_of_window`.
4. **The admit decision, under the per-ticket lock.** In ONE short transaction:
   `SELECT ... FOR UPDATE` the ticket row (`TicketRepository.lock_for_update`),
   re-read status (closing every race — a concurrent admit that got there first,
   or a refund that voided it after the pre-check), `mark_used` (status/used_at/
   gate), append the `ScanLog(allowed)`, publish `TICKET_CHECKED_IN` to the
   outbox — then commit. **Nothing slow inside the lock**; it's a single-row
   lock plus two small writes. The live-count increment happens AFTER commit.

Returns a structured `VerifyResult(allowed, reason, ticket_id, event_id,
ticket_type, used_at, gate)` — mirroring booking's `ConfirmResult` so the
frontend has one clean contract. `reason` is a `ScanResult` value; a denial is
a valid 200 result (`allowed: false`), not an HTTP error — only bad auth
(403/404) raises.

**Concurrency is proven, not asserted.** `test_concurrency.py`
(`@pytest.mark.django_db(transaction=True)` + a thread pool) fires N real
simultaneous scans at ONE unused ticket and asserts EXACTLY ONE returns
`allowed` and the rest `denied_already_used` — the door equivalent of
ticketing's oversell test, and the module's most important test. The mark-used
write IS the idempotency guard, so re-scans/copies are deterministically denied.

**Live attendance: cache the count, trust the DB.** `GET /events/{id}/attendance`
(organizer-only, `private, no-store`) returns `admitted` vs `capacity`. The fast
path is a Redis counter (`checkin:admitted:{event_id}`, `CachePort.incr` on each
admit); the SOURCE OF TRUTH is the DB (`TicketRepository.count_used_for_event` —
the authoritative used-ticket count; capacity = `TicketTypeRepository.
total_quantity_for_event`). A short freshness marker
(`ATTENDANCE_FRESH_TTL_SECONDS`) drives periodic reconcile: within TTL the read
is served entirely from cache (0 DB queries), and every reconcile resets the
counter to the DB truth — so a lost/drifted increment self-heals and the cache
can never become authoritative. `ScanLog(allowed)` count is a parallel audit
source that must always agree.

**Refunded tickets can't enter.** A refund voids the booking's still-active
tickets in the SAME transaction as the refund record: `payments.execute_refund`
calls `booking.void_tickets_for_booking` (booking owns Ticket) →
`TicketRepository.void_active_for_booking` (one conditional `UPDATE ... WHERE
status=active`, so a ticket admitted a moment earlier stays `used`, never
reverted). Idempotent — a no-op for a booking that never issued tickets
(hold_expired / amount_mismatch). check-in still denies by status regardless;
the void is defense in depth at the source.

**ScanLog is the append-only audit trail** (`ticket`, `event`, `scanned_by`,
`scanned_at`, `gate`, `result`) — one row per scan that reached a real ticket,
never updated or deleted, indexed on `(event, scanned_at)` and `ticket`.

**Query budget** (local dev, warm process): `GET /events/{id}/attendance` — 4
cold / 2 warm (auth + the 2-query DB reconcile cold; auth + 1 read-side query
warm, count from Redis). `POST /checkin/verify` (allowed) — a fixed, N+1-free
9 statements (auth, event load, pre-lock ticket load, then the tiny locked
section: `SELECT ... FOR UPDATE`, mark-used `UPDATE`, `ScanLog` insert, outbox
insert — plus the transaction's SAVEPOINT/RELEASE in test mode). All enforced
via `django_assert_num_queries`. Warm attendance is ~20ms server-side; the
verify path is a single indexed lookup + a tiny single-row locked write — among
the fastest write endpoints in the system.

## Notifications: reliable, idempotent, fully-async delivery

`notifications` is the CONSUMER of the domain events the other modules already
emit via the outbox/event bus. It renders, dispatches and logs every user
message — email + SMS — and is the ONE home for all messaging (templates,
delivery, dedupe, logging). Three rules govern it:

> **1. Fully async.** Nothing user-facing ever blocks on a send — every send is
> handed to `TaskQueuePort` and happens off the request path.
> **2. Exactly-once.** Every message is delivered at-least-once with retry +
> dead-letter, and the SAME message is NEVER sent twice.
> **3. Loud, never silent.** A missing template raises at render time; a send
> that exhausts its retries is dead-lettered (recorded), never dropped.

**The `NotificationLog` is the audit trail AND the idempotency ledger** — one
row per logical message, keyed by a stable **UNIQUE `dedupe_key`**
(`{event/aggregate}:{type}:{channel}:{recipient}`). That uniqueness is the
backbone of exactly-once.

**The one entry point — `NotificationService.notify(type, recipient, context,
dedupe_key, delay_seconds=0)`** — orchestrates, cleanly separated from render
and dispatch (render / dispatch / orchestrate):
1. **Dedupe:** a log already exists for the key → return it, DON'T re-enqueue.
2. **Render** via `TemplateService` (pure, no I/O — safe on the request path).
   `TemplateMissingError` is raised HERE, before any claim (never a silent
   no-send).
3. **Claim:** insert the `pending` row. A concurrent claim collides on the
   unique key (`IntegrityError`, caught in its own savepoint) → the winner
   enqueues, the loser returns it. So a message is CLAIMED exactly once.
4. **Enqueue** the dispatch task. No recipient (e.g. an SMS to a user with no
   phone) → a clean skip returning `None`, never a failed send.

**`dispatch(notification_id)` — claim-before-send under a row lock:** loads the
log, no-ops if it's already `sent`/`failed` (redelivery-safe), then under
`SELECT ... FOR UPDATE` on the log row re-checks `status == pending` and sends
through the channel port. Two dispatchers of the same claim serialise on the
row, so exactly one sends. On provider failure it increments `attempts` and
re-enqueues with exponential backoff; after `NOTIFICATION_MAX_ATTEMPTS` it
**dead-letters** (`status=failed`, `error` recorded, logged). The send is made
under the lock deliberately: the log row is uncontended (nothing competes for it
but a duplicate dispatch, which SHOULD wait), unlike a hot inventory row — the
"external I/O outside the lock" rule guards lock *contention*, which doesn't
apply here. **Concurrency is proven** (`test_concurrency.py`,
`transaction=True` + threads): two dispatchers of one claim send exactly once.

**Notification types wired** (from events the other modules emit): `USER_REGISTERED`
→ welcome email (**consolidated here from accounts** — accounts emits, this
module sends); `BOOKING_CONFIRMED` → the **ticket delivery email** (event +
booking reference + the QR) *and* an SMS (the most important message); OTP →
SMS OTP, dispatched **promptly** (`delay_seconds=0`, the fast path — not the
slow polling worker — but still through this same async pipeline); `PAYMENT_REFUNDED`
→ refund confirmation email + SMS; `EVENT_PUBLISHED` → **schedules** a reminder
via `TaskQueuePort` for `NOTIFICATION_EVENT_REMINDER_HOURS_BEFORE` before the
event; the reminder job fans out to current ticket holders (loaded in one query,
idempotent per `(event, user)`).

**Templating + India DLT.** `TemplateService.render(type, channel, context)` is
a Factory over pure per-type template functions returning `RenderedMessage(subject,
body)`. The **channel is derived from the type** (`channel_for_type`), and for
SMS the **DLT-approved template id is mapped per type** (`dlt_template_id_for_type`
→ `settings.NOTIFICATION_SMS_DLT_TEMPLATE_IDS`, falling back to the single
`SMS_DLT_TEMPLATE_ID`), passed per-message to `SmsPort.send(..., dlt_template_id=)`.
India's DLT regime approves a distinct template per message type, so this
mapping is what makes real SMS compliant the moment the provider is switched on.

**Port evolution (the first real consumer needs it):** `EmailPort.send` /
`SmsPort.send` now RETURN a provider reference (stored as `NotificationLog.
provider_ref` for tracing; console adapters return a synthetic id, real adapters
the vendor's id), and `SmsPort.send` takes an optional per-message
`dlt_template_id`. A nullable `User.phone` was added — SMS's destination; blank
→ SMS is skipped cleanly. This module is **internal** (event/job-driven): no
public HTTP endpoints (`urls.py` empty, not mounted); operator visibility is the
Django admin + selectors. Backends stay `EMAIL_PROVIDER=console` /
`SMS_PROVIDER=console` in dev/test.

## Settlements: close the money loop (recompute under lock, pay after the window)

`settlements` is the LAST backend module — it releases the ON-HOLD Route
transfer `payments` created (organizer share held by Razorpay until after the
event). Its overriding concern is FINANCIAL INTEGRITY: the organizer is paid the
RIGHT amount, EXACTLY ONCE, ONLY after the event and its refund window, with
refunds fully reconciled. Four rules, all enforced:

> **1. Source of truth = payment records.** Running totals (updated from
> `PaymentConfirmed`/`PaymentRefunded`) are for fast DISPLAY only. At RELEASE
> time `net` is RECOMPUTED AUTHORITATIVELY from the actual paid/refunded
> payments, under the settlement-row lock — the cached totals never get to be
> authoritative.
> **2. Only after the event + refund window.** A payout releases only once the
> event has ended AND `SETTLEMENT_REFUND_WINDOW_HOURS` has passed
> (`EventNotFinished` otherwise). Because payout is that late, `net` is FINAL —
> nothing to claw back.
> **3. Exactly once, under a lock.** Release locks the settlement row
> (`SELECT ... FOR UPDATE`), no-ops if already `paid`, and the vendor call
> carries an idempotency key — so a retry or concurrent attempt never
> double-pays.
> **4. Reliable + off the request path.** The primary release path is a
> scheduled job (`TaskQueuePort`); on failure it retries with backoff and after
> `SETTLEMENT_MAX_ATTEMPTS` dead-letters (`status=failed`, `PayoutFailed`
> emitted) — the settlement STAYS OWED, never lost.

**One Settlement per event** (`event` OneToOne, unique) holds `gross /
platform_fee / refunds / net` and the payout lifecycle. `net = gross −
platform_fee − refunds` (a signed int; the platform fee is counted at capture
and refunds subtract the refunded amount). **Running totals** are atomic `F()`
updates (`SettlementRepository.add_confirmed`/`add_refund`) fed by handlers on
`PAYMENT_CONFIRMED`/`PAYMENT_REFUNDED` — no lock, no lost updates, DISPLAY only.

**The release flow** (`release_payout(settlement_id)` — the scheduled job's
`release_due_payouts` enqueues one task per due settlement; the admin endpoint
`POST /admin/settlements/{id}/release` only *triggers* it, pre-checking finished
so `EventNotFinished` surfaces synchronously while the payout still runs
off-request): lock the row → skip if `paid` → re-verify event finished →
**recompute `net` authoritatively from the payment records** (`PaymentRepository.
aggregate_event_settlement`) → if `net <= 0` settle to zero (no external call, no
notification) → else `PaymentPort.release_payout(account_id, net, idempotency_
key="settlement:{id}")` **under the lock** (the settlement row is uncontended —
like notifications' dispatch, the "I/O outside the lock" rule guards *contention*,
which doesn't apply) → on success mark `paid` + record a `PayoutAttempt` + emit
`PAYOUT_RELEASED`; on failure increment attempts, record a failed `PayoutAttempt`,
and retry-with-backoff or dead-letter. Concurrency is proven
(`test_concurrency.py`, `transaction=True` + threads): N racing releases pay
exactly once.

**`PayoutAttempt`** is the append-only financial audit trail (one row per
attempt); a refund arriving AFTER payout is the exceptional case — not silently
applied, but flagged as an `ADJUSTMENT` attempt for manual reconciliation.

**PaymentPort gained `release_payout`** (the fake simulates it idempotently by
key; the real Razorpay adapter releases the on-hold Route transfer). Settlements
emits `PAYOUT_RELEASED` (→ notifications' organizer payout email, via the seam it
left) and `PAYOUT_FAILED`. **Reads are `private, no-store`** (per-organizer money
data): `GET /organizer/settlements` (own settlements, cursor-paginated) and
`GET /organizer/settlements/{event_id}` — the list filters to the caller's own
events (an organizer sees only their own), 2 queries and N+1-free (enforced;
`provider_ref` is in the lean field set so the serializer never triggers a
deferred re-fetch). Never cache money as authoritative.

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
- **`SmsPort` is now used by `notifications`** (booking confirmation, OTP,
  refund SMS), routed per-type through India DLT template ids. (`StoragePort`
  is used by `organizations` for logo uploads and `events` for posters.)
- **`Event.from_price_minor` / `tickets_available` are now populated by
  `ticketing`** (see the ticketing section above) — they're display denormals
  kept current from the authoritative tier rows.
- **Relevance-ranked search ordering is deferred.** Search filters, then
  orders by `starts_at` (keeps it index-backed + cursor-paginatable). A
  `sort=relevance` mode (SearchRank) can come later if product wants it.
- **`checkin` is done** (see the check-in section above) — signature-verified
  one-scan entry under a per-ticket row lock, live attendance (cache the count,
  trust the DB), append-only `ScanLog`, refund-voids-tickets.
- **`notifications` is done** (see the notifications section above) —
  event-driven, exactly-once (unique `dedupe_key` + claim-before-send row
  lock), fully-async (retry + dead-letter via `TaskQueuePort`), templated
  email/SMS with per-type India DLT ids, welcome consolidated from accounts.
  **`settlements` is next, not started** (see below). It does NOT subscribe to a
  payout event yet — that event doesn't exist until settlements emits it;
  notifications can subscribe to it THEN. User notification preferences /
  opt-out and WhatsApp are future — the channel abstraction is the seam, don't
  build them now.
- **`settlements` is done** (see the settlements section above) — the LAST
  backend module: it releases the on-hold organizer transfer after the event +
  refund window, recomputing `net` authoritatively under a row lock, paying
  exactly once with retry/dead-letter, and reconciling refunds. **The backend
  feature set is now complete.**
- Future modules explicitly deferred until their turn (NOT part of the core
  backend; build only when explicitly requested): `teams` (organizer sub-users —
  the clean authZ seam is in each module's `permissions.py`),
  `communities`/collaboration, `venues`/seat-maps, `marketing`. The frontend
  (Next.js) also remains unbuilt (see `frontend/README.md`).

## Build order

`accounts` (done) → `organizations` (done) → `events` (done) →
`ticketing` (done) → `booking` (done) → `payments` (done) →
`checkin` (done) → `notifications` (done) → `settlements` (done).
**Backend complete.**

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
