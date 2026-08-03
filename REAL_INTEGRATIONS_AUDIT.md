# Real integrations audit

Every external dependency this platform has, what state it is in, and exactly
what is needed to make each one real. Nothing is omitted because it is
inconvenient; a capability that is not built is listed as not built.

**Scope.** Consumer platform, organizer platform, performer marketplace, admin
console, CMS, search, booking, auth, notifications, payments, uploads, email,
SMS, push, maps, calendar, QR, analytics, SEO, observability, security.

**How to read the status column.**

| Status | Means |
| --- | --- |
| ✅ **Real** | Production code path exists and is tested. May still need a credential — see the credential table. |
| 🔑 **Real, needs credential** | Code is complete. Set the env var and it works. No code change. |
| 🚫 **Not built** | The capability does not exist. It is **not faked anywhere** — the UI says so or the surface is absent. Listed in *Remaining work* with what it would take. |
| ⚠️ **Local-only by design** | A fake adapter used in dev/test only. Production refuses to boot on it (see *The deploy gate*). |

---

## 0. What changed in this pass

Seven things were genuinely fake or missing. Six are now real; the seventh had
no honest version and the UI now says so.

| # | Found | Consequence if shipped | Now |
| --- | --- | --- | --- |
| 1 | **No rate limiting anywhere** | `POST /auth/login` was an unmetered password oracle. A stolen credential list could be tried at line rate with nothing in the stack noticing. | Real DRF throttles on auth/webhook/check-in/upload/write, backed by shared Redis. 16 tests. |
| 2 | **Nothing fired the scheduled jobs** | `booking.release_expired` and `settlements.release_due` were registered, tested, documented as "scheduler-fired in prod" — and never called. Held inventory would leak permanently and **organizers would never be paid**. | `core/scheduling.py` + `manage.py run_scheduled_jobs`. 12 tests. |
| 3 | **Cloud Tasks POSTed to a URL that did not exist** | With `QUEUE_BACKEND=cloud_tasks`, every enqueue succeeded and every delivery 404'd. Silently, forever, with no application error. | `/internal/tasks/run`, shared-secret + optional OIDC. 12 tests. |
| 4 | **Nothing stopped a fake adapter reaching production** | `PAYMENTS_BACKEND=fake` in prod means every checkout succeeds and no money moves. The app boots and looks healthy. | `core/preflight.py` refuses to start. 24 tests. |
| 5 | **The subscribe card claimed a capability that did not exist** | It requested a browser permission and said *"Notifications are on for this device."* Nothing subscribed, nothing was stored, nothing could be sent. | Web Push built end to end — port, adapter, model, endpoints, service worker. 32 tests. |
| 6 | **`NEXT_PUBLIC_*` URLs defaulted to localhost** | A production build with them unset emits a sitemap, canonical tags and OpenGraph URLs pointing at `localhost:3000`, which search engines index as written. | `next build` now fails. Verified: the build **did** fail until the vars were set. |
| 7 | **A 429 lost DRF's `Retry-After`** | Found by the live check, not by unit tests. A throttled client is told "too many requests" with no idea when to return — it gives up or retries immediately and stays throttled. | Header preserved, rounded **up**. 3 tests. |

Plus two smaller reliability fixes found while auditing: a **stuck-notification
sweeper** (a claim committed but never enqueued was a ticket email that silently
never arrived) and an **error-reporting seam** (Sentry, one env var, PII
scrubbed).

---

## 0b. The production readiness pass — deployment, not code

A later read-only audit scored this **62/100** and returned *NOT READY*. Not one
blocker was in application code: every one was in `docker-compose.yml`, `.env`
or the Docker image, and together they made one dangerous state — **live
production credentials loaded under development settings, against a local
database, with the vendor SDKs missing.**

The theme is worth stating because it is not the theme of §0. In §0 the code
claimed to do something it did not. Here the code was correct and **nothing ran
it, or it ran against the wrong thing** — a class of failure no unit test can
see, because the unit tests were all passing.

| # | Found | Consequence if shipped | Now |
| --- | --- | --- | --- |
| C1 | `DJANGO_SETTINGS_MODULE=config.settings.dev` with `rzp_live_` keys, real SMTP and production Supabase | `DEBUG=True` renders `SECRET_KEY`, the database password and the Razorpay secret to whoever triggers a 500. `CORS_ALLOW_ALL_ORIGINS=True` lets any site call the API with a victim's token. `check_production_settings` is imported by prod/staging only, so **the deploy gate never ran.** | `check_development_settings` in `dev.py` — dev settings **refuse to boot** against a non-local database or a live Razorpay key. Verified live: the real `.env` now refuses. |
| C2 | `pip install -e .` — base dependencies only, while `PAYMENTS_BACKEND=razorpay` | `di.payment_port()` imports razorpay lazily, so **the first checkout raised `ModuleNotFoundError`**. Nothing at boot, nothing in CI. | `INSTALL_EXTRAS` build arg; preflight now refuses a selected backend whose SDK is absent. Verified in the built image. |
| C3 | `cryptography` and `pywebpush` likewise absent | The OAuth callback 500s at the moment it stores a refresh token; every push send fails. | Same fix. Preflight also refuses a **configured credential** whose library is missing — a set `VAPID_PRIVATE_KEY` means somebody expects delivery. |
| C4 | Compose set `DATABASE_URL`/`REDIS_URL` in `environment:`, which outranks `env_file:` | **Supabase and Upstash were inert.** Every write went to a local Postgres and nothing anywhere said so. | Production compose sets **no** environment variable; dev overrides moved to `docker-compose.override.yml`. A test fails if one is added back. |
| C5 | `DIRECT_DATABASE_URL` was *not* overridden, and `test.py` uses it | `pytest` **creates and drops** `test_<dbname>` — it would have dropped a database on production Supabase. | `test.py` refuses a non-local host. It fired on the first run of this pass, against the real `.env`. |
| C6 | `runserver` overrode the image's gunicorn CMD | Single-threaded, auto-reloading, no request timeout. | `docker/gunicorn.conf.py`, every value set from a consequence. |
| C7 | `migrate --noinput` on every container start | Unreviewed schema changes on every deploy, racing across replicas. | `manage.py migrate_safe` behind a compose **profile**: session-mode connection, prints the plan, requires confirmation, advisory-locked. |
| C8 | No scheduler and no outbox worker in the compose file | Held inventory never released and **organizers never paid** — with no error, because the tasks were registered and simply never fired. | Both deployed, scheduler pinned to one replica. A test asserts every job on the schedule has a process that can run it. |
| H1 | `STORAGE_BACKEND=local`, no bucket-backed alternative | Uploads written to the container filesystem, lost on redeploy. | `S3StorageAdapter` — one adapter for Supabase Storage, R2, B2, MinIO and AWS. Path-style addressing and SigV4, so a non-AWS endpoint works. |
| H2 | Neither Supabase URL carried `sslmode` | psycopg2 defaults to `prefer`, which does not fail closed. | `sslmode=require` applied automatically to any non-local host; a `direct` alias added for DDL and tests. |
| H3 | Every public URL was localhost | OAuth `redirect_uri_mismatch`, `ALLOWED_HOSTS` rejecting the real host, calendar deep links pointing at localhost. | Preflight refuses a localhost or plain-`http` public URL in production. |
| H4 | `NUM_PROXIES=0` behind a tunnel | DRF keys on the proxy's own address, so `THROTTLE_AUTH=10/min` becomes 10/min **for the entire internet**. | Preflight warns (0 is correct with no proxy), and `DEPLOYMENT.md` says how to count the hops. |
| H5 | `.env.backup-pre-audit` untracked and un-ignored | `git add .` commits the live secret set. | `.gitignore` covers `.env.backup*`, `.env.*.bak`, `*.env.backup`. |
| H6 | Gmail as the production relay | ~500 recipients/day, and Gmail rewrites `From` so SPF/DKIM cannot align to your domain — for the platform's most important message. | Preflight warns, naming both limits. |
| M3 | `next/image` `remotePatterns` hard-coded `localhost:8000` | Behind a real domain, **every poster silently refused**. | Built from `NEXT_PUBLIC_API_BASE_URL` + `NEXT_PUBLIC_MEDIA_BASE_URL`. |
| M4 | The Maps **adapter** had 38 tests; the view and cache layers had none | Those layers decide the HTTP status, whether the server key can leak, and how much Google is billed. | `apps/maps/tests/test_api.py` — six classes over error-reason→status mapping, the config endpoint, authorisation, payload shape, **key leakage** (no response contains `GOOGLE_MAPS_API_KEY`; the photo proxy returns bytes, not a Google URL) and **caching** (place/geocode hit Google once; autocomplete deliberately uncached; traffic-aware routes never cached). |

