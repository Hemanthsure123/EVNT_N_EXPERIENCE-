# Deployment runbook

> **Which deployment document?** `DEPLOY_EC2.md` is the authoritative runbook
> for the **AWS EC2 production** deployment (Caddy, Supabase, Upstash).
> `DEPLOYMENT.md` explains the rules that apply to every target;
> `DEPLOY_ORACLE.md` is the single-box Oracle topology and
> `DEPLOY_RENDER_VERCEL.md` the short-lived Render/Vercel test topology. Do not
> mix instructions between them — they use different databases and different
> compose files.

How to take Eventful from a checkout to serving real customers, in order, with
the reason each step exists and what to do when one fails.

**Deployment is a configuration exercise, not a development exercise.** No step
below edits source. If you find yourself changing code to deploy, that is a bug
in this repository — open an issue rather than patching around it.

| Document | Answers |
| --- | --- |
| **DEPLOYMENT.md** (this) | How do I get it deployed, and how do I undo it? |
| [OPERATIONS.md](OPERATIONS.md) | It is deployed — how do I run it day to day? |
| [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) | Terse sign-off sheet before go-live. |
| [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) | What is every variable, and who reads it? |
| [REAL_INTEGRATIONS_AUDIT.md](REAL_INTEGRATIONS_AUDIT.md) | What is each credential and where do I obtain it? |

---

## 1. Prerequisites

### On the deploy host

| Requirement | Why |
| --- | --- |
| Docker Engine 24+ with Compose v2 | The `profiles:` key and `docker compose` (not `docker-compose`) are both v2. |
| 2 vCPU / 4 GB RAM minimum | Three processes plus headroom. Worker count is bounded by the database pooler, not the CPU — see `WEB_CONCURRENCY`. |
| Outbound HTTPS (443) | Supabase, Upstash, Razorpay, Google, SMTP, Sentry. |
| Outbound 6543 and 5432 | Supabase Supavisor: transaction mode and session mode. |
| A way to reach the host over TLS | Cloudflare Tunnel, a load balancer, or a reverse proxy. The app assumes TLS terminates in front of it (`SECURE_PROXY_SSL_HEADER`). |

### Accounts to open before you start

Each takes minutes except the last two, which take weeks and must start early.

- **Supabase** — project in your users' region (`ap-south-1` for India).
- **Upstash** — Redis database in the same region.
- **Object storage** — Supabase Storage, Cloudflare R2, Backblaze B2 or AWS S3.
- **Razorpay** — live keys, and **Route enabled** on the account.
- **SMTP** — a domain you control with SPF, DKIM and DMARC.
- **Google Cloud** — one project, one API key, one OAuth client.
- **Sentry** — two projects (backend and frontend), optional.
- **DLT registration (India, SMS)** — **weeks**. Start now if SMS matters.
- **Google OAuth verification** — **weeks** if you need more than 100 users on
  the consent screen.

### What you do NOT need

No Kubernetes, no service mesh, no Cloud Tasks, no Pub/Sub. `QUEUE_BACKEND=local`
plus the deployed `worker` process is a complete, supported topology. The cloud
queue exists for cross-service dispatch you do not have yet.

---

## 2. The three environments

One codebase, three configurations, **zero code differences**.

| | Development | Staging | Production |
| --- | --- | --- | --- |
| Command | `docker compose up -d` | `docker compose -f docker-compose.yml up -d` | `docker compose -f docker-compose.yml up -d` |
| Compose files | `docker-compose.yml` + `docker-compose.override.yml` (auto-loaded) | `docker-compose.yml` only | `docker-compose.yml` only |
| Env template | `.env.example` | `.env.staging.example` | `.env.production.example` |
| Settings module | `config.settings.dev` | `config.settings.staging` | `config.settings.prod` |
| Gate | `check_development_settings` | `check_production_settings(strict=False)` | `check_production_settings(strict=True)` |
| Database | Postgres container via PgBouncer | Its own Supabase project | Supabase |
| Payments | `fake` | `fake` or `rzp_test_` | `razorpay` live |
| Storage | `local` | own bucket | own bucket |
| Web process | `runserver` | gunicorn | gunicorn |
| Fake adapters | expected | **warning** | **refused** |

