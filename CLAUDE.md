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
   methods a real caller needs _right now_.
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

## Dev infrastructure: pooled Postgres + TLS Redis (simulating Supabase/Upstash)

Local dev/CI run against a **transaction-mode PgBouncer** and a **TLS-enabled
Redis** in `docker-compose.yml` — local stand-ins for Supabase's pooled
connection and Upstash's `rediss://` endpoint, proving the config-only
portability story for real instead of just in theory. Swapping to actual
Supabase/Upstash in staging/prod is a `DATABASE_URL`/`REDIS_URL` change only.

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
    pooler in front of Postgres at all). This mirrors Supabase's own guidance:
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
{
  "error": {
    "code": "email_already_registered",
    "message": "...",
    "details": {}
  }
}
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
  pytest-django. To test something that specifically requires _not_ being
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
   - `orgs:owner:{owner_id}` — 30s TTL — the _first page only_ of a user's
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
   _before_ `with UnitOfWork():` opens, never inside it — a DB transaction
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
   _blocking_ `CachePort.lock` (`blocking_timeout_seconds > 0`): on a hot-key
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

> **Availability _display_ is cached and fast. The reserve _decision_ is
> ALWAYS made under a per-row database lock, never from a cache.**

- **Per-tier pessimistic lock.** `reserve`/`release`/`confirm_sold` each do
  `SELECT ... FOR UPDATE` on the single `TicketType` row
  (`TicketTypeRepository.lock_for_update`), check the invariant + sale window
  - max-per-order against the _freshly locked row_, write the counters, and
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
   transaction rolls back, which _automatically_ releases everything already
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
_booking_ row first (`SELECT ... FOR UPDATE`), then tier rows (via ticketing).
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

### Fulfilment must never depend on the customer's browser

Three paths reach fulfilment and all three converge on `_process_captured` —
same `payment.captured:{id}` ledger row, same amount check, same idempotent
`confirm_booking`. That convergence is the rule: **no entry point gets to be
the lenient one, and a new one can never issue a second ticket.**

1. `handle_webhook` — the provider PUSHES a signed fact. Primary.
2. `verify_and_confirm` — the server PULLS the same fact over an authenticated
   outbound call. For deployments with no public HTTPS endpoint, where a push
   can never arrive. The browser supplies one opaque id, never a claim.
3. `reconcile_pending` — **the backstop, and the reason the other two are not
   enough.** Both of them need something to ARRIVE. A webhook needs a public
   URL; `verify_and_confirm` needs the browser to make one more call after
   Razorpay hands control back, and that call was `void verifyPayment(...)
.catch(() => {})` — un-awaited, un-retried, silently swallowed. A closed tab
   meant the money was captured at the provider while this system never learned
   of it: the booking expired on schedule, the inventory came back, every
   counter reconciled, and the customer had **no ticket and no refund**, with
   nothing anywhere having failed.

`payments.reconcile_pending` (scheduled, 120s) asks the provider about every
booking holding an unresolved `payment_order_id` — the handle the platform
stores itself, so it needs no browser and no inbound connectivity — and runs
(2) on whatever comes back. A capture found while the hold is ALIVE is
ticketed; one found after the sweeper released the seats is REFUNDED. That
second half is what makes "paid, nothing delivered" impossible rather than
merely rarer: money kept for an undelivered ticket is the one outcome this
module exists to prevent.

**`PaymentPort.captured_payment_for_order(order_id)` is what made it
possible** — `fetch_payment` needs a PAYMENT id, and a payment id is something
only the customer's browser ever saw. Any future payment adapter must
implement it. Its candidate window is bounded on both sides
(`PAYMENT_RECONCILE_MIN_AGE_SECONDS` so it does not race a live checkout,
`PAYMENT_RECONCILE_GRACE_MINUTES` so an abandoned checkout is not asked about
forever) with a partial index matching exactly that query.

**The general rule for every money path after this one:** if fulfilment can
only be triggered by something arriving, ask what happens when it does not
arrive. If the answer is "money is kept and nothing is delivered", a scheduled
reconciliation is not optional.

## Check-in: fast, correct one-scan entry (cache the count, decide under the lock)

`checkin` is the gate. People are physically queuing, so a scan must be
low-latency; and the same ticket must NEVER admit two people, even if scanned
at two gates in the same millisecond. Both matter; neither is sacrificed. It
REUSES booking's signed-token verifier and Ticket record — it never mints
tokens or tickets. It's the door analog of ticketing's no-oversell rule:

> **Attendance _display_ is cached and fast. The admit _decision_ is ALWAYS
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
"external I/O outside the lock" rule guards lock _contention_, which doesn't
apply here. **Concurrency is proven** (`test_concurrency.py`,
`transaction=True` + threads): two dispatchers of one claim send exactly once.