**Two guards that did not exist in any form before**, both written because the
audit's own findings had nowhere to fail:

- `core/tests/test_deployment_topology.py` — parses the compose files and
  Dockerfile. C4, C6, C7, C8 and the packaging half of C2 would all have failed
  this. No Docker daemon needed, so it runs in CI.
- `TestRuntimeDependencies` in `core/tests/test_preflight.py` — a selected
  backend without its SDK, and a configured credential without its library.
  This is precisely the hole C2 and C3 fell through.

**The unifying rule, now applied on both sides of the boundary:** a fake
adapter, a missing SDK and a real integration all satisfy the same interface, so
a process running on any of them boots, serves traffic and reports itself
healthy. Production refuses to start on the wrong one — and, since this pass,
so does development.

---

## 1. Every production integration already complete

### Payments — Razorpay ✅ 🔑

| Item | State |
| --- | --- |
| Order creation | Real (`core/adapters/razorpay/adapter.py`) |
| Webhook signature verification | Real HMAC-SHA256 over the **raw** body |
| Idempotency | Three layers: `ProcessedWebhook` ledger, booking confirm dedupe on `payment_ref`, refund dedupe on `refund:{payment_id}` |
| Refunds | Real, idempotent, vendor idempotency key, outside any lock |
| Route split (organizer payout) | Real, `on_hold=True` at capture, released by `settlements` |
| Amount tampering | Captured amount checked against `booking.total_amount_minor`; mismatch auto-refunds |
| Failure recovery | Retry + dead-letter via `TaskQueuePort` |

The **fake adapter verifies signatures for real** — signature verification is
pure HMAC with no network, so `PAYMENTS_BACKEND=fake` runs the identical
security-critical code. That is why the fake is safe in dev and still refused
in production.

Needs: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.

### Rate limiting ✅ *(new)*

`core/throttling.py`. Backed by `CACHES["default"]` → the same Redis, so a limit
holds across every replica. A per-process cache would multiply every ceiling by
the replica count.

| Scope | Default | Keyed on | Why this number |
| --- | --- | --- | --- |
| `auth` | 10/min | IP | Credential guessing. A human signing in never approaches it. |
| `otp` | 5/hour | IP | Each request sends a **paid** SMS — a spend limit as much as a security control. |
| `webhook` | 600/min | IP | Deliberately **above** Razorpay's retry schedule. The signature is the real gate; throttling a genuine retry delays a paid ticket. |
| `checkin` | 1200/min | IP | A gate scans continuously. Denying a real scan is a queue at a door; a fake scan is already harmless (per-ticket row lock). |
| `upload` | 60/hour | user | Bytes, validation, storage cost. |
| `write` | 120/min | user | General authenticated write budget. |
| `anon`/`user` | 120/min, 600/min | IP / user | Defaults. |

Three design points, each a trap avoided:

- Subclasses `SimpleRateThrottle`, **not** `ScopedRateThrottle` — the latter
  reads `view.throttle_scope` and **returns `True` when it is absent**, so a
  throttle attached only via `throttle_classes` silently permits everything.
  The first version of this file made exactly that mistake and every rate test
  still passed; only firing real requests at the live view caught it.
- **Fails open.** If Redis is down these ALLOW and log at error. A shut door at
  a venue is worse than a window of unmetered requests, and the paths that must
  stay correct (signature verification, row locks) do not depend on this.
- `NUM_PROXIES` must equal the real hop count. Too small trusts a
  client-supplied `X-Forwarded-For` and lets anyone rotate their own limit key;
  too large keys every request on the proxy IP, making one global bucket.

### Scheduled jobs ✅ *(new)*

`core/scheduling.py` is the single source of truth; the deployment picks how to
drive it.

| Job | Interval | Missing it means |
| --- | --- | --- |
| `booking.release_expired` | 60s | Held inventory never returns. Permanently. On the money path. |
| `settlements.release_due` | 3600s | **Organizers are never paid.** |
| `payments.reconcile_pending` | 120s | **A customer pays and gets nothing.** No ticket, no refund, no error — see below. |
| `notifications.sweep_stuck` | 300s | A ticket email claimed but never dispatched never arrives. |