**Staging and production use the same compose file.** They differ only by `.env`.
That is deliberate: staging is only predictive if it runs the same topology.

> ### The one thing that must not be on a deployed host
>
> **`docker-compose.override.yml`.** Compose loads it AUTOMATICALLY when the
> file is present, so leaving it on a server points the app at container
> databases while it holds production credentials — reads and writes go to an
> empty Postgres and nothing reports it, because both configurations are
> internally valid.
>
> Deploy by checking out the repository **without** that file, or delete it as
> the first step. As a backstop, `check_production_settings` **refuses to boot**
> when the database or Redis host resolves to a compose service name
> (`postgres`, `pgbouncer`, `redis`, `db`). A manual step is not a guard, so
> there is a guard.

---

## 3. Required cloud resources

### 3.1 Supabase

Create in your users' region. Then Project Settings → Database → Connection string:

```bash
# Runtime. Supavisor TRANSACTION mode, port 6543.
DATABASE_URL=postgresql://postgres.<PROJECT-REF>:<PASSWORD>@aws-1-<REGION>.pooler.supabase.com:6543/postgres?sslmode=require

# Migrations, manage.py, tests. Supavisor SESSION mode, port 5432.
DIRECT_DATABASE_URL=postgresql://postgres.<PROJECT-REF>:<PASSWORD>@aws-1-<REGION>.pooler.supabase.com:5432/postgres?sslmode=require
```

Three things that are easy to get wrong:

- The pooler username is `postgres.<project-ref>`, **not** `postgres`.
- Do **not** use `db.<project-ref>.supabase.co` — IPv6 only, and most container
  hosts have no IPv6 route.
- Two URLs on purpose. DDL through a transaction pooler is unreliable, and
  pytest creates a database the pooler's static list has never heard of.

Then set `CONN_MAX_AGE=0` and `DISABLE_SERVER_SIDE_CURSORS=true`. Both are
required behind a transaction pooler: it manages connection reuse itself, and
server-side cursors need a session affinity it does not provide.

### 3.2 Upstash Redis

```bash
REDIS_URL=rediss://default:<TOKEN>@<ENDPOINT>.upstash.io:6379
CACHE_BACKEND=redis
```

**Drop `?ssl_cert_reqs=none`.** It exists only for the self-signed certificate in
local development; carried into production it disables certificate verification
against a real endpoint. Preflight refuses it.

### 3.3 Object storage

`STORAGE_BACKEND=local` writes uploads to the container filesystem, where they
are lost on the next deploy. Production refuses it.

Use `s3`. One adapter covers Supabase Storage, Cloudflare R2, Backblaze B2,
MinIO and AWS S3 — switching provider is an endpoint change.

1. Create the bucket (public, if you serve straight from it).
2. Create an S3 access key. On Supabase: Storage → S3 Access Keys. This is
   **not** the anon key and **not** the service-role key.
3. Set `S3_PUBLIC_BASE_URL` to the host browsers fetch from — a CDN, ideally.

**The same host must be `NEXT_PUBLIC_MEDIA_BASE_URL` in the frontend**, or
`next/image` refuses every poster: silently, one image at a time, with no build
error and no server log.

### 3.4 Google Cloud — one project, one key, one OAuth client

Enable: Geocoding, Places, Directions, Distance Matrix, Static Maps, Maps
JavaScript, **and Google Calendar**.

**Restrict both keys in the console.** This cannot be verified from the
repository, and an unrestricted key is a billable resource anyone who finds it
can spend.

| Key | Restriction |
| --- | --- |
| `GOOGLE_MAPS_API_KEY` (server) | IP restriction to your egress addresses; API restriction to the five web-service APIs. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (browser, public by design) | HTTP referrer restriction to your domains; API restriction to Maps JavaScript only. |