**Notification types wired** (from events the other modules emit): `USER_REGISTERED`
→ welcome email (**consolidated here from accounts** — accounts emits, this
module sends); `BOOKING_CONFIRMED` → the **ticket delivery email** (event +
booking reference + the QR) _and_ an SMS (the most important message); OTP →
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
`POST /admin/settlements/{id}/release` only _triggers_ it, pre-checking finished
so `EventNotFinished` surfaces synchronously while the payout still runs
off-request): lock the row → skip if `paid` → re-verify event finished →
**recompute `net` authoritatively from the payment records** (`PaymentRepository.
aggregate_event_settlement`) → if `net <= 0` settle to zero (no external call, no
notification) → else `PaymentPort.release_payout(account_id, net, idempotency_
key="settlement:{id}")` **under the lock** (the settlement row is uncontended —
like notifications' dispatch, the "I/O outside the lock" rule guards _contention_,
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
  `communities`/collaboration, `venues`/seat-maps, `marketing`.
- **The frontend (Next.js) has five slices built** — the foundation (design
  system, app shell, typed data layer), the DISCOVERY layer (home, deep search,
  the browse page, city + category landing pages), the EVENT PAGE (hero +
  lightbox, hydration-safe countdown, real ticket tiers from
  `GET /events/{id}/ticket-types` with UNCACHED availability, sticky ticket
  panel, organiser, venue + directions, FAQs, policies, related), and the
  BOOKING FUNNEL (tickets -> conditional sign-in -> review -> Razorpay), and
  the ADMIN CONSOLE (`/admin` — sidebar shell, ⌘K palette, notification centre,
  reusable data table, SVG charts, activity timeline, health tiles), gated on
  `is_staff` and wired to `apps/console`. The
  funnel reserves REAL inventory via `POST /bookings` with a derived
  `Idempotency-Key`, counts down the real `hold_expires_at`, lazy-loads Razorpay
  Checkout only on press, and confirms by POLLING the booking until the
  backend's own webhook marks it `paid` — the browser's success callback is
  never treated as proof. With no live `RAZORPAY_KEY_ID` it says so rather than
  simulating a payment. See
  `frontend/README.md`, and `frontend/BACKLOG.md` (78 items) for the backend
  fields the discovery layer wants but works without today — a suggest endpoint,
  an `Event.category` column, price/organiser filters, a `sort` param, a cities
  aggregate, and a cheap `meta.count`.
- **The PERFORMER STUDIO (`/studio`) is the marketplace's supply side.** Act
  picker, create, and eight act-scoped screens under `/studio/[id]` (overview,
  leads, pipeline, calendar, profile, photos, analytics, preview). Scoped to one
  ACT, not an account — leads are matched per act and a profile IS an act, so
  the id is in the URL. The profile editor autosaves against `Performer.version`
  (one save in flight, trailing save queued, `409` offers a RELOAD not a retry —
  retrying a conditional update with a refreshed version is how you clobber the
  edit the lock just protected). Photos collect alt text BEFORE upload (the
  server refuses without it), show real progress via `XMLHttpRequest`, and
  cancel/retry per file. Five pipeline lanes, all real — the brief's
  "Negotiation" has no state and "Accepted"/"Booked" are one transaction, so
  neither was drawn. The calendar is an AGENDA of real dates with no "available"
  cells (nothing stores availability). Analytics counts only the act's own rows
  and NAMES the four metrics it cannot have (views, conversion, impressions,
  peer comparison) rather than approximating them. The preview renders the
  marketplace's OWN `PerformerProfile`/`PerformerCard` via `toPublicShape`,
  since `GET /performers/{id}` 404s for the drafts that most need previewing.
  **One backend change:** `photos` on `OwnerPerformerSerializer`, via one
  grouped query attached in the view (`_with_photos` /
  `PerformerMediaRepository.all_media_for_many`) so an owner list is not an
  N+1. BACKLOG 70–78 record the eight capabilities left unbuilt and why.
- **The admin console is an operations centre.** Same attention-first shape as
  the organizer dashboard (`lib/admin/attention.ts`), the same table engine,
  and three rules specific to operating a platform: **a health tile is never
  green because nobody looked** (probed vs configured are drawn differently,
  and `unknown` gets its own state); **reversible actions get undo rather than
  a confirmation dialog** (`components/admin/undo.tsx` — the write goes
  immediately and Undo issues the COMPENSATING write, so it is never a
  deferred action pretending to have happened); and **a section nothing backs
  is absent, not empty** — there is no Support nav item, no chargebacks tab and
  no latency chart, because each could only ever show an invented number on the
  screen operators trust most.
- **The organizer dashboard is an operations platform**, not a set of tables.
  Its home answers three questions in order of how expensive each is to miss:
  what needs attention (a rejected event or a failed payout, DERIVED from real
  rows in `lib/organizer/attention.ts`), what happened today, what is next.
  Everything below it — Events, Bookings, Customers, Analytics, Check-in,
  Payouts, Refunds, Activity — shares one table engine
  (`lib/organizer/table.ts` + `components/organizer/data-table.tsx`): sticky
  header, resizable columns, a persisted column chooser, keyboard row
  navigation via roving tabindex, bulk selection and CSV export. Filter state
  lives in the URL on every surface, so a filtered view is shareable and
  survivable. **Client-side sorting says it is client-side** — these lists are
  cursor-paginated on a fixed server ordering, and a table that implies it
  sorted everything is how an organizer concludes their best event is their
  worst.
- **Event content is a first-class collection now** (`apps/events`):
  `EventMedia` / `EventFaq` / `EventTimelineEntry`, plus seven content columns
  on `Event` itself (`short_description`, `duration_minutes`, `language`,
  `age_restriction`, `accessibility_notes`, `seo_title`, `seo_description`).
  All seven are in `UpdateEventRequestSerializer`'s editable set and in
  `_EDITABLE_FIELDS` — **a column the event page renders must be reachable by a
  PATCH**, or the field is decoration. `GET /events/{id}/content` returns media
  + FAQs + running order in ONE edge-cached request (one round trip, not three,
  before the gallery paints); the write endpoints are per-collection and
  owner-only. Uploads go through `core/uploads.py`, which checks size, then the
  declared type against an ALLOW-list, then the leading bytes against that
  type — SVG is excluded outright, because it is an XML document that can carry
  script and serving one from our own origin is stored XSS. `alt_text` is
  REQUIRED by the API even though the column allows blank: the column is
  permissive so a backfill survives, the API is strict so no new row is
  created without it.
- **The Event Creation Studio** (`/dashboard/events/new`) is the organiser half
  of that: eight steps (basics, venue, schedule + running order, tickets, media,
  details + FAQs, search, review), local-first autosave, undo/redo, ⌘S / ⌥←→,
  and a live preview that applies the SAME metadata fallback chain the public
  page does (`seo_title || title`, `seo_description || short_description ||
  derived`) rather than a second, drifting one. Media uploads use
  `XMLHttpRequest` — the one place in the codebase that does — because `fetch`
  has no upload-progress event, and a cancel button returns a real abort
  handle. Alt text is collected BEFORE the bytes go up: the server refuses a
  file without it, and text written while looking at the picker is real alt
  text where a field appended to a finished grid gets "image1". Steps that need
  a saved draft (gallery, FAQs, running order) say which fields unlock them
  instead of rendering a form that 404s.
- **The frontend never invents data.** Ratings, "interested" counts, booked
  percentages, verified-organizer badges, and distance/language/accessibility/
  duration filters were each asked for and each deliberately NOT built, because
  no column backs them; every badge and number on screen is derived from
  something the backend maintains, and counts from a cursor-paginated list are
  rendered as floors ("24+ events") rather than as totals nobody computed.
  BACKLOG.md item 12 lists each omission against the field it would need. The
  funnel holds the same line: no guest checkout (a ticket needs a user), no promo
  field (no coupon endpoint), no tax line (no tax field), and the platform fee is
  shown but never ADDED — the backend takes it OUT of the total rather than
  charging it on top.
- **One sign-in surface, and it admits what isn't wired.** `components/auth/
auth-panel.tsx` is rendered by BOTH the standalone `/sign-in` route and the
  funnel's sign-in SHEET — two copies of an auth form is how the two drift. The header
  carries the control (a `?next=`-preserving Sign in when anonymous, an account
  menu when not; the menu's Console entry is the only link to `/admin`, shown
  only for `is_staff`). Google, Apple and phone/OTP are BUILT but have no
  backend: each fails instantly with a plain sentence naming the provider,
  never a spinner and never a success that didn't happen — an auth control that
  appears to work is the worst thing to fake, because a ticket and a payment are
  attributed to whoever it claims you are. Switching either on is one env var
  (`NEXT_PUBLIC_OAUTH_BASE_URL`, `NEXT_PUBLIC_PHONE_AUTH_ENABLED`), no component
  change; `frontend/BACKLOG.md` item 19 specifies the three endpoints. **The
  phone field takes its country code from a picker** (`lib/auth/dial-codes.ts`),
  not from a hint asking somebody to type `+91` on a numeric keypad where `+`
  lives behind a symbols key; `toE164` composes the two and absorbs a pasted
  international number (their `+` wins over the select), a trunk zero, a
  doubled country code and any punctuation. The `<select>` is transparent over
  a face showing only the code, because a native select sizes itself to its
  widest OPTION — styled directly it drew a 221px picker beside a 113px number
  box, the control for choosing one of eighteen things twice the width of the
  one for typing ten digits. `?next=`
  is validated as a same-origin path (`components/auth/safe-next.ts`) — an open
  redirect is exactly what a "send you back where you came from" affordance
  invites.
- **A second bug the funnel had:** the ticket stepper computed "displayed
  quantity + 1", but the displayed value trails the URL (the selection lives in
  the query string) by a render — so two quick taps on `+` both wrote 1 and the
  second was silently dropped, on the money path. It now takes an updater over
  the LIVE URL, like `setState`. Regression-tested with a real double-click.
- **One backend bug the funnel found:** `POST /bookings` documents an
  `Idempotency-Key` header, but django-cors-headers' default
  `CORS_ALLOW_HEADERS` omits it, so a browser never sends it and the request
  never leaves the origin. One line in `config/settings/base.py` —
  `frontend/BACKLOG.md` item 17.

## The organizer module's operations surface (four additions)

`apps/organizer` is the per-organizer twin of `console` and is almost entirely
read. Four things were added for the operations platform, each because the
frontend genuinely could not do it:

1. **Date ranges on the lists.** `starts_after`/`starts_before` on
   `event-rows`, `created_after`/`created_before` on `bookings`. These MUST be
   server-side: the lists are cursor-paginated, so a client-side window means
   paging through everything to find the rows inside it, and is wrong wherever
   a page boundary falls inside the range. A MALFORMED date is treated as an
   absent filter rather than a 400 — the list is already scoped to the caller,
   so the worst it can do is widen to "all of mine", and a dashboard that 400s
   because a date picker emitted something odd is worse. `_datetime_param` also
   repairs an unencoded `+00:00` (which arrives as a space), because that is
   the single most common client slip and silently dropping the filter looks
   identical to the filter not working.
2. **`GET /organizer/refunds`** — the read side over the existing `Refund`
   model. `is_partial` is COMPUTED from the refunded amount against the
   payment's rather than stored, because partiality is a fact about the pair.
   There is deliberately no `status`: a `Refund` row is written only after the
   vendor call succeeded, so every row is completed, and pending/approved/
   rejected would need a refund-REQUEST model that does not exist.
3. **`GET /organizer/feed`** — the Activity Centre. Five bounded reads
   (bookings, refunds, admissions, payout attempts, publishing decisions)
   merged and re-sorted in the selector. **Not one SQL union**, because the
   five rows live in five modules and a raw query would re-encode every
   module's ownership rule. **Not the outbox**, because `OutboxEvent` has no
   owner column — filtering it per organizer would mean scanning the whole
   platform (see BACKLOG "Owner-scoped activity log"). Every entry carries a
   `severity` from the server, so a failed payout cannot render like a ticket
   sale.
4. **`POST /events/{id}/archive`** — a real lifecycle transition, from
   draft/rejected/finished only. `live` is excluded because archiving an event
   on sale hides it while issued tickets stay valid; `pending_review` because
   an operator would be deciding on a row that had vanished. There is **no
   delete counterpart and should not be**: an event is referenced by bookings,
   tickets and a settlement, all `PROTECT`ed, so a delete would fail or orphan
   real money.

## The console's operations additions (four, all small)

Built for the Admin Operations Center, each because the frontend genuinely
could not do it:

1. **A `status` filter on the moderation queue.** Approved/Sent back/Archived
   tabs were impossible against a pending-only endpoint. `draft` is
   deliberately NOT reachable — an unsubmitted draft is an organizer's private
   workspace, and `EventRepository.MODERATABLE_STATUSES` is the allow-list that
   makes guessing a query string fall back to pending. **The paginator had to
   change with it**: pending is FIFO and the decided lists are newest-first,
   and cursor pagination does not validate that its `ordering` matches the
   queryset's — given a mismatch it silently returns wrong pages rather than
   failing. Hence a second paginator class, and `-created_at` rather than
   `-moderated_at` (an event can reach `archived` without ever being moderated,
   and a null in the keyset makes paging skip rows).
2. **`GET /admin/payments` + `GET /admin/refunds`.** The Payments surface had
   no read side at all. `is_partial` is COMPUTED from the refunded amount
   against the payment's, because partiality is a fact about the pair.
3. **User suspension** (`POST /admin/users/{id}/suspension`). Sets
   `is_active=False`, which `AuthService.authenticate` already refuses — so it
   is an access decision, not a label. `AccountAdminService` is its own service
   for the same reason `EventModerationService` is: every method on
   `AuthService` acts for the account holder and every method there acts on
   somebody else's account. Two refusals, both to stop an operator locking
   people out: **no self-suspension** (they would 401 on the next request) and
   **no suspending staff** (operators could suspend each other until nobody can
   sign in). Suspending twice is a `409` rather than a silent success, so a
   double-click cannot write a second audit row claiming a second suspension.
4. **A `signups` metric** on the timeseries — every account, because the
   question is "is the platform growing".

## The operator console (`apps/console`) — the read side of the platform

The tenth backend module, and the only one that is almost entirely READ. It
exists because an admin dashboard needs to ask questions no single module can
answer: "how much did the platform take today", "what is waiting for a human",
"what just happened". Built to the same shape as every other module.

**It crosses module boundaries on purpose, and only downward.**
`ConsoleRepository` imports the models it reports on (bookings, payments,
events, scans, organizations, settlements, the outbox) rather than making each
module grow an admin-shaped selector nobody else calls. Nothing in it writes,
so it cannot break another module's invariants. The ONE write it exposes —
deciding a pending verification — calls `organizations`' own service, which
owns the rule and emits the outbox event.

**Every aggregate is computed in Postgres**, never in Python. Counting 50k
bookings in a list comprehension is the obvious way to make the admin
dashboard the slowest page on the platform.

**The activity feed IS the outbox.** `core.OutboxEvent` already records every
domain event in the same transaction as the write that caused it, so it is
complete, ordered, and needs no second audit pipeline. `GET /admin/activity`
reads it directly.

**Health tells the truth about what it checked.** Database and cache are
PROBED (a connection, a cache round-trip) and report `ok`/`degraded`.
Payments, storage, queue, event bus, email and SMS report `unknown` plus which
adapter is configured — this endpoint does not contact a vendor to decorate a
widget, and a tile that is green because nothing checked it is the one an
operator would trust to page somebody.

**Caching**: `console:overview` 30s, `console:timeseries:{m}:{d}` and
`console:breakdown:{by}:{n}` 300s. There is deliberately NO
invalidation-on-write: these are platform-wide aggregates touched by every
module, so precise invalidation would mean every module knowing about the
console. A short TTL is the simpler, more robust answer for a dashboard.

**Timeseries are dense** — every day in the window, zeros included. The
database returns only days that have rows, and handing that to a chart draws a
line that skips quiet days, turning a flat week into a climb.

Endpoints (all `IsAdminUser`, all `private, no-store`): `overview`,
`timeseries`, `breakdown`, `activity`, `health`, `organizations`, `users`,
`settlements`, `verifications`, and `POST /admin/organizations/{id}/verification`.

`User.is_staff` is now exposed on `UserSerializer` — without it the frontend
cannot tell an operator from anyone else, and an admin UI that cannot check its
own audience is not an admin UI. It is a role flag, not a secret; the API still
enforces every check.

## Production readiness: the deploy gate, the clock, and the limits

A dedicated audit pass removed every fake, mocked and placeholder capability.
`REAL_INTEGRATIONS_AUDIT.md` is the full record — every credential, webhook,
callback URL, SDK and manual step. Four things it added are binding on all
future work:

1. **Production refuses to boot on a placeholder** (`core/preflight.py`, run
   from `prod.py`/`staging.py`). A fake adapter, a dummy secret and a real one
   all satisfy the same interface, so the app boots and looks healthy while
   doing nothing — `PAYMENTS_BACKEND=fake` in prod means every checkout
   succeeds and no money moves. It RAISES rather than warns, because a rollout
   controller will happily replace working instances with a healthy-looking
   broken one. **When you add a port with a fake adapter, add it to
   `_FAKE_BACKENDS`; when you add a real adapter, add its credentials to
   `_ADAPTER_CREDENTIALS`.**
2. **Periodic work goes in `core/scheduling.py`, not in a comment.** Several
   tasks were registered, tested and documented as "scheduler-fired in prod"
   while nothing fired them: held inventory would have leaked permanently and
   **organizers would never have been paid**. The schedule lives in code next
   to the tasks; `manage.py run_scheduled_jobs [--once]` drives it. A schedule
   that exists only in a Cloud Scheduler console is invisible in review,
   untested, and absent in every other environment.
3. **Rate limits are real and shared** (`core/throttling.py`). They subclass
   `SimpleRateThrottle`, never `ScopedRateThrottle` — the latter reads
   `view.throttle_scope` and RETURNS TRUE when absent, so a throttle attached
   only via `throttle_classes` silently permits everything. They fail OPEN if
   Redis is down: a shut door at a venue is worse than a window of unmetered
   requests, and the correctness guards (signature verification, row locks)
   never depended on them.
4. **`TaskQueuePort`'s Cloud Tasks adapter now has a receiver**
   (`core/task_dispatch.py`, `POST /internal/tasks/run`). Before it, every
   enqueue succeeded and every delivery 404'd, silently, forever. An unknown
   task name returns 200 on purpose — Cloud Tasks retries any non-2xx, and a
   task whose handler no longer exists can never succeed.

**Web Push is real** (`PushPort` -> `WebPushAdapter`, `PushSubscription`,
`/push/config`, `/me/push/subscriptions`, `/push/rotate`, `app/sw.js`), and is
the one capability that was outright faked before: the discovery card asked for
a browser permission and said "notifications are on" when nothing subscribed and
nothing could be sent. VAPID keys are SELF-GENERATED
(`manage.py generate_vapid_keys`), which is why this could be finished while
Google sign-in could not. **Unconfigured, it disables itself** — the port reports
`is_configured() == False`, the subscribe endpoint 422s, and the UI renders
nothing rather than collecting subscriptions it can never deliver to. That
pattern — refuse rather than pretend — is the rule for any future optional
integration.

## Deployment: the topology is part of the codebase

A later read-only production readiness audit found **eight critical blockers,
none of them in application code**. The application was correct; its deployment
was not, and no test could see the difference because the tests were all
passing. `DEPLOYMENT.md` is the ordered runbook; the rules below are binding.

**1. Two compose files, and `environment:` is banned from the production one.**
Compose's `environment:` outranks `env_file:`. The old single file set
`DATABASE_URL` and `REDIS_URL` there, so a carefully configured Supabase and
Upstash in `.env` were **inert** — every write went to a local Postgres with
nothing anywhere saying so. Now `docker-compose.yml` is production and sets no
environment variable at all; `docker-compose.override.yml` (auto-loaded) is
development and holds every override, explicitly and named.
`core/tests/test_deployment_topology.py` fails if an override reappears.

**2. Three processes, not one.** `web` (gunicorn — never `runserver`),
`scheduler` (`run_scheduled_jobs`, exactly one replica) and `worker`
(`config.worker`). The compose file had only the first: **held inventory was
never released and organizers were never paid**, with no error, because the
tasks were registered and simply never fired. A test asserts every job in
`SCHEDULE` has a process that can run it.

**3. Migrations never run on boot.** They are a compose **profile** running
`manage.py migrate_safe`, which uses the `direct` (session-mode) alias, prints
`showmigrations --plan` first, requires confirmation, refuses a non-interactive
production run without `--yes`, and holds an advisory lock. Auto-migrate applied
unreviewed schema changes on every deploy and raced itself across replicas.

**4. The image must install the extras its backends select.** `pip install -e .`
gave base dependencies only, so `PAYMENTS_BACKEND=razorpay` had no razorpay
package and **the first checkout raised `ModuleNotFoundError`** — lazily
imported, so nothing failed at boot or in CI. `INSTALL_EXTRAS` is a build arg
(`razorpay,push,observability,s3`; `dev` added only by the dev override).
**Preflight now refuses a selected backend whose SDK is missing, and a
configured credential whose library is missing** — a set `VAPID_PRIVATE_KEY`
means somebody expects delivery.

**5. Development has a gate too** (`check_development_settings`, run from
`dev.py`). `DEBUG=True` and `CORS_ALLOW_ALL_ORIGINS=True` are correct for
development and catastrophic over real data: any 500 renders `SECRET_KEY`, the
database password and the Razorpay secret to the caller, and any site can call
the API with a victim's token. Neither half is an error alone, which is why
nothing reported the pair. Dev now **refuses to boot** against a non-local
database or a live `rzp_live_` key. A real SMTP relay or SMS provider warns
instead — an email to a real person is recoverable, and blocking a developer
over it is not proportionate.

**6. `pytest` creates and drops its database, so test settings refuse a
non-local host.** `DIRECT_DATABASE_URL` fell through to `.env`, which was
production Supabase; a routine `pytest` would have dropped a database there.
`ALLOW_REMOTE_TEST_DATABASE=1` is the only way past it.

**7. Storage is S3-shaped** (`core/adapters/s3/`). One adapter covers Supabase
Storage, Cloudflare R2, Backblaze B2, MinIO and AWS S3 — path-style addressing
and SigV4, because a non-AWS endpoint needs both. `local` is refused in
production: uploads would go to the container filesystem and vanish on redeploy.
Whatever host serves them must also be `NEXT_PUBLIC_MEDIA_BASE_URL`, or
`next/image` refuses every poster, silently, one image at a time.

**8. Never silently discard a value an operator set.** `WEB_CONCURRENCY` is
bounded by the connection POOLER rather than the CPU (each worker holds its own
connections; exhausting the pooler presents as a database outage), so the
computed default is capped at 9 — but an explicit value is **honoured**, with
the risk printed on the process's first line. Silently clamping it would be the
same failure mode as `environment:` silently outranking `env_file:`, which is
the bug this whole configuration exists to remove.

## Google Maps Platform and Google Calendar

Two ports, one Google project, and the same refuse-rather-than-pretend rule as
push and payments.

**Maps** (`MapsPort` -> `GoogleMapsAdapter`, `apps/maps`). ONE
`GOOGLE_MAPS_API_KEY` for Places, Geocoding, Directions, Distance Matrix and
Photos — that is Google's model (a key is enabled per-API), so one key is one
quota, one bill and one rotation. **Everything except the Maps JavaScript API
is proxied through the backend**: the browser key is only referrer-restricted,
which any script can forge, and proxying is also what makes caching and rate
limiting possible. The photo proxy is mandatory rather than an optimisation —
Google's photo endpoint takes the key as a QUERY PARAMETER, so linking it
directly publishes the key in an `<img src>`.

Three rules the adapter enforces and any future Maps work must keep:

1. **Google's `status` field is the real error channel.** It returns HTTP 200
   with `ZERO_RESULTS`, `OVER_QUERY_LIMIT` or `REQUEST_DENIED`, so checking
   only the status code makes a billing-disabled key look exactly like a venue
   that does not exist. Each maps to a distinct reason -> HTTP status -> retry
   policy.
2. **Caching follows Google's terms, not convenience.** Place/geocode CONTENT
   is cached for hours to a week (their ceiling is 30 days); a place ID may be
   kept indefinitely, which is why `Event.place_id` is a COLUMN and everything
   else is cache-only. Autocomplete is uncached on purpose — caching keystrokes
   breaks the session-token grouping that makes it cheap.
3. **Never invent a coordinate.** `Event.latitude`/`longitude` are nullable and
   the map renders only when both are present. (0, 0) is a real place in the
   Atlantic, so a default would be a confident lie rather than an approximation.

**Calendar** (`CalendarPort` -> `GoogleCalendarAdapter`, `apps/integrations`)
reuses the SAME OAuth client — Google issues one per application, and a second
would mean a second consent screen and a second verification review. Scopes are
`calendar.events`, `openid`, `email` and nothing more; the broader `calendar`
scope also permits deleting entire calendars.

Four things make the grant safe, each with a test:

- **`state` is single-use, server-side and consumed before any work.** It is
  also how the callback knows WHOSE grant it is — the browser returns from
  Google with no Authorization header, and taking a user id from the query
  string would let anyone attach their Google account to somebody else's.
- **PKCE S256**; the verifier never leaves the server.
- **`access_type=offline` AND `prompt=consent`.** The first makes Google issue
  a refresh token at all; the second makes it issue one on a RECONNECT. Without
  the second, a reconnecting user gets an access token with nothing to renew it
  and the connection dies in an hour.
- **A dead grant is terminal, and the mark is written OUTSIDE the transaction.**
  Marking `needs_reconnect` inside the atomic block and then raising rolls the
  mark back, so every subsequent request retries a revoked token forever. That
  bug was written and caught by a test; do not reintroduce it.

Refresh tokens are encrypted at rest (`core/encryption.py`, Fernet keyed by
HKDF over `SECRET_KEY`). Rotating `SECRET_KEY` makes them unreadable — `decrypt`
returns `None` rather than raising, so that degrades to "everyone reconnects"
instead of "every calendar sync 500s".

**Never fakes success**: not connected -> 404, grant lapsed -> 409, scope
withheld -> 403, Google unhappy -> 502. Four codes because the frontend must do
four different things.

## SEO: the URL is a contract, and structured data must not contradict the page

The SEO foundation was already strong — `robots.ts`, `sitemap.ts`, per-route
`generateMetadata`, canonicals on eighteen routes, `Event`/`BreadcrumbList`/
`ItemList`/`WebSite`/`FAQPage` JSON-LD, edge-generated OG cards, `noindex` on
every private surface, one `<h1>` per page. What was added closes specific gaps,
and five rules come out of it.

**1. An event URL is `/events/{slug}-{uuid}`, and the UUID is the identity.**
`Event.slug` (`apps/events/slugs.py`, derived from the title on create/rename)
is DECORATION; the uuid beside it is what resolves the row. That one decision is
why there is **no unique constraint, no collision suffix, no slug-history
table**, why a rename is free (the old URL still carries the same uuid and 308s
to the new one), and why `GET /events/sitemap` and every future `/events/<word>`
route is safe from an event titled "Sitemap". The slug is computed ONCE on the
backend and serialized — `lib/events/ref.ts` concatenates, never re-derives, or
the canonical tag and the sitemap eventually disagree and nobody notices for
months. It is absent from `_EDITABLE_FIELDS`: a client cannot set it.

**2. A redirect that must be a real 3xx cannot live in the page.**
`app/(site)/loading.tsx` gives the route group a Suspense boundary, so Next
flushes the shell before the page — or its `generateMetadata` — resolves. A
`redirect()` thrown after that cannot set a status code: Next encodes it into
the RSC stream as a CLIENT-side navigation. A browser follows it and everything
looks right, and Googlebot sees `200 OK` with an empty shell. Both placements
were written and both were measured with `curl` before `middleware.ts` was.
**The middleware costs the hot path nothing**: a canonical URL already carries
its slug, so only a segment that is EXACTLY 36 characters is looked up, and
every failure falls through to `next()` — the bare URL renders perfectly well on
its own. `matcher: ['/events/:ref+']`, not `:ref`: the plain form compiles to a
regexp matching `/events` and nothing under it, which is invisible because the
middleware then simply never runs.

**3. Structured data is DERIVED, never assumed.** `eventJsonLd` used to
hard-code `EventScheduled` and `InStock`, so a sold-out show advertised itself
as buyable and a CANCELLED event — which keeps its page on purpose — told Google
it was going ahead. Both now come off the row, and `availability` is OMITTED
when `tickets_available` is null rather than guessed. Google demotes structured
data that contradicts the page, and the visitor who clicks it has been misled by
us. Same rule for the performer offer: "price on ask" emits no offer, because a
zero reads as "free".

**4. `JsonLd` escapes `<`.** Every value in those blocks is an organizer's own
title, description or venue. `JSON.stringify` keeps the JSON valid, and the HTML
parser does not care about JSON validity — it ends the script at the first
literal `</script`. That was an XSS seam on the busiest public route, not just
an SEO one.

**5. A filtered browse URL canonicalises to the landing page that owns it.**
`/events?category=comedy` points at `/categories/comedy`; `?city=Mumbai` at
`/cities/mumbai`; anything else at `/events`. Without it every filter
permutation was its own indexable URL competing with the prerendered landing
pages built to rank for exactly those queries. The "is this the only filter"
test asks `filtersToSearchParams`, NOT raw truthiness — `sort` always parses to
`'soonest'` and made every view look combined, so the canonicals never fired.
And a city canonicalises only if it is a CURATED one: `cities/[city]` calls
`notFound()` for the rest, and a canonical pointing at a 404 can drop the real
page from the index.

**The sitemap now lists every live event and every published performer**, with a
real `updated_at` rather than the build time (which tells a crawler the whole
site changed at once and therefore nothing is worth re-fetching). Both feeds
degrade to `[]` on failure: an exception in `sitemap.ts` does not lose the event
URLs, it takes `/sitemap.xml` down entirely, and the static half is worth more
than a 500. Both cap at `SITEMAP_MAX_URLS` (45,000) — past that the protocol
needs a sitemap INDEX, which is deliberately not built before it is needed.

**`/hire` lists acts again, but only when there are any.** The profiles are
indexable and canonical'd and NOTHING linked to them, which makes a page not so
much unranked as absent. Zero published acts renders nothing at all, exactly as
before — a section nothing backs is absent, not empty.

## The front page follows a reference design, and only where it can be honest

The home screen and `/hire` were rebuilt to a supplied reference (District by
Zomato). What was copied is the SHAPE — a two-row header, a full-width hero that
commits to one event, a chip row, a poster grid. What was not copied is anything
that would require inventing product.

**Four rules came out of it, and they generalise:**

1. **Copy a nav's shape, never its contents.** The reference bar carries seven
   destinations (Dining, Movies, Stores, Play…) because that company sells seven
   things. Ours carries the four routes that exist. A nav item is a promise that
   a page is there.
2. **A chip is a filter or it is not a chip.** Every quick filter on the home
   page is `browseHref(...)` — a real, shareable `/events?…` URL the browse page
   parses, so the compiler enforces the vocabulary. The reference's "Under 10 km"
   is absent: distance needs coordinates most events do not have and a parameter
   `GET /events` does not accept, and a chip that quietly returned everything is
   a filter that lies. "Tomorrow" IS there, as the one-day date range it actually
   is — computed per render, because a date frozen at module scope on an ISR page
   means the day after whichever day the bundle was built.
3. **The h1 can be invisible; it cannot be absent or unstable.** The biggest text
   on the first screen is an event's name, and that name changes on every chevron
   press — a document whose heading mutates on a carousel click has no outline. So
   the h1 is `sr-only`, first in the document, and names the PAGE.
4. **A reference behaviour that costs an affordance does not ship.** The
   reference collapses its whole nav row on scroll. That was built here and taken
   back out, because this row also holds the ACCOUNT CONTROL — collapsing it left
   a signed-in visitor with no route to their tickets or sign-out until they
   scrolled back to the top. The row condenses instead.

**The palette did not move.** Every token in `styles/tokens.css` is unchanged;
what changed is layout, type and density. Typography went from Space Grotesk over
Inter to **one family, Plus Jakarta Sans**, separated by weight and tracking
rather than by family — two skeletons that disagree is why the old headings read
as a different product from the paragraphs under them.

**`PosterCard` sits BESIDE `EventCard`, not on top of it.** Browse is a working
surface where you compare twenty events on date, price and availability, so its
card keeps its chips, its date row and its bordered container. The front page is
a shop window: one artwork, three lines of text, no chrome. Two cards because
they answer two questions — and both take their availability badge from the same
helper, so an event never contradicts itself between them.

## Clone an event, and what a copy deliberately does not inherit

`POST /events/{id}/duplicate` copies an event into a fresh DRAFT. Running the
same show monthly meant retyping the venue, the policies, the age limit and the
running order every time.

A copy is a NEW event, not a continuation, so nothing the original EARNED comes
with it:

- **Always a draft**, whatever the source was. A copy of a live event arriving
  already live would be an event published without anyone deciding to.
- **No moderation history.** A previous approval was for a specific event on a
  specific date; a human decides on the copy again.
- **No `from_price_minor` / `tickets_available`.** Display denormals `ticketing`
  recomputes from real tier rows — copying them puts a price on a page with
  nothing behind it.
- **No bookings, tickets, scans or settlement.** They are `PROTECT`ed to the
  original.
- **NO TICKET TYPES.** They belong to `ticketing`, and dependencies point one
  way — ticketing imports events, never the reverse — so reaching across to
  clone tier rows would invert the rule that keeps the modules separable. The
  consequence is deliberate and stated in the API docstring: the copy cannot be
  published until a tier is added, which is the publish check `ticketing`
  registers.

FAQs and the running order ARE copied — they belong to `events`, and they are
the retyping this exists to remove. **Media is not**, and that is not an
oversight: an `EventMedia` row points at a stored object, so two events sharing
one storage key means deleting either one's gallery breaks the other's. Copying
it safely needs a real object copy in the storage adapter; skipped rather than
done wrongly. The poster URL comes across on the event row, which is a plain
column and not a lifecycle-managed asset.

`policies` is copied BY VALUE. It is a list column, and copying the reference
means editing the clone's policies edits the original's for the life of the
process.

The UI bounds it to ONE selected row. Cloning eight events at once produces
eight drafts called "Copy of …" with nothing to tell them apart.

## The hero is the artwork; the gallery is its own section

They used to be one list: the organiser's gallery photographs were appended to
the hero's filmstrip, so the top of the page carried every image the event had
and there was no gallery section at all.

They answer different questions. The hero is "what is this" — one picture,
above the fold, the LCP element. The gallery is "show me more", asked after
deciding to keep reading. Split, the hero stays a single decisive image and the
photographs get a section that is ABSENT, not empty, when there are none.

Both render `HeroGallery`, so there is one lightbox — the arrows, Escape, focus
return, background inerting and arrow-key stepping are the hard part, and a
second copy is a second set of focus bugs. The gallery instance passes
`priority={false}`: the hero above is the LCP element and a second
high-priority image set competes for the same bandwidth.

## Auto-motion needs a stop, and it is not optional

The home page's All Events rail advances every 4 seconds. WCAG 2.2.2 requires a
pause mechanism for anything moving automatically past five seconds, and there
are three, all real: a visible pause button, pause on hover AND keyboard focus
(or tabbing to a card moves it out from under the focus ring), and no motion at
all under `prefers-reduced-motion`.

It scrolls with `scrollBy` rather than a transform animation, so the rail stays
draggable, swipeable and keyboard-scrollable. Touching it hands control over
PERMANENTLY — an auto-advance that resumes over a deliberate scroll is the most
irritating thing a carousel does. `onScroll` is deliberately not the stop
signal, because `scrollBy` fires it too and the rail would pause itself on its
own first tick.

## Readiness means "can I serve", not "is everything perfect"

`/health/` returned 503 whenever ANY probe failed, cache included. That looks
careful and is wrong, and it rolled back a working deploy.

The sequence, because every step was individually reasonable: Upstash's quota
ran out; the Redis adapter was fixed to degrade on a quota refusal, which also
made `ping()` honest; `/health/` started truthfully reporting the cache as
down; and the deploy pipeline's FIRST smoke test is `[ "$code" = "200" ]`. So a
degraded cache blocked a release — and the release it blocked was the one
repairing the cache path.

**The database decides readiness. The cache never does.** Every read path is
cache-ASIDE and falls through to a query the database can still answer, so an
instance with no cache is slower and completely correct. Refusing traffic over
it is the same mistake `RedisCacheAdapter` exists to prevent, moved one layer
up.

`status` is `ok` while the instance can serve and `unhealthy` only when it
cannot. Nothing is hidden: `checks` reports each probe and a `degraded` array
names what is down while still serving, so an operator reads the real state
from a 200 instead of inferring it from a status code that cannot tell
"slower" from "broken". `core/tests/test_health.py` pins the smoke-test
contract explicitly, because the pipeline lives in another directory and
cannot fail this file's build.

## Ticket selection is a screen again — and the rule is ASK ONCE

This has now been both ways, and the history is the point.

It began as funnel step 1 while the EVENT PAGE also carried a full picker, so
pressing Book asked for the same four things twice. That was fixed by deleting
the step and keeping the event page's picker; `/booking/{id}` became a redirect.

It is a screen again, and the event page's picker is gone. The duplication is
still absent — resolved the other way. Why this half won: a tier carries live
availability, a per-order maximum and a sale window, and a picker wedged into a
22rem sidebar beside a poster is the worst place to read any of it.

**The invariant that survived both reversals is the one to keep: exactly one
screen picks.** `components/event/booking-cta.tsx` must never grow a tier list
or a quantity control; the moment it does, the funnel asks twice again.

The event page's CTA carries **no `?tickets=`**. Nothing has been chosen yet,
and a preselected basket is the checkout deciding on the visitor's behalf.

**The funnel is TWO screens — Tickets, then Review & pay — for everyone.**

`payment` was a screen whose entire job was to restate the order the previous
screen had just shown (the same lines, the same total, the same platform-fee
note) and then offer a button: a whole navigation and a second chance to
abandon, in exchange for a summary somebody had already read. The button moved
onto the summary (`payment-section.tsx`, which had been written for exactly
this and left unmounted). Nothing about the payment changed — no card UI on
this origin, the browser's success callback is still not proof, and
confirmation still polls the BACKEND until it says `paid`.

`login` was a screen for a thing that is not part of buying a ticket, counted
by the progress row as a quarter of the journey, and reached by leaving the
selection behind. **Signing in is a SHEET now** (`components/auth/
auth-sheet.tsx`) over whichever screen asked for it — the tickets stay chosen
and stay visible behind the scrim, and the session's arrival continues the
flow from where it paused. It renders `AuthPanel` verbatim, the same component
`/sign-in` uses: two copies of an auth form is how the two drift, and this one
sits in front of a payment.

Both URLs are kept as `redirect()` shims carrying their query — they are in
histories and in links people sent themselves, and a 404 mid-checkout is the
worst place to learn a route retired. `currentStep` still maps both, because
for the frame before a redirect resolves the shell has a pathname to place, and
mapping it to a step that no longer exists is how the stepper highlights the
wrong disc.

**The stepper must agree with the ROUTER** — it once drew "Review" as step 1
for somebody the router was about to bounce to `/login`. And **an outcome is
not a step**: `confirmation` has its own id and marks every disc done, because
`findIndex` returns -1 for it and the old `Math.max(..., 0)` told somebody
holding a paid ticket they were back at step one with two things left to do.

## Preview, then "See all" — disclosure has to earn itself

Two of the event page's six disclosures render a preview ON the page instead of
collapsing to a row, because hiding them is disclosure for its own sake:

- **Things to know** shows four facts (`QuickFacts limit={4}`) — the date, the
  run time, the venue, the organiser — with "See all" beside it. One component
  renders both lengths, so a hand-written preview cannot drift from the list.
- **Schedule** shows "Gates open at 1:00 PM" with "View full schedule &
  timeline". The time is OMITTED rather than guessed when a timeline entry has
  no `starts_at`.

Everything genuinely long — the venue card, the organiser, the FAQ set, the
policies — stays a row.

## Security headers, and the one that is deliberately missing

`next.config.mjs` sets `frame-ancestors 'none'`, `base-uri 'self'`,
`object-src 'none'`, `form-action` (Razorpay allowed, since Checkout POSTs back
on some flows), plus `nosniff`, `Referrer-Policy` and `Permissions-Policy`.
There was NO CSP anywhere before: `prod.py`'s `X_FRAME_OPTIONS: DENY` covers
what the BACKEND serves, and every page a visitor looks at is served by Next.

**`geolocation=(self)`, not `()`.** `LocationPrompt` asks for it; denying it
would break a shipped feature while looking like a hardening win.

**`script-src` is deliberately absent.** Without nonces it needs
`'unsafe-inline'`, which is the exact capability injected script needs — theatre
that also risks breaking Razorpay on the money path. Doing it properly means a
per-request nonce from middleware, which opts every page out of static
rendering. On a read path tuned to 0 warm DB queries that trade needs measuring,
not assuming. Separate change, own test run.

## Cities is a selector, not a destination

`/cities` and `/cities/[city]` are DELETED. Location is chosen from the header
now, so a city is a filter you apply rather than a page you visit, and the
landing pages were a second way to express `?city=` that had to be kept in sync
with the browse view forever.

**The route is gone; the URLs are not.** Those pages were indexed and are in
`sitemap.xml`, in browser histories and in shared links, so deleting the route
is not the same as deleting the URLs. `middleware.ts` **308**s a curated city to
`/events?city={name}` — the browse view showing exactly what the landing page
showed. 308 and not 307 for the same reason the event-slug redirect uses one:
it is permanent, and a crawler needs telling or it keeps asking.

**An uncurated slug still 404s.** `/cities/nashik` never had a page, and
redirecting it to `/events` would be a soft 404 — a URL that never existed
answering 200 with content nobody asked for. Only the slugs that HAD a page get
a redirect.

**`?city=` is now the one single filter that is self-canonical.** It used to
canonicalise to `/cities/{slug}`; pointing it at a URL that now 301s would make
the crawler resolve an extra hop to learn what it already had, and Google treats
a canonical chain as a hint it may ignore. `?category=` still canonicalises to
`/categories/{slug}`, which is a real page.

**`lib/discovery/cities.ts` STAYS.** It is the data behind the city switcher,
the location prompt, the filter drawer and the search suggestions. What was
removed is a ROUTE, not the concept of a city.

## The All Events filter bar sticks with CSS and nothing else

`position: sticky` on the chip row, whose parent is the same Container that
holds the grid. A sticky element is bounded by its CONTAINING BLOCK, so it
follows the reader down the event list and stops of its own accord where the
section ends — which is the entire requirement, with no scroll listener, no
measured offsets and no `IntersectionObserver`. A JS version would additionally
have to re-measure on resize, on font load and on every filter change.

Three things it does not work without, each verified by measuring
`getBoundingClientRect` at several scroll positions rather than by eye:

1. **A background.** The row is transparent by default and the poster grid
   scrolls visibly through it.
2. **`z-[999]`, one below the header's `z-sticky` (1000).** The header sticks at
   `top-0` and this sticks beneath it; on equal z the later element in the DOM
   wins, so the chips would slide over the header's bottom edge and its shadow.
3. **It stays a SCROLLER at every width** rather than wrapping from `sm`. A bar
   that is one line on a phone and two on a tablet changes height as it pins,
   which shifts the grid underneath it.

Measured: pins at 88px on desktop and 80px on mobile, stable across the whole
section, and released (`barTop` −801 against a section bottom of −701) once the
section has scrolled past.

## Progressive disclosure on the event page (primary, secondary, tertiary)

The event page had TEN full-weight sections stacked below the fold — good to
know, the running order, the organiser, the venue, accessibility, two FAQ sets,
reviews and two policy sets. Every one of them rendered at once, which made the
page a document to scroll rather than a decision to make.

None of it was deleted. Somebody genuinely needs the age limit and somebody
genuinely needs the refund rule — they just do not need them at the same
moment. So information is now sorted three ways, and this ranking governs every
detail surface built after it:

- **Primary, always visible:** poster, title, date, venue, price, the ticket
  panel, the countdown. What decides whether to book.
- **Secondary, visible but compact:** the description, the video, reviews.
- **Tertiary, one press away:** the fact grid, running order, venue card,
  organiser card, FAQs and policies — each a `DisclosureRow` opening a
  `DetailSheet` holding the SAME component that used to sit on the page.

**The content is unchanged; only when you see it changed.** The sheets reuse
`sections.tsx` verbatim, so there is no second copy of the venue card to drift.

Four rules came out of it:

1. **A row carries a summary, not just a label.** "Venue details" alone makes
   the reader press to find out whether pressing was worth it; "Venue details /
   Phoenix Marketcity, Mumbai" has already answered the common case.
2. **A row with nothing behind it is ABSENT, not empty.** `buildDisclosures`
   omits the running order when the organiser supplied none, and omits
   accessibility rather than opening a sheet that says nothing — on access
   information especially, an empty panel reads as a claim that there is no
   provision, which is not what an empty column means.
3. **One sheet, keyed by the active row.** A single `openKey`, never six
   booleans: two booleans can both be true, which Radix renders as two stacked
   focus traps where Escape then closes the wrong one. The `key` on the sheet
   also stops React reusing one instance across two disclosures, which would
   carry the previous sheet's scroll position into the next.
4. **The icon must be a rendered ELEMENT, never a component reference.**
   `buildDisclosures` runs in a server component and the rows are consumed by a
   client one; a function cannot cross that boundary. React rejects it with
   "Functions cannot be passed directly to Client Components", and it surfaces
   as the WHOLE event page failing to render rather than as a missing icon.
   That bug was written here and caught by e2e — eight event-page specs went
   red at once, including ones that had nothing to do with the change.

**A bottom sheet on a phone, a centred dialog on a pointer.** One component
(`components/event/detail-sheet.tsx`) on Radix's Dialog, so the focus trap,
Escape, the inert background and `aria-modal` are the library's rather than a
re-implementation — seven hand-built dialogs would be seven sets of focus bugs.
The shape differs by viewport because the ergonomics do: a centred dialog on a
phone puts its close button where a thumb cannot reach. The header is pinned
and only the body scrolls, so a long policy set can never push its own close
control off screen.

**Heading levels inside a sheet start at `h3`.** Radix renders the sheet's
title as an `h2`, so a subsection using `SectionHeading` (also an `h2`) would
sit as a peer of the thing it belongs to, and the outline a screen-reader user
navigates by would say they are two unrelated headings.

## Saved events: the affordance comes before the account

`events.SavedEvent` is a user's saved event, and the shape of the API follows
from one product decision: **saving is available before anybody signs in.** A
heart that demands an account removes the affordance for exactly the people
still deciding whether to make one. So the browser saves to `localStorage`
while anonymous and MERGES that set on sign-in.

That merge is why `POST /me/saved-events` takes a LIST and returns the WHOLE
set rather than what changed — the client replaces its local state outright
instead of reconciling, which makes the merge one idempotent call over a set
somebody has been building for a week. The list is bounded (200): an
authenticated endpoint that loops over whatever it is handed is an unbounded
write.

Three smaller decisions:

- **It lives in `events`, not `accounts`.** Dependencies point one way here —
  `accounts` is depended on by everything and depends on nothing, so it must
  not grow knowledge of the catalogue.
- **`CASCADE`, not `PROTECT`.** A saved row means nothing without its event
  and, unlike a booking, is not a financial record anyone must keep.
- **No `saved_count` denormal.** A "1,247 people saved this" badge is the kind
  of number this platform refuses to invent, and a real one would need
  maintaining on every save for a figure nobody has asked to display.

A saved event that is cancelled or past **still appears**, carrying
`is_available: false`. Hiding it would look like the save was lost; the card
says so instead of offering a dead Book button.

## A dependency check must IMPORT, not ask whether a file exists

`core.preflight._module_importable` calls `importlib.import_module`, not
`importlib.util.find_spec`. It used `find_spec` first, on the reasonable-
sounding grounds that a path lookup is cheaper than executing a vendor SDK's
module body. That answers the wrong question:

    find_spec("razorpay")  ->  True      (the package is on disk)
    import razorpay        ->  ModuleNotFoundError: pkg_resources

razorpay 1.4.2 imports `pkg_resources` at module scope. That module ships with
setuptools, which Python 3.12 images no longer install by default — so the
gate passed, the container started, and the failure was waiting on the first
checkout. Exactly the class of bug the check exists to prevent, walking
straight through it.

A package can be present and unimportable for several ordinary reasons: a
missing transitive dependency, a C extension built for another Python, a
half-written install. Only an import tells them apart. The cost argument does
not survive either — every module checked belongs to a SELECTED backend or a
CONFIGURED credential, so it is imported within the first few requests anyway.
Doing it at boot is earlier, not extra.

**`setuptools` is pinned `>=68,<81` in the razorpay extra, and the UPPER bound
is the point.** setuptools 81 removed `pkg_resources`; an unbounded `>=68`
resolves to 83 and reintroduces the exact failure the pin was added to fix —
which is how it was first written here. The forward fix is razorpay 2.x, which
drops `pkg_resources`; that is a major version bump on the PAYMENTS SDK and
belongs in its own change with its own test run, not as a side effect of a
packaging fix.

CI now imports every selected SDK inside the built image for the same reason.

## Curation is not derived data (`cms.FeaturedCity`, `cms.PopularSearch`)

Two admin-managed lists, and what matters is what they are NOT:

- **Featured cities are not the platform's city list.** `Event.city` is a free
  string, so every city with an event in it is already searchable and already
  has a landing page — that is what "all Indian cities" means and it needs no
  table. This is the handful an operator promotes on the front page.
- **"Popular" searches are not a measurement.** There is no search-term log,
  and a number invented from nothing is precisely what this codebase refuses
  to display elsewhere. An operator picks them. When a query log exists this
  becomes the fallback and the shape does not move — the panel asks for
  `(label, query)` pairs and does not care where they came from.

`label` and `query` are separate columns so a chip can read "Comedy nights"
while querying the stem that actually matches rows.

**Both ride on the homepage payload** rather than getting endpoints of their
own: that response is already edge-cached and warmed by the front page, so it
is one cached document with one invalidation instead of three. The search panel
falls back to a bundled list when the payload has not arrived, because it opens
on pages that never fetched the homepage.

**Deleting a featured city is a HARD delete**, unlike `Category`, which
archives. Nothing links to one — the city's landing page resolves from
`Event.city`, not from this row — so there is no bookmark to keep working.

### Two traps this slice hit

**`ClassVar` in a model's `Meta` breaks django-stubs globally.** Annotating
`indexes`/`ordering`/`constraints` as `ClassVar[...]` in `cms/models.py` made
mypy lose `Model.objects` across FOURTEEN unrelated files — 52 errors in
`checkin`, `notifications` and elsewhere. The rest of the codebase writes plain
`indexes = [...]` in `Meta`; match it. Running mypy on the changed app alone
hid this, because the plugin degrades quietly.

**Cache invalidation runs in `transaction.on_commit`**, so a test asserting
that an operator's edit reaches the public page needs
`django_capture_on_commit_callbacks(execute=True)`. Without it the assertion
fails for a reason that looks like a missing invalidation and is not.

## Dates: named windows and a chosen range are different things

`when` (today / weekend / week / month) and `dateFrom`/`dateTo` are SEPARATE
fields, not one. The quick windows are named, shareable and stable — "this
weekend" means something different tomorrow, which is the point — while a
chosen range is a literal. Folding them together would mean either losing the
name or inventing a fake window id for every possible pair of dates.

The rules, each with a test:

- **An explicit range beats a named window** when a hand-edited URL carries
  both. The literal is the more specific instruction.
- **A malformed date is treated as ABSENT, not as an error.** These params come
  from links people share and edit, the view is already scoped safely, and a
  browse page that 400s because a picker emitted something odd is worse than
  one showing more results than asked for. Same reasoning as the organizer
  lists' date filters.
- **A reversed range is SWAPPED**, not dropped — somebody who picked the dates
  in the other order meant the span between them.
- **A range starting today is clamped to NOW**, or the first page is full of
  events that started this morning.
- **A range entirely in the past sends no bound at all.** `after > before`
  matches nothing; no bound at least shows something.
- **Clearing the range clears BOTH ends.** It is one filter with two fields;
  dropping only `dateFrom` leaves a dangling `dateTo` the picker cannot
  represent.

**Everything is IST**, and the browser's own timezone is deliberately never
consulted: the events are in India and the day a user taps is the day they mean
locally. `istToday()` at 20:00 UTC is already tomorrow — a browser-timezone
calculation would highlight the wrong "today" for every Indian user every
evening, which is a test in `calendar.test.ts`.

The calendar arithmetic is a pure module for the same reason the search
panel's placement is: its failure cases are month boundaries, leap years and
timezone edges, none of which are visible by looking at a calendar that
renders.

## Search opens in two shapes, from one component

Pressing a search FIELD opens a panel anchored beneath that field; invoking by
keyboard (⌘K, `/`) opens the centred palette. Same component, same focus trap,
same Escape handling — two components would be two search experiences with two
sets of keyboard bugs.

The rule: **a trigger passes itself as the anchor; a keyboard shortcut passes
nothing.** A panel that jumps to the middle of the screen breaks the link
between the control pressed and the results shown, and a palette summoned by a
reflex has no control to attach to.

**The keyboard half of that was documented for months and never wired.** This
section, and `search-context.tsx`'s own docstring, both described ⌘K and `/` on
the public site; only `admin-shell.tsx` had a handler, so on every public page
the reflex did nothing and nothing said so. It is a `keydown` listener in
`SearchProvider` now. `/` is the delicate one — a printable character must never
steal a keystroke from someone typing, so it stands down inside any `input`,
`textarea`, `select` or `contenteditable` (matched with `closest`, because the
caret in a contenteditable sits on a descendant), and for any modifier, since
⌘/ and Ctrl+/ belong to the OS and the browser. Three e2e specs asserted this
behaviour and were being read as stale; they were right and the app was wrong.

Two details that are not obvious:

- **The scrim belongs to the palette only.** Anchored, the panel is a dropdown
  attached to a field — dimming the page would make it read as a modal and hide
  the context the user is searching within.
- **The compact icon trigger is deliberately NOT anchored.** It is a 40px icon
  on a narrow viewport; a panel hung beneath it would pin to one corner with
  nothing to align to.

**The placement arithmetic lives in a pure function** (`anchored-position.ts`),
separate from the effect that reads the DOM, because its edge cases are exactly
the ones invisible on a wide monitor: a trigger near the right rim, a viewport
narrower than the panel, a trigger too low to have room beneath it. Two real
bugs were caught there by tests rather than by eye — a width floor that beat
the viewport cap (a 380px panel on a 360px phone), and a height floor that
pushed results off the bottom. The second is why the panel **flips above the
trigger** when there is no usable room below, which is what every dropdown
does and the only option that keeps it both on screen and usable.

## Email verification: the code is a credential, so treat it like one

Registration creates the account and emails a six-digit code. **It issues no
tokens.** Handing out a session at sign-up would make verification optional in
practice — keep the token, never open the email — so the session is withheld
until the address is proven, and `POST /auth/verify-email` is what returns it.
Verifying IS the sign-in, not a step followed by a second login.

Four rules, each protecting something specific:

1. **`User.email_verified` is a SEPARATE flag from `is_active`.** `is_active`
   means an operator suspended the account (the console's suspension endpoint,
   which `authenticate` already refuses on). Conflating them would show every
   unverified sign-up as suspended, and un-suspending somebody would silently
   mark their address proven.
2. **The code is never stored.** `EmailVerification.code_hash` holds a
   password-hasher digest. For the life of a code, anyone who can read that
   table — a backup, a support tool, a read replica — could otherwise finish
   somebody else's registration.
3. **Guesses are bounded ON THE ROW, under a lock.** Six digits is a million
   possibilities, which an unthrottled attacker exhausts in under an hour, and
   IP throttling is defeated by rotating addresses. After `MAX_ATTEMPTS` the
   row is spent, which makes the search space per code 5 rather than 10^6. The
   attempt is recorded even for an expired or consumed row — otherwise a dead
   code is a free oracle for probing whether others are live.
4. **`email_not_verified` is checked AFTER the password.** Answering it to a
   wrong password would confirm an account exists for that address. Reaching
   that line requires already knowing the password.

**Do not raise inside the `atomic()` block that records the attempt.** Doing so
rolls the increment back, the guess budget never decreases, and `MAX_ATTEMPTS`
becomes unreachable — the entire brute-force defence, silently gone. The
outcome is carried out in a local and raised after the block commits. This is
the same bug the Google Calendar adapter documents, reintroduced once here and
caught by `test_attempts_are_capped_and_then_the_code_is_spent`.

**A notification dedupe key must be unique per MESSAGE, not per second.** The
key was `verify:{user}:{expiry_timestamp}` first, so two requests inside the
same second collided and a legitimate resend was swallowed by the idempotency
ledger — the user waited for an email the system had decided not to send. It is
the verification row's id, which is unique by construction.

## Seed data belongs in code, not only in a migration

`cms`'s homepage copy was seeded by a data migration and nowhere else, and
`HomepageRepository.get_or_create_singleton()` — which is on the READ path —
created the row **empty**. So a platform whose singleton was created by a first
read before the migration ran, or deleted afterwards, served a **blank front
page forever**: no exception, no log line, nothing failing a health check, and
the seed migration is deliberately non-destructive so it could never repair it.

The rule this establishes:

**Anything that lazily creates a row on a read path must create it populated.**
Defaults live in a plain module (`apps/cms/defaults.py`) that the repository
passes as `get_or_create(defaults=...)`, so the row is correct however it comes
to exist. Return a fresh copy per call (`initial_hero()`) — handing out the
module-level dict lets one request's edit to a mutable field mutate the default
for the life of the process.

**The migration keeps its own frozen copy on purpose.** A migration is a
historical record: replaying it must produce what it produced originally. If it
imported the live constants, changing a default would retroactively change what
that migration did. The duplication is the correct trade, and both files say so.

**A test must never assert migration-seeded rows.** Django FLUSHES the database
after every `@pytest.mark.django_db(transaction=True)` test — the concurrency
tests, which are the most important tests in the codebase — and that deletes
data-migration rows permanently. With `addopts = "--reuse-db"` (the project
default) they never come back, so such a test passes on the first run of a fresh
database and fails on every run after it. Assert the guarantee (the endpoint
serves usable copy) and create whatever rows the test needs itself.

## Build order

`accounts` (done) → `organizations` (done) → `events` (done) →
`ticketing` (done) → `booking` (done) → `payments` (done) →
`checkin` (done) → `notifications` (done) → `settlements` (done) →
`console` (done — the operator console's read side) → `organizer` (done) →
`cms` + `announcements` (done) → `performers` (done — the Hire a Band
marketplace, the platform's SECOND product surface).

## `performers` — the Hire a Band marketplace

The first module that is not about ticketing. A customer posts a BRIEF ("a
jazz band, in Mumbai, on 14 March, around ₹80,000"); performers answer with
QUOTES; the customer accepts one. That is the whole marketplace, and it is
deliberately small — the instant-booking-with-held-inventory shape is what
`ticketing` already does, and a live performance has no inventory to hold, it
has a negotiation.

**It reuses rather than parallels.** A `Performer` is owned by an
**Organization**, not a User — so an organizer who already runs events lists a
band without a second account, and the operator who verified the organisation
has already verified the act. Publishing goes through the SAME moderation gate
as events (draft → pending_review → live | rejected), with the same FIFO queue,
the same required rejection reason, and the same "resubmission clears the stale
note" rule. `search_vector` is a tsvector kept current by a DB trigger with a
GIN index, exactly as `events` does it — and the trigger flattens the `genres`
and `languages` JSON arrays into the vector, because people arrive by genre far
more than by name.

**Two invariants carry the weight:**

1. **A brief has exactly one winner.** Accepting a quote closes the request,
   books that act and declines every other quote — in ONE transaction. The race
   guard is a `status=OPEN` predicate on the request update, so a second accept
   matches zero rows rather than overwriting the first winner. Declining the
   losers is not housekeeping: a performer whose quote sits pending forever
   cannot tell a lost bid from a slow customer, and will hold the date.
2. **A lead tells a performer nothing about the customer.** `OpenRequestSerializer`
   carries the job and not the person — the customer's identity is not the
   performer's to have until they are hired. Enforced server-side.

**One quote per performer per request**, enforced by a UNIQUE constraint and
caught as `IntegrityError` — a check-then-insert leaves a window two concurrent
submissions both pass.

**What is deliberately NOT modelled:** ratings and reviews (nothing stores a
review, so a star count would be a number with nothing behind it — and this is
a decision worth tens of thousands of rupees), a real availability calendar,
and payment through the platform. `travel_radius_km` is stored and displayed
but NOT used to match leads, because matching a radius needs coordinates and
`city` is a plain string on both sides. All are BACKLOG items 61–68.

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

---

<!-- BEGIN aws-agent-toolkit: installed by `aws configure agent-toolkit`.
     Source: aws/agent-toolkit-for-aws rules/aws-agent-rules.md
     Appended 2026-08-27. Everything above this marker is this project's own
     conventions and was not modified. -->

## AWS Guidance

- Prefer the AWS MCP Server for AWS interactions — it provides sandboxed
  execution, observability, and audit logging. If unavailable, use the
  AWS CLI directly.
- Before starting a task, check whether a relevant AWS skill is available.
  Load the skill with `retrieve_skill` and prefer its guidance over
  general knowledge.
- When uncertain about specific AWS details (API parameters, permissions,
  limits, error codes), verify against documentation rather than guessing.
  State uncertainty explicitly if you cannot confirm.
- When creating infrastructure, prefer infrastructure-as-code (AWS CDK or
  CloudFormation) over direct CLI commands.
- When working with infrastructure, follow AWS Well-Architected Framework
  principles.
- Do not use em dashes in AWS resource names or descriptions. Use
  hyphens instead.

### Secret Safety

- MUST load the `aws-secrets-manager` skill first for any secret,
  credential, API key, token, or password task. MUST NOT call
  `secretsmanager get-secret-value` or `batch-get-secret-value`, and MUST
  NOT hit the Secrets Manager Agent daemon directly. MUST use
  `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with
  `asm-exec` so the secret resolves at runtime without entering context.

<!-- END aws-agent-toolkit -->