### Payment reconciliation ✅ *(new)*

Fulfilment used to require something to ARRIVE: a signed webhook (which needs a
public HTTPS endpoint) or `POST /payments/verify` (which needs the customer's
browser to make one more call after Razorpay hands control back). On a
deployment without a webhook URL — which is every deployment before its DNS is
cut over — that browser call was the only path, and it was issued as
`void verifyPayment(...).catch(() => {})`: un-awaited, un-retried, silently
swallowed.

Close the tab and the money was captured at the provider while the platform
never learned of it. The booking then expired on schedule, the inventory came
back, and every counter reconciled. **No ticket, no refund, and nothing
anywhere had failed** — which is why no test and no alert saw it.

`payments.reconcile_pending` removes the dependency entirely. It asks the
provider about every booking holding an unresolved `payment_order_id` — the
handle the platform stores itself, needing no browser and no inbound
connectivity — and converges on the same `verify_and_confirm` path, so the same
ledger row, amount check and idempotent confirm apply. A capture found while
the hold is alive is TICKETED; one found after the sweeper released the seats
is REFUNDED, which is the half that makes "paid, no ticket, no refund"
impossible rather than merely rarer.

The enabling primitive is `PaymentPort.captured_payment_for_order` —
`fetch_payment` needs a payment id, and a payment id is something only the
customer's browser ever saw.

```bash
python manage.py run_scheduled_jobs --once     # Cloud Scheduler / CronJob / crontab
python manage.py run_scheduled_jobs            # supervised loop (compose, VM)
python manage.py run_scheduled_jobs --list     # print the schedule
```

Prefer `--once` in production: the platform owns the clock, retries and the
alert on a missed run.

### Background task delivery ✅ 🔑 *(new)*

`POST /internal/tasks/run` (`core/task_dispatch.py`), mounted **outside**
`/api/v1/`. Block it at the edge for everything except the queue's egress.

Semantics chosen for what Cloud Tasks does with each status:

- **unknown task → 200.** A task from a previous release whose handler is gone
  can never succeed; a 404 would make the queue retry until its deadline.
- **handler raised → 500,** which is what should be retried, under the queue's
  own backoff.
- **malformed body → 400,** logged, not retried.

Authenticated by `X-Internal-Task-Secret`, compared with `hmac.compare_digest`
(a plain `==` returns early on a mismatch and leaks the secret a byte at a
time). Cloud Run should **also** require an OIDC token from the queue's service
account — this endpoint runs a handler that releases money.

### Google Maps Platform ✅ 🔑 *(new)*

`MapsPort` → `GoogleMapsAdapter`. **ONE** `GOOGLE_MAPS_API_KEY` for every
service — Google's own model, so one quota, one bill, one rotation.