**Set a budget alert.** Maps bills per request with no ceiling by default.

For Calendar, register `GOOGLE_OAUTH_REDIRECT_URI` **verbatim** as an Authorized
redirect URI. One OAuth client for the whole application — a second means a
second consent screen and a second verification review.

### 3.5 Razorpay

Live keys, and **Route enabled** — without it the organizer share cannot be
transferred on hold, and the platform ends up holding organizer funds.

Register the webhook at `https://api.<YOUR-DOMAIN>/api/v1/payments/webhook` for
`payment.captured` and `payment.failed`. **The signed webhook is the only proof
of payment**; the browser redirect is not, and the code treats it that way.

### 3.6 Putting TLS in front

The app does **not** terminate TLS. It expects something in front to do that
and to forward the original scheme and client IP. Cloudflare Tunnel, an ALB, a
Caddy or nginx reverse proxy all work, and the application needs no code change
for any of them — only three settings.

There is deliberately **no `cloudflared` service in the compose file**: the
choice of edge is a deployment decision, and shipping one vendor's sidecar
would make the other options look unsupported when they are not.

| Setting | Value | If you get it wrong |
| --- | --- | --- |
| `SECURE_PROXY_SSL_HEADER` | Already set in `prod.py` to `HTTP_X_FORWARDED_PROTO` | Django thinks every request is plain HTTP and `SECURE_SSL_REDIRECT` loops. |
| `NUM_PROXIES` | Hops that **prepend** to `X-Forwarded-For`. Tunnel → container = 1. Cloudflare → ALB → container = 2. | At 0, every IP-keyed rate limit becomes one global bucket. |
| `FORWARDED_ALLOW_IPS` | Blank (the private ranges) when the proxy shares the compose network. Set it to the proxy's address otherwise. | `*` lets anything that can reach the container forge `X-Forwarded-Proto: https` and its own source IP. |

Whatever you choose must:

- terminate TLS and forward `X-Forwarded-Proto: https`
- reach the `web` container on `PORT` (8000 by default)
- **not** buffer or rewrite `POST /api/v1/payments/webhook` — the signature is
  verified over the **raw** body, so any middlebox that re-serialises JSON
  breaks payment verification
- allow `GET /health/` unauthenticated, for the container healthcheck