| API | State | Endpoint |
| --- | --- | --- |
| Places — autocomplete | ✅ | `GET /maps/places/autocomplete` |
| Places — details | ✅ | `GET /maps/places/{place_id}` |
| Places — text search | ✅ | `GET /maps/places/search` |
| Places — photos | ✅ proxied | `GET /maps/places/photo` |
| Geocoding — forward | ✅ | `GET /maps/geocode?address=` |
| Geocoding — reverse | ✅ | `GET /maps/geocode?lat=&lng=` |
| Directions (4 modes) | ✅ | `GET /maps/directions` |
| Distance Matrix | ✅ | `POST /maps/distance-matrix` |
| Maps JavaScript | ✅ browser | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` |

**Everything except the JavaScript API is proxied.** The server key never
reaches a browser; results are cached (which is where nearly all the cost
saving comes from); and a runaway client hits our rate limit rather than the
billing account. The photo proxy is not optional — Google's photo endpoint
takes the key as a **query parameter**, so linking it directly would publish
the key in an `<img src>`.

Production concerns, each handled rather than assumed:

- **Timeouts** are split connect/read. A hung read is the dangerous one: with
  no read timeout a stalled Google response holds a worker until gunicorn
  kills it, which during a ticket rush turns a slow dependency into an outage.
- **Retries** on 429/5xx only, with backoff, GET only. Never on a 4xx that is
  our fault — that just spends quota to get the same answer.
- **Google's `status` field is the real error channel.** It returns HTTP 200
  with `ZERO_RESULTS`, `OVER_QUERY_LIMIT` or `REQUEST_DENIED`, so a caller
  checking only the status code sees success and an empty list — which is how
  a billing-disabled key looks identical to a venue that does not exist. Each
  maps to a distinct reason → distinct HTTP status → distinct retry policy.
- **Caching respects Google's terms**: place/geocode CONTENT for hours to a
  week (their ceiling is 30 days), place **ids** indefinitely — which is why
  `Event.place_id` is a column and the rest is cache-only. Autocomplete is
  deliberately uncached (its key space is unbounded and caching keystrokes
  would break the session-token billing that makes it cheap).
- **Rate limiting** on its own `maps` scope, user-keyed. A spend limit as much
  as an abuse control.
- **Validation**: coordinates are range-checked at construction; >100
  origin×destination pairs are refused before Google bills for them; photo
  widths are clamped; a photo response that is not an image is rejected
  (Google answers a stale reference with an HTML page and a 200).

**Unconfigured, it disables itself honestly.** `DisabledMapsAdapter` refuses
every call, `/maps/config` reports `available: false`, and the event page
shows the address plus a directions link rather than an empty grey frame. A
stub returning invented coordinates would put a marker on a building nobody
is performing in.

**`Event` gained `place_id`, `latitude`, `longitude`** (all nullable). The map
renders only when both coordinates are present — a default of (0, 0) is a real
place, in the Atlantic off Ghana.

### Google Calendar ✅ 🔑 *(new)*

`CalendarPort` → `GoogleCalendarAdapter`, over the **same** OAuth client as
everything else Google. No second client: Google issues one per application,
and a second would mean a second consent screen and a second verification
review.

| Capability | State |
| --- | --- |
| Connect (OAuth) | ✅ `POST /me/integrations/google/connect` |
| Callback | ✅ `GET /auth/oauth/google/callback` |
| Disconnect (+ revoke at Google) | ✅ `DELETE /me/integrations/google/connect` |
| Refresh access token | ✅ automatic, under a row lock |
| Create / update / delete event | ✅ |
| Add a purchased ticket | ✅ `POST /me/calendar/events` |
| Reminders | ✅ 24h and 2h popups |
| Sync on event change | ✅ `EVENT_UPDATED` → fan-out |
| Cancel on event cancellation | ✅ `EVENT_ARCHIVED` → fan-out |

**Scopes: `calendar.events`, `openid`, `email` — and nothing more.** Not the
broader `calendar` scope, which also permits deleting entire calendars.

Security, each verified by a test:

- **`state` is single-use and server-side**, held in Redis against the user
  id and CONSUMED before any work. A replayed callback finds nothing. It is
  also how the callback knows *whose* grant it is — the browser returns from
  Google with no Authorization header, and trusting a user id in the query
  string would let anyone attach their Google account to somebody else's
  Eventful account.
- **PKCE S256**, verifier never leaving the server. Not strictly required for
  a confidential client; it costs one hash and closes authorization-code
  injection.
- **`access_type=offline` + `prompt=consent`** — the first is what makes
  Google issue a refresh token at all, the second is what makes it issue one
  on a *reconnect*. Without the second, a reconnecting user gets an access
  token and nothing to renew it with, and the connection dies in an hour.
- **Refresh tokens are encrypted at rest** (`core/encryption.py`, Fernet,
  key derived from `SECRET_KEY` via HKDF). A refresh token does not expire —
  a plaintext database dump would be a breach of every connected calendar.
- **Refresh happens under a row lock**, because Google rotates the refresh
  token on some responses and two concurrent refreshes would leave the loser
  holding a dead one.
- **A dead grant is terminal.** Revoked, expired-after-6-months, or
  password-changed all surface as `invalid_grant`; the connection is marked
  `needs_reconnect` and retrying stops. The mark is written **outside** the
  transaction — inside it, raising would roll the mark back and every request
  would retry a dead token forever.
- **Never fakes success.** Not connected → 404, grant lapsed → 409, scope
  withheld → 403, Google unhappy → 502. Four codes because the frontend must
  do four different things.

**Unconfigured, it disables itself**: `is_configured()` is false, connect
answers 503, and the UI does not render the button.

### Check-in / QR ✅

| Item | State |
| --- | --- |
| Generation | Real. `v1.<payload>.<hmac>`, HMAC-SHA256, **no PII** — ids only. |
| Validation | Real, constant-time, never raises. |
| Scanning | Real. Native `BarcodeDetector` — zero bytes of JS library. |
| One-scan guarantee | Real. Per-ticket `SELECT … FOR UPDATE`, proven by a thread-pool concurrency test. |
| Audit | `ScanLog`, append-only, one row per scan reaching a real ticket. |
| Offline | 🚫 Not built — see *Remaining work*. |

### Storage / uploads ✅ 🔑

GCS adapter is real. `core/uploads.py` checks size, then declared type against
an **allow-list**, then the **leading bytes** against that type. SVG is excluded
outright — it is an XML document that can carry script, and serving one from our
own origin is stored XSS.

Signed URLs: implemented (`StoragePort.signed_url`). Not yet used — every stored
asset is currently public by design (posters, performer photos).

### Search ✅

Postgres full-text, real and index-backed. `tsvector` maintained by a **DB
trigger** with weights, GIN indexed, queried with `search_type="websearch"`
(never raises on arbitrary input). Verified with `EXPLAIN ANALYZE`. Never
`ILIKE '%…%'`.

Freshness is transactional — the trigger fires in the same write. Autocomplete
is derived from real matches (`lib/search/suggestions.ts`), not a fabricated
list. Relevance ranking is deliberately deferred (breaks cursor pagination).

### Calendar ✅

Fully real, no vendor. Google via URL, everything else via a generated `.ics`.
Timezone-correct: all times are UTC in the database (`USE_TZ=True`) and `.ics`
emits `Z`-suffixed UTC. A missing `ends_at` uses a two-hour default **and says
so in the calendar body** — a silent guess would put a number in someone's diary
the organizer never stated.

### Maps — superseded

An earlier pass shipped only a `maps.google.com` directions link, on the
grounds that nothing stored coordinates. Both halves of that have changed:
`Event` now has `place_id`/`latitude`/`longitude`, and the full Maps Platform
integration is above.

The plain directions link is **kept deliberately** — it opens the user's own
maps app with their location, live traffic and voice guidance, none of which
an embedded route can do. The in-page map answers "where is it"; the link
answers "take me there".

### Email / SMS 🔑

Real vendor-neutral HTTP adapters exist. SMS carries India DLT entity and
per-message template ids. Every message type is wired:

| Message | Channel | Trigger |
| --- | --- | --- |
| Welcome | Email | `USER_REGISTERED` |
| Ticket delivery (with QR) | Email | `BOOKING_CONFIRMED` |
| Booking confirmation | SMS | `BOOKING_CONFIRMED` |
| Refund confirmation | Email + SMS | `PAYMENT_REFUNDED` |
| Event reminder | Email + **Push** | scheduled from `EVENT_PUBLISHED` |
| Payout released | Email | `PAYOUT_RELEASED` |
| OTP | SMS | template ready; **no OTP flow exists** — see *Remaining work* |

Exactly-once is a unique `dedupe_key` plus claim-before-send under a row lock,
with retry, exponential backoff and dead-lettering. Proven by a concurrency
test.

**Organizer approval / performer approval emails are not wired.** The moderation
services emit no notification. See *Remaining work*.

### Web Push ✅ 🔑 *(new — replaces the one outright fake)*

Complete: `PushPort` → `WebPushAdapter` (pywebpush), `PushSubscription` model,
three endpoints, a service worker served from `app/sw.js/route.ts`, and delivery
through the same exactly-once ledger as email and SMS.

**No vendor.** Web Push is a W3C/IETF standard: the browser names its own push
service (FCM, Mozilla autopush, Apple), the payload is encrypted to keys the
browser generated, and the sender authenticates with **VAPID keys you generate
yourself**. That is why this could be finished in this pass while Google
sign-in could not.

```bash
python manage.py generate_vapid_keys --env   # needs: pip install -e ".[push]"
```

Behaviour when unconfigured (the default) is the point of the whole exercise:
`push_port()` returns `DisabledPushAdapter`, `GET /push/config` reports
`enabled: false`, `POST /me/push/subscriptions` **refuses with 422**, and the UI
renders nothing rather than asking for a browser permission it cannot honour.

Details worth knowing:

- The frontend asks the **server** whether push works *before* touching the
  browser. Asking for permission first is what produced the original fake.
- `recipient` on a push notification is a **user id**, not a device. One person
  with a laptop and a phone gets one reminder that fans out.
- A push service reporting **404/410 deletes the row** — expired subscriptions
  are normal at any scale, not errors to retry.
- One live device is enough for success: an old laptop expiring must not
  dead-letter a reminder the phone already showed.
- `POST /push/rotate` is unauthenticated because a service worker has no token.
  Safe because it can only **UPDATE an existing row**, never create one and
  never change its owner, and an unknown endpoint is an indistinguishable 204.

### Observability ✅ 🔑 *(seam new)*

Structured JSON logging with a per-request correlation id was already real.
Added: Sentry behind `SENTRY_DSN` — unset means the SDK is never imported.
`send_default_pii=False`, headers matching `authorization|cookie|token|secret|
signature|x-razorpay|idempotency-key|qr` redacted, request bodies dropped
wholesale (a booking payload is nested and vendor shapes change without
warning, so key-matching would eventually miss one).

Audit logging is real (`core.audit`, `AuditLog`), and the activity feed IS the
outbox — complete and ordered by construction, needing no second pipeline.

### Analytics ✅ — only what is real

No third-party analytics SDK. Every number on every dashboard is a `COUNT`,
`SUM` or `GROUP BY` over rows the platform owns, computed **in Postgres**.

Deliberately absent, each named in the UI where somebody would look for it:
profile views, conversion, CTR, impressions, peer comparison, ratings,
"interested" counts, booked percentage, distance, chargebacks, latency charts.
Counts from cursor-paginated lists render as floors (*"24+ events"*), never as
totals nobody computed.

### SEO ✅

Real: per-route metadata, canonical URLs, OpenGraph, JSON-LD, `sitemap.ts`,
`robots.ts`, ISR aligned to the backend's `s-maxage`. The `localhost` fallback
that would have poisoned all of it is now a build failure.

### Security ✅

| Control | State |
| --- | --- |
| Secrets | Env only. **Preflight refuses to boot on a shipped placeholder.** |
| JWT | HS256, 15-min access / 30-day refresh, blacklist on logout, ≥32-byte key enforced |
| CSRF | API is Bearer-token — no cookie authorises it. `CSRF_TRUSTED_ORIGINS` for `/admin/`. |
| CORS | Explicit allow-list. `CORS_ALLOW_ALL_ORIGINS` refused in production. |
| Rate limits | New, real, shared-store, fail-open |
| Upload validation | Size → allow-list → magic bytes. SVG excluded. |
| Webhook validation | Constant-time HMAC over the raw body, before any DB access |
| Transport | HSTS + preload, SSL redirect, nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` |
| Oversell / double-admit | Row locks + DB `CheckConstraint`, both proven by thread-pool tests |
| OAuth state | 🚫 n/a — OAuth is not built |