With Cloudflare Tunnel specifically, the tunnel token is a property of the
tunnel rather than of this application, so it is not one of Eventful's
environment variables. Run `cloudflared` alongside the stack (its own compose
file, a host service, or Cloudflare's managed connector) pointing at
`http://web:8000` or `http://127.0.0.1:8000`.

---

## 4. Environment variables

```bash
git clone <repo> && cd EVENT_EXPERIENCE
rm -f docker-compose.override.yml          # see §2
cp .env.production.example .env            # or .env.staging.example
${EDITOR:-vi} .env                          # fill every <PLACEHOLDER>
```

Generate three **distinct** secrets, each ≥ 32 bytes:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"   # x3
```

`SECRET_KEY`, `JWT_SIGNING_KEY`, `TICKET_QR_SIGNING_KEY`. Preflight refuses any
that is short, missing, or still the shipped example — with that QR key, anyone
holding this repository can forge a ticket that passes the gate scanner.

Then set `NUM_PROXIES` to the number of hops that **prepend** to
`X-Forwarded-For`. Cloudflare Tunnel → container is 1. Cloudflare → ALB →
container is 2. At `0`, DRF keys rate limits on the proxy's own address and
`THROTTLE_AUTH=10/min` becomes ten attempts per minute for the entire internet.

Review the business values before launch — each has money attached and none
should be accepted silently: `PLATFORM_FEE_PER_TICKET`,
`SETTLEMENT_REFUND_WINDOW_HOURS`, `BOOKING_HOLD_MINUTES`, `CHECKIN_WINDOW_*`.

[ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) is the full table.

---

## 5. Deployment order

Order matters: each step's failure must be cheap.

```bash
# 1. Build. Nothing external is touched.
docker compose -f docker-compose.yml build

# 2. Validate configuration WITHOUT starting anything. Preflight runs at
#    settings import, so this exercises the whole gate and reports every
#    problem at once.
docker compose -f docker-compose.yml run --rm web python manage.py check --deploy

# 3. Migrate. THE FIRST DESTRUCTIVE STEP — see §6.
docker compose -f docker-compose.yml --profile migrate run --rm migrate

# 4. Start the three processes.
docker compose -f docker-compose.yml up -d

# 5. Confirm all three are up, not just the web one.
docker compose -f docker-compose.yml ps

# 6. First admin user.
docker compose -f docker-compose.yml run --rm web python manage.py createsuperuser
```

Step 2 is the cheap failure. It runs the same gate the real boot runs, so a
missing credential or a localhost URL is caught before anything writes.

### The three processes

| Process | Command | Consequence of it not running |
| --- | --- | --- |
| `web` | gunicorn | No API. Obvious. |
| `scheduler` | `manage.py run_scheduled_jobs` | **Held ticket inventory is never released and organizers are never paid.** No error anywhere — the tasks are registered and simply never fire. |
| `worker` | `python -m config.worker` | An outbox event written but not drained (a crash between COMMIT and the on-commit hook) is stranded forever. Those events send tickets, refunds and reminders. |

The scheduler runs **exactly one replica**. Two double-fire every job; the tasks
are idempotent, so that is survivable rather than correct.

---

## 6. Migration order

**Migrations never run on boot.** That used to happen and it applied unreviewed
schema changes on every deploy while racing itself across replicas. They are a
compose profile, run deliberately:

```bash
docker compose -f docker-compose.yml --profile migrate run --rm migrate
```

`manage.py migrate_safe` does four things `migrate` does not:

1. Uses the `direct` alias (session mode, 5432). DDL through a transaction
   pooler is unreliable.
2. Prints `showmigrations --plan` first, so what is about to be applied is
   visible before it is applied.
3. Requires confirmation, and **refuses a non-interactive production run**
   without `--yes`.
4. Holds a Postgres advisory lock, so two concurrent deploys cannot both migrate.

### For the first migration onto an empty Supabase database

```bash
# Review the plan without applying anything.
docker compose -f docker-compose.yml --profile migrate run --rm migrate \
  python manage.py showmigrations --plan

# Apply.
docker compose -f docker-compose.yml --profile migrate run --rm migrate
```

Roughly 30 migrations across 14 apps, linear, no conflicting leaf nodes. The
`cms` seed migration populates the homepage's default copy; it is
non-destructive and safe to re-run.

### Ordering rule for every subsequent release

**Migrate before deploying code only when the migration is backward
compatible.** Adding a nullable column, a table or an index is. Dropping or
renaming one is not — the running old code still references it.

For a breaking change, use the standard three-deploy expand/contract:

1. **Expand** — add the new column, deploy code that writes both.
2. **Backfill** — a data migration or a management command.
3. **Contract** — deploy code that reads only the new column, then drop the old.

A single deploy that drops a column is an outage for the duration of the rollout.

### Never point the test suite at production

`pytest` **creates and drops** a `test_<dbname>` database. `config/settings/test.py`
refuses any non-local host for exactly this reason. `ALLOW_REMOTE_TEST_DATABASE=1`
is the only override and there is no reason to set it against real bookings.

---

## 7. Rollback strategy

### Rolling back code

Images are tagged; `.env` is unchanged. This is the safe direction.

```bash
docker compose -f docker-compose.yml down
git checkout <previous-tag>
docker compose -f docker-compose.yml up -d --build
```

`stop_grace_period` (40s) exceeds gunicorn's `graceful_timeout` (30s), so
in-flight requests finish rather than being killed — which matters because a
SIGTERM mid-request can land between recording a payment and issuing the ticket.

### Rolling back a migration

**Django can reverse a schema migration; it cannot reverse a data migration that
dropped data.** Decide which you are dealing with before touching anything.

```bash
# What is applied.
docker compose -f docker-compose.yml --profile migrate run --rm migrate \
  python manage.py showmigrations <app>

# Reverse to a specific migration.
docker compose -f docker-compose.yml --profile migrate run --rm migrate \
  python manage.py migrate <app> <previous-migration-number>
```

**Reverse the code first, then the migration** — the reverse of applying. Code
that expects a column must stop running before the column disappears.

If the migration dropped a column, reversing recreates it **empty**. Restore
from a point-in-time backup instead (§8).

### The rollback that is not available

Money already moved. A refund is a forward operation (`POST /payments/{id}/refund`),
never a rollback — see [OPERATIONS.md](OPERATIONS.md).

---

## 8. Backups and recovery

### Before the first production deploy

Confirm Supabase point-in-time recovery is enabled for your plan and note the
retention window. Free-tier daily backups are not a recovery strategy for a
platform holding payments.

```bash
# Manual logical backup — take one immediately before any risky migration.
pg_dump "$DIRECT_DATABASE_URL" -Fc -f eventful-$(date +%Y%m%d-%H%M).dump
```

### Recovery procedures

| Situation | Procedure |
| --- | --- |
| Bad migration, data intact | Reverse the migration (§7). |
| Bad migration, data lost | Supabase PITR to just before it. Everything after that timestamp is lost — reconcile payments against Razorpay's dashboard, which is the external record. |
| Database unreachable | `/health/` returns 503. Check Supabase status, then the pooler connection count (§10). The app fails closed; no data is at risk. |
| Redis unreachable | Caching and rate limiting degrade **open** — the app keeps serving. A shut door at a venue is worse than unmetered requests, and the correctness guards (signature verification, row locks) never depended on Redis. |
| Storage unreachable | Uploads fail; existing images served from the bucket/CDN are unaffected. |
| Secrets leaked | §11. |

**Restore drill.** Restore a backup into a scratch Supabase project and run
`manage.py check --deploy` against it. A backup nobody has restored is a
hypothesis, not a backup.

---

## 9. Health checks and verification

### Health endpoint

`GET /health/` **probes** the database and cache for real and returns 503 when
either is down. It reports `unknown` for payments, storage, queue, event bus,
email and SMS plus which adapter is configured — it does not contact a vendor to
decorate a widget, because a tile that is green because nothing checked it is
the one an operator would trust to page somebody.

The container healthcheck polls it every 30s. Successful probes are filtered out
of the access log; **failing ones are not**, because a 503 there is the line
somebody will be looking for.

### Post-deployment validation

Run in order. Each looks for a specific failure.

```bash
# 1. Up, and dependencies reachable.
curl -fsS https://api.<YOUR-DOMAIN>/health/

# 2. The database is Supabase, not a container. (The guard in §2 makes the
#    wrong answer impossible to boot on, but confirm what you got.)
docker compose -f docker-compose.yml exec web python -c \
  "import django;django.setup();from django.conf import settings;\
print(settings.DATABASES['default']['HOST'])"

# 3. Every selected backend's SDK is present. Lazy imports mean a missing one
#    surfaces on the first checkout, not at boot.
docker compose -f docker-compose.yml exec web python -c \
  "import razorpay, cryptography, pywebpush, boto3; print('ok')"

# 4. All three processes, not just web.
docker compose -f docker-compose.yml ps

# 5. The scheduler is actually ticking.
docker compose -f docker-compose.yml logs --tail=50 scheduler
```

Then in a browser, in this order — each proves something the previous did not:

| Check | Proves |
| --- | --- |
| A public event page renders its poster | Storage credentials **and** `next/image` `remotePatterns` |
| Sign in | CORS, `ALLOWED_HOSTS`, JWT keys |
| Create an event as an organizer | Write path, database, moderation |
| **A real ticket purchase through live Checkout** | The webhook reaches you — the only thing that cannot be verified without a real payment |
| The ticket email arrives | SMTP, SPF/DKIM, the outbox worker |
| Scan the QR at `/checkin` | QR signing key, the check-in path |

Then refund that booking to confirm the refund path and leave no test money in
the settlement.

[PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) is the tickable version.

---

## 10. Troubleshooting

### The container refuses to start

**This is the system working.** Read the message: preflight reports every
problem at once and names the fix for each.

| Message contains | Cause |
| --- | --- |
| `is still the placeholder shipped in .env.example` | A secret was not filled in. |
| `no money would move` | `PAYMENTS_BACKEND=fake` in production. |
| `vanish on the next restart` | `STORAGE_BACKEND=local`. |
| `is not installed. Add the ... extra` | Image built without an extra its backend needs. Rebuild; check `INSTALL_EXTRAS`. |
| `points at localhost` | A public URL was not updated. |
| `docker-compose.override.yml` | That file is on the host. Delete it (§2). |
| `DISABLES TLS certificate verification` | `?ssl_cert_reqs=none` carried over from development. |
| `ENVIRONMENT is ... but the settings module is for ...` | `ENVIRONMENT` and `DJANGO_SETTINGS_MODULE` disagree. Sentry tags every event with the former. |

### It starts but behaves wrongly

| Symptom | Likely cause |
| --- | --- |
| Config changes have no effect | `docker compose restart` does **not** re-read `env_file`. Use `up -d --force-recreate`. |
| Every image is broken, no errors anywhere | `NEXT_PUBLIC_MEDIA_BASE_URL` does not match `S3_PUBLIC_BASE_URL`. `next/image` refuses unlisted hosts. Rebuild the frontend — `NEXT_PUBLIC_*` is baked in at build time, not read at runtime. |
| Payments succeed, no tickets issued | The webhook is not reaching you. Check Razorpay's webhook delivery log; confirm the URL and that `/api/v1/payments/webhook` is not blocked at the edge. |
| Rate limits behave globally | `NUM_PROXIES` is 0 behind a proxy. |
| Google OAuth: `redirect_uri_mismatch` | `GOOGLE_OAUTH_REDIRECT_URI` is not registered **verbatim**. |
| Calendar dies after an hour | Reconnect issued no refresh token. Requires `access_type=offline` **and** `prompt=consent`; the code sets both, so suspect a changed client. |
| Inventory never frees; organizers unpaid | The `scheduler` process is not running. |
| Emails queue but never send | The `worker` process is not running. |
| Database errors under load | Pooler connection limit. `WEB_CONCURRENCY × (workers) + scheduler + worker` must fit inside it. |
| `manage.py` refuses to run | It defaults to `config.settings.dev`, which refuses a remote database. Pass `DJANGO_SETTINGS_MODULE=config.settings.prod`. |

### Reading logs

```bash
docker compose -f docker-compose.yml logs -f web
docker compose -f docker-compose.yml logs -f scheduler worker
```

Application logs are structured JSON with a request id; gunicorn's access line
carries the same id, so one request can be followed across both streams. PII is
scrubbed and tokens are never serialised.

---

## 11. If a secret leaks

In this order:

1. **Rotate at the vendor first**, not in `.env`. A rotated `.env` with a live
   key still at the vendor has changed nothing.
2. `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` — rotate in the dashboard,
   re-register the webhook, redeploy.
3. `JWT_SIGNING_KEY` — rotating **signs out every user**. That is the intended
   effect: existing tokens must stop validating.
4. `TICKET_QR_SIGNING_KEY` — rotating **invalidates every unscanned ticket**.
   Do not rotate during an event. Every issued QR was signed with the old key.
5. `SECRET_KEY` — rotating makes stored Google refresh tokens unreadable
   (`core/encryption.py` derives from it). `decrypt` returns `None` rather than
   raising, so this degrades to "everyone reconnects their calendar" instead of
   "every calendar sync 500s".
6. Database or storage credentials — rotate at Supabase, redeploy, confirm
   `/health/`.

`.gitignore` covers `.env`, `.env.backup*`, `.env.*.bak` and `*.env.backup`. If a
secret reached a commit, rotate it — history rewriting is not a substitute.

---

## 12. CI

`.github/workflows/ci.yml` runs on every push and pull request:

| Step | Catches |
| --- | --- |
| `ruff check` | Lint. |
| `ruff format --check` | Formatting. One formatter, deliberately — black used to be checked here while `ruff format` was installed, and they disagree. |
| `mypy` | Types, with the django-stubs plugin. |
| `makemigrations --check` | A model change with no migration. |
| `pytest --cov` | The full suite. |

CI installs `.[dev,razorpay,push,observability,s3]` — the production extras, not
just `dev`. With `dev` alone every vendor-SDK test **skipped**, and a skip is
indistinguishable from a pass in a green run. Installing them together also
proves the extras still resolve together, which would otherwise first surface at
image build time on a deploy.

Configuration itself is tested, and these are the tests that fail a deploy that
would not work:

- `core/tests/test_deployment_topology.py` — the production compose file sets
  no `environment:` override, runs gunicorn not `runserver`, does not migrate on
  boot, deploys a scheduler and a worker, mounts no source, and installs the
  extras its backends select. Parses the files; needs no Docker daemon.
- `core/tests/test_env_contract.py` — every variable the code reads is declared,
  every active declaration is read, `.env` and `.env.example` agree, nothing is
  declared twice, no backend secret is in the client bundle, everything is
  documented.
- `core/tests/test_env_templates.py` — all four templates declare the same
  variables, contain no real credentials, never point production at localhost,
  select no fake adapter, and declare every credential preflight requires.
- `core/tests/test_preflight.py` — the gate itself, both directions.

**Keep `INSTALL_EXTRAS` in `backend/Dockerfile` and the CI install line in
step.** A test fails if they drift.

---

## 13. Frontend

```bash
cd frontend
cp .env.production.example .env.local
${EDITOR:-vi} .env.local
npm ci && npm run build
```

`next build` **fails** without `NEXT_PUBLIC_API_BASE_URL` and
`NEXT_PUBLIC_SITE_URL` in production. That is intended: a build with them unset
emits a sitemap, canonical tags and OpenGraph URLs pointing at `localhost:3000`,
which search engines index exactly as written.

**`NEXT_PUBLIC_*` values are baked in at build time.** Changing one requires a
rebuild, not a restart — a container started with a corrected value still serves
the old one, because the old one is a string literal inside the compiled
JavaScript.

Serve over HTTPS: service workers and push require a secure context. Confirm
`/sw.js` returns `Service-Worker-Allowed: /` and is not cached.

---

## 14. What each guard refuses

| Guard | Runs | Refuses |
| --- | --- | --- |
| `check_production_settings` | `prod.py`, `staging.py` import | placeholder or short secrets · `DEBUG=True` · empty `ALLOWED_HOSTS` · `CORS_ALLOW_ALL_ORIGINS` · `ENABLE_SILK` · any fake adapter · a real adapter missing credentials · a selected backend whose SDK is absent · a localhost or `http://` public URL · a compose-service database or Redis host · `ssl_cert_reqs=none` · an `ENVIRONMENT` that disagrees with the settings module |
| `check_development_settings` | `dev.py` import | dev settings against a **non-local database** · a **live Razorpay key** |
| `_refuse_non_local_database` | `test.py` import | pytest against a non-local database |
| `migrate_safe` | manual | an unreviewed migration · a non-interactive production run without `--yes` · a concurrent migration |
| `manage.py check --deploy` | manual, CI | Django's own security checks |
| CI config tests | every push | compose overrides, missing processes, template drift, env drift |

The pattern throughout: **refuse rather than pretend.** A fake adapter, a
missing SDK and a real integration all satisfy the same interface, so a process
running on any of them boots, serves traffic and reports itself healthy. The
only difference is whether anything actually happens.