---

## 2. Every placeholder remaining

**There are no fake implementations left.** Each item below is *absent*, and the
UI says so where a user could otherwise assume otherwise.

| # | Capability | What exists today | Where the seam is |
| --- | --- | --- | --- |
| P1 | Google sign-in | Button built; fails instantly with a plain sentence naming the provider. Never a spinner, never a false success. | `NEXT_PUBLIC_OAUTH_BASE_URL`; `components/auth/auth-panel.tsx` |
| P2 | Apple sign-in | Same | Same |
| P3 | Phone / OTP sign-in | Button built and refuses; SMS template + `otp` throttle scope already exist | `NEXT_PUBLIC_PHONE_AUTH_ENABLED` |
| P4 | Password reset | **No UI at all** — deliberately, rather than a dead "Forgot password?" link | `apps/accounts` |
| P5 | Email verification | ✅ **Built** — `EmailVerification`, `EmailVerificationService`, `POST /auth/verify-email` + `/resend`. Registration issues no session; verifying is the sign-in. Backend complete and tested; the frontend screen is still to come. | `apps/accounts` |
| P6 | Device / session management | Not built. Push devices *are* listable. | `apps/accounts` |
| P7 | Organizer + performer approval emails | Moderation works; no email is sent | `apps/organizations`, `apps/performers` handlers |
| P8 | Mobile push (APNs/FCM native) | Web Push covers browsers incl. iOS 16.4+ installed PWAs | `PushPort` |
| P9 | Offline check-in | Scanner needs connectivity | `apps/checkin` |
| P10 | Geocoding / reverse geocoding | Maps links work without it; distance filters were removed rather than faked | `lib/location/use-location.ts` |
| P11 | Signed URLs in use | Implemented in the port, unused — all assets are public by design | `StoragePort.signed_url` |
| P12 | CDN in front of storage | Cache headers correct; no CDN configured | Infra, `S3_PUBLIC_BASE_URL` |

Frontend product gaps (ratings, availability calendars, saved-view sharing, …)
are **not integration gaps** and live in `frontend/BACKLOG.md`, items 1–78.

---

## 3. Every credential still required

### Required before production — the deploy refuses without them

| Variable | Where to get it | Consumed by |
| --- | --- | --- |
| `SECRET_KEY` | `python -c "import secrets;print(secrets.token_urlsafe(64))"` | Django core |
| `JWT_SIGNING_KEY` | Same. **≥32 bytes** | `apps.accounts` |
| `TICKET_QR_SIGNING_KEY` | Same. **≥32 bytes**. Rotating invalidates every issued QR. | `apps.booking` (mint), `apps.checkin` (verify) |
| `DATABASE_URL` | Supabase → Project Settings → Database → **Supavisor transaction** mode, port 6543 | Django ORM |
| `DIRECT_DATABASE_URL` | Supabase → same screen → **Supavisor session** mode, port 5432 (NOT `db.<ref>.supabase.co`, which is IPv6-only) | Migrations, admin, pytest |
| `REDIS_URL` | Upstash → database → `rediss://` URL. Drop `?ssl_cert_reqs=none` (that is only for the local self-signed cert). | `CachePort`, throttles |
| `ALLOWED_HOSTS` | Your domains | Django |
| `CORS_ALLOWED_ORIGINS` | Frontend origin(s) | django-cors-headers |

### Payments — Razorpay

| Variable | Where to get it |
| --- | --- |
| `RAZORPAY_KEY_ID` | Dashboard → Settings → API Keys → Generate |
| `RAZORPAY_KEY_SECRET` | Shown **once** at generation |
| `RAZORPAY_WEBHOOK_SECRET` | Dashboard → Settings → Webhooks → Add. You choose this value. |
| `RAZORPAY_ROUTE_ENABLED` | Route must be enabled on the account (Razorpay support) |

Consumed by `core/adapters/razorpay/adapter.py` via `payment_port()`.
Business decision required: **`PLATFORM_FEE_PER_TICKET`** (minor units).

### Email

| Variable | Where to get it |
| --- | --- |
| `EMAIL_API_KEY` | Postmark → Server → API Tokens · SendGrid → Settings → API Keys · SES → IAM |
| `EMAIL_FROM` | A **verified** sender on that provider |
| `EMAIL_API_BASE_URL` | Postmark `https://api.postmarkapp.com` · SendGrid `https://api.sendgrid.com/v3` |

Consumed by `core/adapters/email_provider/adapter.py`.
**Manual step: SPF, DKIM and DMARC on the sending domain**, or ticket emails
land in spam and the customer arrives at a gate with no QR.

### SMS (India DLT)

| Variable | Where to get it |
| --- | --- |
| `SMS_API_KEY` | MSG91 / Twilio / Gupshup console |
| `SMS_SENDER_ID` | 6-character DLT-approved header |
| `SMS_DLT_ENTITY_ID` | Your DLT registration (Jio/Airtel/Vodafone portal) |
| `SMS_DLT_TEMPLATE_ID` | Per-template approval id |
| `NOTIFICATION_SMS_DLT_TEMPLATE_IDS` | `otp=tmpl_a,booking_confirmation_sms=tmpl_b,…` |

**Manual step: DLT registration takes days to weeks.** India approves a distinct
template per message type — start before you need it.

### Google Cloud

| Variable | Where to get it |
| --- | --- |
| `GCP_PROJECT_ID` | Console |
| `GCS_BUCKET_NAME` | Storage → Create bucket |
| `PUBSUB_TOPIC_EVENTS` | Pub/Sub → Create topic |
| `CLOUD_TASKS_QUEUE`, `CLOUD_TASKS_LOCATION` | Cloud Tasks → Create queue |
| `CLOUD_TASKS_TARGET_URL` | **This service's own** `https://<api-host>/internal/tasks/run` |
| `INTERNAL_TASK_SECRET` | You generate: `secrets.token_urlsafe(32)` |
| `CLOUD_TASKS_SERVICE_ACCOUNT` | Optional; enables OIDC |

Use an **attached service account**, never a downloaded key file.
`GOOGLE_APPLICATION_CREDENTIALS` is a local-dev convenience only.

### Web Push — self-generated, no account

| Variable | Where to get it |
| --- | --- |
| `VAPID_PUBLIC_KEY` | `python manage.py generate_vapid_keys --env` |
| `VAPID_PRIVATE_KEY` | Same command |
| `VAPID_CONTACT` | A `mailto:` or https URL you control. **Required** — Firefox rejects tokens without it. |

One pair per environment. Rotating does not invalidate stored subscriptions but
does invalidate pushes to services that cached the old key, so follow a rotation
by letting clients re-subscribe.

### Optional

| Variable | Where to get it | Absent means |
| --- | --- | --- |
| `SENTRY_DSN` | Sentry → Project → Client Keys | Errors logged, not alerted |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.0`–`1.0` | No tracing |
| `NUM_PROXIES` | Your topology (CDN + LB = 2) | IP-keyed limits may key on the proxy |
| `CSRF_TRUSTED_ORIGINS` | Admin origin | Admin form posts rejected |

### Not yet consumed by any code

`GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` are in `.env.example` but
**nothing reads them** — Google sign-in is not built (P1). Setting them changes
nothing.

---

## 4. Every webhook still required

| Webhook | Direction | State |
| --- | --- | --- |
| **Razorpay → us** | inbound | ✅ Real. `POST /api/v1/payments/webhook` |

Configure at Dashboard → Settings → Webhooks:

- **URL** `https://<api-host>/api/v1/payments/webhook`
- **Secret** = `RAZORPAY_WEBHOOK_SECRET`
- **Events** `payment.captured`, `payment.failed`, `refund.processed`
- Signature verified over the **raw** body before anything touches the database.

No other inbound webhook exists or is needed. Email/SMS delivery-status webhooks
would need a `provider_ref` lookup endpoint — not built.

---

## 5. Every callback URL

| URL | Purpose | State |
| --- | --- | --- |
| `https://<api-host>/api/v1/payments/webhook` | Razorpay server-to-server | ✅ Required |
| `https://<api-host>/internal/tasks/run` | Cloud Tasks delivery | ✅ Required with `QUEUE_BACKEND=cloud_tasks`. **Block at the edge** except from the queue. |
| `https://<api-host>/health/` | Liveness/readiness | ✅ Probes DB + cache for real |
| `https://<site-host>/sw.js` | Service worker (root scope) | ✅ Served by a route handler |
| `https://<api-host>/api/v1/push/rotate` | Called by the service worker | ✅ Unauthenticated by necessity; see §1 |
| `https://<api-host>/auth/google/callback` | OAuth redirect | 🚫 Would be needed for P1. Not built. |

The browser's Razorpay success callback is **not** a callback URL and is
**never** treated as proof of payment — the funnel polls the booking until the
signed webhook marks it `paid`.

---

## 6. Every API key · 7. Every OAuth secret · 8. Every SDK

**API keys:** `RAZORPAY_KEY_ID`/`_SECRET`/`_WEBHOOK_SECRET`, `EMAIL_API_KEY`,
`SMS_API_KEY`, `SENTRY_DSN`, `INTERNAL_TASK_SECRET` (self-generated), VAPID pair
(self-generated). GCP uses an attached service account, not a key.

Client-safe and intentionally public: `NEXT_PUBLIC_RAZORPAY_KEY_ID`,
`VAPID_PUBLIC_KEY`.

**OAuth secrets:** none in use. `GOOGLE_OAUTH_CLIENT_SECRET` is declared and
unread. Apple would additionally need a Services ID, a Key ID, a Team ID and a
`.p8` private key, because Apple requires a **client secret JWT you sign
yourself and rotate at most every 6 months** — that rotation is why it is a
larger job than Google.

**SDKs:**

| SDK | Extra | When needed |
| --- | --- | --- |
| `razorpay` | `[razorpay]` | `PAYMENTS_BACKEND=razorpay` |
| `google-cloud-storage`, `-pubsub`, `-tasks` | `[gcp]` | those backends |
| `pywebpush`, `cryptography` | `[push]` | Web Push |
| `sentry-sdk` | `[observability]` | `SENTRY_DSN` set |

Frontend third-party JS: **one**, Razorpay Checkout, lazy-loaded only when the
user presses Pay. No analytics, maps, or QR library ships — QR scanning uses the
browser's native `BarcodeDetector`.

---

## 9. Every environment variable

Full annotated lists: **`.env.example`** (backend, ~70 vars) and
**`frontend/.env.local.example`** (5 vars). Both are current as of this audit.

Frontend, in full — the only client-side surface:

| Variable | Required | Note |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | **Yes** | `next build` **fails** without it |
| `NEXT_PUBLIC_SITE_URL` | **Yes** | `next build` **fails** without it |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | No | `POST /bookings` returns the authoritative key; this is a hard-refresh fallback |
| `NEXT_PUBLIC_OAUTH_BASE_URL` | No | Turns on P1/P2 buttons — **only set it once the backend exists** |
| `NEXT_PUBLIC_PHONE_AUTH_ENABLED` | No | Same for P3 |

No VAPID key on the frontend: it comes from `GET /api/v1/push/config`, so it
lives in one place and cannot drift.

---

## 10. Every remaining manual step before production

**`DEPLOYMENT.md` is the ordered runbook** — provision, configure, vendors,
migrate, frontend, verify, with the reason each step exists. This section is the
summary of it.

### The deploy gate

`core/preflight.py` runs at import in `prod.py`/`staging.py`. It **raises** —
because a process that boots on the fake payment adapter looks healthy to a
rollout controller, which will then replace the working instances with it.

It refuses on: a shipped placeholder secret, a signing key under 32 bytes,
`DEBUG=True`, empty `ALLOWED_HOSTS`, `CORS_ALLOW_ALL_ORIGINS`, `ENABLE_SILK`
(the profiler records request bodies — passwords, payment payloads — and serves
them unauthenticated), any fake adapter, a real adapter missing its credentials,
**a selected backend whose SDK is not installed**, **a configured credential
whose library is missing**, and **a localhost or plain-`http` public URL**. It
warns on absent Sentry and VAPID, on `NUM_PROXIES=0`, on empty
`CSRF_TRUSTED_ORIGINS`, and on Gmail as the relay. Staging treats fake adapters
as warnings (running the funnel without moving money is what staging is for) and
skips the public-URL checks (internal hostnames are legitimate there), but keeps
every secret check fatal.

All problems are reported **at once** — learning about them one deploy at a time
is a slow way to discover there were four.

### The development gate

`check_development_settings` runs at import in `dev.py` and refuses dev settings
pointed at production resources: a **non-local database**, or a **live Razorpay
key**. `DEBUG=True` and `CORS_ALLOW_ALL_ORIGINS=True` are correct for
development and catastrophic over real data, and neither is an error on its own
— which is why nothing reported the pair until this existed. A real SMTP relay
or SMS provider warns rather than refuses: a real email to a real person is
recoverable, and blocking a developer over it is not proportionate.

### The test gate

`config/settings/test.py` refuses a non-local database host, because pytest
**creates and drops** `test_<dbname>`. Override only with
`ALLOW_REMOTE_TEST_DATABASE=1`, and only for a database that is genuinely
disposable.

### Checklist

**Infrastructure**

1. Supabase project (ap-south-1 for India); both `DATABASE_URL` (Supavisor
   transaction, 6543) and `DIRECT_DATABASE_URL` (Supavisor session, 5432).
   The pooler username is `postgres.<project-ref>`, not `postgres`.
2. Upstash Redis; `rediss://` **without** `?ssl_cert_reqs=none`.
3. Object storage: `STORAGE_BACKEND=s3` plus the five `S3_*` variables.
   Supabase Storage, Cloudflare R2, Backblaze B2 and AWS S3 are all the same
   adapter. `local` is refused in production — uploads would go to the
   container filesystem and vanish on the next deploy. Set
   `NEXT_PUBLIC_MEDIA_BASE_URL` to the same host, or `next/image` refuses every
   poster.
4. Cloud Tasks queue; set `CLOUD_TASKS_TARGET_URL` to this service's own
   `/internal/tasks/run`; require OIDC on Cloud Run.
5. Pub/Sub topic + subscription (subscriptions are infrastructure, not runtime
   code).
6. **Run the scheduler** — `run_scheduled_jobs --once` on a Cloud Scheduler /
   CronJob / crontab tick. *Skipping this is the single most damaging omission
   available: inventory leaks and organizers are never paid, with no error.*
7. **Run the outbox worker** — `python -m config.worker`.
8. Set `NUM_PROXIES` to the real hop count.
9. Block `/internal/*` at the edge except from the queue's egress.

**Vendors**

10. Razorpay: live keys, webhook + secret, enable Route.
11. Email: verified sender, **SPF + DKIM + DMARC**.
12. SMS: **DLT registration** (starts weeks ahead), sender id, per-type
    templates.
13. Push: `generate_vapid_keys`, set all three, install `[push]`.
14. Sentry (optional): DSN, `[observability]`, and set `SENTRY_RELEASE` per
    deploy so a stack trace maps to a commit.

**Application**

15. `docker compose -f docker-compose.yml --profile migrate run --rm migrate`.
    This runs `manage.py migrate_safe`, which uses `DIRECT_DATABASE_URL`
    (session mode), prints the plan first, requires confirmation, and takes an
    advisory lock so two deploys cannot both migrate. Migrations deliberately
    do **not** run on container start.
16. `python manage.py createsuperuser`.
17. Confirm `manage.py check --deploy` is clean. It overlaps preflight but is
    not a subset — Django checks HSTS, cookie flags and referrer policy, which
    preflight does not.
17b. **Delete or rename `docker-compose.override.yml` on the production host.**
    Compose loads it automatically, and a stray copy points production at
    containers that are not running.
18. Set `PLATFORM_FEE_PER_TICKET`, `SETTLEMENT_REFUND_WINDOW_HOURS`,
    `BOOKING_HOLD_MINUTES`, `CHECKIN_WINDOW_*` — **business decisions, not
    defaults to accept silently.**

**Frontend**

19. Set both required `NEXT_PUBLIC_*` URLs. The build fails otherwise, which is
    the intended behaviour.
20. Serve over **https** — push and service workers require a secure context.
21. Verify `/sw.js` returns `Service-Worker-Allowed: /` and is not cached.

**Legal / operational** (outside this codebase, listed so they are not assumed)

22. Terms, privacy policy, refund policy — the funnel links to them.
23. GST / invoicing.
24. PCI scope: **no card data is ever stored**; only Razorpay reference ids.
25. Data-retention policy for `AuditLog`, `ScanLog`, `NotificationLog`,
    `OutboxEvent` — all grow without bound.

---

## Remaining work, specified

Each entry has the model, endpoint, credential, migration, permission, job and
caching requirement, so none needs re-investigation.

### R1 · Google sign-in (P1)

- **Credential** `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` — Cloud Console →
  Credentials → OAuth client ID → Web application.
- **Callback** `https://<api-host>/auth/google/callback`, registered as an
  Authorized redirect URI.
- **Model** `SocialAccount(user FK, provider, provider_uid, email, created_at)`,
  unique `(provider, provider_uid)`.
- **Endpoints** `GET /auth/oauth/google/start` (issues **and stores** a `state`
  nonce), `GET /auth/oauth/google/callback` (verifies `state`, exchanges the
  code, verifies the `id_token` signature against Google's JWKS, links or
  creates a user, issues our own tokens).
- **Migration** one, for `SocialAccount`.
- **Permission** `AllowAny`; `AuthThrottle` on both.
- **Job** none. **Cache** JWKS for 24h — do not fetch per sign-in.
- **Security** `state` is mandatory (CSRF on the callback) and must be
  single-use, stored in Redis with a short TTL. **Never trust an email claim
  without `email_verified`** — otherwise a Google account with an unverified
  address takes over an existing password account.

### R2 · Apple sign-in (P2)

As R1, plus: Services ID, Key ID, Team ID and a `.p8` key, because the client
secret is **a JWT you sign yourself**, valid ≤6 months — so it needs generation
at request time and a rotation runbook. Apple returns the user's name **only on
the first authorization**; not persisting it there means never getting it.

### R3 · Phone / OTP sign-in (P3)

- **Model** `PhoneChallenge(phone, code_hash, expires_at, attempts, consumed_at)`.
  **Store a hash, never the code** — this table is a credential store.
- **Endpoints** `POST /auth/otp/request`, `POST /auth/otp/verify`.
- **Throttle** the `otp` scope already exists. Also key on the **destination
  number**, or one number can be flooded from many IPs.
- **Job** none — `NotificationService.notify(OTP, delay_seconds=0)` is wired.
- **Rules** ≤5 attempts, 5-minute expiry, single-use, constant-time comparison.
- Enable with `NEXT_PUBLIC_PHONE_AUTH_ENABLED=1`; no component changes.

### R4 · Password reset (P4)

- **Model** `PasswordResetToken(user, token_hash, expires_at, used_at)`.
- **Endpoints** `POST /auth/password/reset/request`, `POST /auth/password/reset/confirm`.
- **Notification** a new email type + template.
- **Rules** request always returns 204 (never reveal whether an address is
  registered), 1-hour expiry, single-use, and **invalidate every refresh token
  on success** — a reset exists because the account may be compromised.

### R5 · Email verification (P5)

`EmailVerificationToken`, `POST /auth/email/verify/request` + `/confirm`,
`User.email_verified_at`. Decide the **business rule**: does an unverified user
get to buy a ticket? Today everyone can, and no badge claims otherwise.

### R6 · Session / device management (P6)

`UserSession(user, refresh_jti, user_agent, ip, created_at, last_seen_at)`,
`GET /me/sessions`, `DELETE /me/sessions/{id}` (blacklists that `jti`).
`AuthService.issue_tokens` is the single write point. Push devices are already
listable at `GET /me/push/subscriptions`.

### R7 · Approval notifications (P7)

No model or migration. Two notification types, two templates, and a `notify`
call in the existing moderation services. `PAYOUT_RELEASED` is the pattern to
copy. Small, and currently an organizer learns their event was rejected only by
looking.

### R8 · Native mobile push (P8)

Only worth doing when native apps exist. Web Push already covers browsers,
including installed PWAs on iOS 16.4+. Would need `PushSubscription.platform`
plus FCM/APNs adapters behind the existing `PushPort`.

### R9 · Offline check-in (P9)

The hard part is **not** caching: it is that a ticket admits exactly once, and
offline scanning cannot guarantee that. Honest design: verify the QR **signature**
offline (already possible — pure HMAC, no DB), queue the admission, and mark
those scans *provisional* in the UI. Needs `ScanLog.synced_at`, a bulk
`POST /checkin/sync`, and a **documented reconciliation rule for a ticket
scanned twice at two offline gates**. Do not ship this without deciding who
wins.

### R10 · Geocoding (P10)

`Event.latitude/longitude`, `Venue` as a real entity, a geocode-on-write job,
a Places API key, and PostGIS or a bounding-box query for distance filters.
Unlocks the distance filter and a real map embed. Nothing today fakes it.

---

## Test coverage for everything in this pass

| Area | Tests |
| --- | --- |
| Preflight deploy gate | 24 |
| Task dispatch endpoint | 12 |
| Scheduler | 12 |
| Rate limiting + `Retry-After` | 16 |
| Web Push (backend) | 28 |
| VAPID key conversion (frontend) | 4 |
| **Backend total** | **777 passing** |
| **Frontend total** | **141 passing** |
| **Live end-to-end verification** | **20 checks, all passing** |

One known artifact: `apps/cms::test_a_fresh_platform_ships_seeded_copy_and_categories`
fails under `--reuse-db` and passes under `--create-db` (verified). It is a
fixture-reuse artifact, not a regression.

Note for running the suite in this repo's container: it sets
`DJANGO_SETTINGS_MODULE=config.settings.dev`, which **overrides pytest's ini**
and routes tests through PgBouncer, and `.env`'s `DIRECT_DATABASE_URL` points at
`localhost:5432` (correct from the host, unreachable from inside the container).
Both need overriding:

```bash
docker compose exec -T \
  -e DJANGO_SETTINGS_MODULE=config.settings.test \
  -e DIRECT_DATABASE_URL=postgres://app:app@postgres:5432/eventsdb \
  backend pytest -q
```
