# Deploying to Render + Vercel

> **Which deployment document?** `DEPLOY_EC2.md` is the authoritative runbook
> for the **AWS EC2 production** deployment (Caddy, Supabase, Upstash).
> `DEPLOYMENT.md` explains the rules that apply to every target;
> `DEPLOY_ORACLE.md` is the single-box Oracle topology and
> `DEPLOY_RENDER_VERCEL.md` the short-lived Render/Vercel test topology. Do not
> mix instructions between them — they use different databases and different
> compose files.

The 10-to-14-day test topology: **backend on Render** (Docker), **frontend on
Vercel**, **CI/CD from GitHub**. Written against this repository's actual
architecture, not a generic tutorial.

| Document | Answers |
| --- | --- |
| **DEPLOY_RENDER_VERCEL.md** (this) | How do I get the test environment up, and how does a push deploy it? |
| [DEPLOYMENT.md](DEPLOYMENT.md) | The self-hosted Docker Compose runbook, and the reasoning every host inherits. |
| [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) | What is every variable, and who reads it? |
| [REAL_INTEGRATIONS_AUDIT.md](REAL_INTEGRATIONS_AUDIT.md) | What is each credential and where do I obtain it? |
| [OPERATIONS.md](OPERATIONS.md) | It is deployed — how do I run it? |

---

## 0. The five things about this codebase that decide the deployment

Read these before touching a dashboard. Each one is a decision the
architecture has already made for you, and each is a way the deployment fails
**silently** if ignored.

### 1. It is three processes, not one

```
web        gunicorn                     HTTP
worker     python -m config.worker      drains the outbox
scheduler  run_scheduled_jobs --once    the clock
```

Deploy only `web` and the application will look perfectly healthy while:

- **held ticket inventory is never released** — a customer who abandons a
  checkout locks those seats until the heat death of the universe;
- **organisers are never paid** — `settlements.release_due` never fires;
- **no email, SMS or push is ever delivered** — they are written to the outbox
  and sit there;
- **a captured payment whose browser callback never arrived is never
  reconciled** — the customer is charged and gets no ticket.

Nothing errors. `core/tests/test_deployment_topology.py` asserts every job in
`SCHEDULE` has a process that can run it, which is why this is stated first.

### 2. Production refuses to boot on a placeholder

`core/preflight.py` runs from `config/settings/prod.py` and **raises** rather
than warns. A fake adapter and a real one satisfy the same interface, so
without this the app boots healthy and does nothing:
`PAYMENTS_BACKEND=fake` in production means every checkout succeeds for free.

**Expect your first deploy to fail, and read the message.** It names the exact
variable and the exact consequence. That is the system working.

It also refuses a *selected backend whose SDK is missing* and a *configured
credential whose library is missing*. The image's `INSTALL_EXTRAS` build arg
already defaults to `razorpay,push,observability,s3`, so Render needs no build
argument — but if you ever trim it, preflight is what catches you.

### 3. Two database URLs, and they are not interchangeable

| Variable | Port | Mode | Used by |
| --- | --- | --- | --- |
| `DATABASE_URL` | 6543 | Supavisor **transaction** pooler | all app traffic |
| `DIRECT_DATABASE_URL` | 5432 | **session** | migrations, admin tooling |

Migrations need session mode because they take advisory locks. App traffic
needs the pooler because 3 services × N workers each hold their own
connections. `CONN_MAX_AGE=0` and `DISABLE_SERVER_SIDE_CURSORS=true` are both
required behind the pooler and are set in the blueprint.

### 4. `NEXT_PUBLIC_*` is baked into the JavaScript at build time

Changing `NEXT_PUBLIC_API_BASE_URL` in the Vercel dashboard **does nothing to
a deployment that already exists.** The value is inlined into the bundle; you
must redeploy. This is the single most common Vercel confusion and it presents
as "I changed the URL and it still calls the old one".

Two specific consequences here:

- `NEXT_PUBLIC_MEDIA_BASE_URL` must match the host actually serving your S3
  objects, or `next/image` refuses **every poster** — silently, one image at a
  time, with no console error.
- Vercel **preview** deployments get a new random hostname per commit. Those
  origins are not in `CORS_ALLOWED_ORIGINS`, so every API call from a preview
  is blocked by the browser while the server logs nothing wrong. See §6.

### 5. Free-tier spin-down is survivable here, and that is not luck

A free Render web service sleeps after 15 minutes; the next request pays a
30–60 second cold start. For most applications that breaks payment webhooks.
It does not break this one, because the money path was built for exactly this:

- Razorpay **retries** any non-2xx or timed-out webhook;
- `payments.reconcile_pending` runs every 120s and asks the provider about
  every booking holding an unresolved order id — it needs no inbound
  connectivity at all;
- a capture found while the hold is alive is ticketed; one found after the
  sweeper released the seats is **refunded**.

So a slept service costs latency, not money or tickets — *provided the
scheduler is running*. Which is point 1 again.

---

## 1. What it costs

| Service | Plan | Why | Cost |
| --- | --- | --- | --- |
| `curatix-api` (web) | Starter | Free sleeps; 30–60s cold starts make a two-week test hard to read | $7/mo |
| `curatix-worker` | Starter | Must be always-on to drain the outbox | $7/mo |
| `curatix-scheduler` | Cron | Per-minute billing, seconds per run | ~$1–2/mo |
| Supabase | Free | Postgres + storage | $0 |
| Upstash Redis | Free | 10k commands/day covers a test | $0 |
| Vercel | Hobby | Next.js frontend | $0 |
| **Total** | | | **≈ $15–16/mo** |

**The one saving worth taking:** run `web` on Free ($0) and accept cold
starts — the architecture tolerates them (§0.5). That is ≈$8–9/mo total.

**The one saving NOT worth taking:** dropping the worker or the scheduler. See
§0.1.

---

## 2. Before you open a dashboard

Accounts, in the order you will need them:

1. **Supabase** — project in `ap-south-1` (Mumbai) if your users are in India.
   Copy both connection strings (pooled 6543 **and** direct 5432).
2. **Upstash** — Redis in the same region. Copy the `rediss://` URL.
   Drop any `?ssl_cert_reqs=none` — that is local-dev-only, for a self-signed
   certificate. Upstash's is CA-signed.
3. **Object storage** — Supabase Storage (S3-compatible), R2, B2 or S3. You
   need bucket, endpoint, key id, secret.
   **Its MIME allow-list must accept exactly `core.uploads.ALLOWED_IMAGE_TYPES`**
   or uploads 415 with `InvalidMimeType`.
4. **Razorpay** — test keys are enough for a test deployment. Route enabled if
   you want organiser payouts to move.
5. **SMTP** — any provider on a domain you control with SPF/DKIM.
6. **Sentry** — optional but nearly free and worth it for a two-week test.

Not needed: Kubernetes, Cloud Tasks, Pub/Sub. `QUEUE_BACKEND=local` plus the
deployed worker is a complete, supported topology.

---

## 3. Backend on Render — step by step

### 3.1 Apply the blueprint

1. Push `render.yaml` (in the repo root) to your default branch.
2. Render Dashboard → **Blueprints** → **New Blueprint Instance** → pick the
   repo.
3. Render reads `render.yaml`, shows three services and one environment
   group, and prompts for every `sync: false` value. Paste them.

The blueprint creates `curatix-shared` as a **single environment group bound
to all three services**. Do not set variables per-service. Three drifting env
lists is how the worker ends up on a different database than the web process,
which presents as "some emails never send".

### 3.2 The two values you cannot know yet

`ALLOWED_HOSTS` and `CORS_ALLOWED_ORIGINS` depend on hostnames that do not
exist until the first deploy. Set placeholders, deploy, then fix:

```
ALLOWED_HOSTS=curatix-api.onrender.com
CSRF_TRUSTED_ORIGINS=https://curatix-api.onrender.com
CORS_ALLOWED_ORIGINS=https://<your-app>.vercel.app
FRONTEND_BASE_URL=https://<your-app>.vercel.app
```

A wrong `ALLOWED_HOSTS` is a 400 `DisallowedHost` on every request. A wrong
`CORS_ALLOWED_ORIGINS` is a browser-side block with a clean server log — the
harder of the two to diagnose, so check it first when "the frontend can't
reach the API".

### 3.3 Migrations

The blueprint sets `preDeployCommand: python manage.py migrate_safe --yes` on
the web service. `migrate_safe` prints the plan, holds an advisory lock so
concurrent replicas serialise, and uses the direct (session-mode) alias.

**This is a deliberate exception for a test environment.** The repo's standing
rule is that migrations are a reviewed step, not a boot step — auto-migrate
applies unreviewed schema changes on every deploy. For real production,
delete that line and run it by hand from a Render Shell first.

### 3.4 First boot

It will probably fail. Read the log: preflight names the variable and the
consequence. Fix, redeploy. When it passes:

```bash
curl -i https://curatix-api.onrender.com/health/
```

`/health/` probes the database and cache for real and returns 503 when either
is down — a 200 here means Supabase and Upstash are both reachable *from
Render*, which is the thing you actually wanted to know.

### 3.5 Create the first admin

Render Shell on `curatix-api`:

```bash
python manage.py ensure_admin        # see core/management/commands
```

---

## 4. Frontend on Vercel — step by step

1. Vercel → **Add New Project** → import the repo.
2. **Root Directory: `frontend`.** Everything else auto-detects.
3. Environment variables (Production **and** Preview):

Required — the app is wrong without these:

```
NEXT_PUBLIC_API_BASE_URL=https://curatix-api.onrender.com
NEXT_PUBLIC_SITE_URL=https://<your-app>.vercel.app
NEXT_PUBLIC_MEDIA_BASE_URL=https://<your-s3-host>
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxx
```

Optional — each one is a capability that **disables itself** when unset rather
than half-working, which is the rule this codebase follows for every optional
integration:

```
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY     venue map; absent -> no map, no error
NEXT_PUBLIC_GSTIN                   invoice/footer legal details
NEXT_PUBLIC_REGISTERED_ADDRESS
NEXT_PUBLIC_SOCIAL_INSTAGRAM        footer icons; an unset handle renders
NEXT_PUBLIC_SOCIAL_X                nothing rather than linking to the
NEXT_PUBLIC_SOCIAL_FACEBOOK         platform's front door
NEXT_PUBLIC_SOCIAL_LINKEDIN
NEXT_PUBLIC_OAUTH_BASE_URL          leave UNSET — Google/Apple sign-in has no
NEXT_PUBLIC_PHONE_AUTH_ENABLED      backend yet, and setting these turns on
                                    buttons that cannot work
```

Leave the last two alone. `frontend/BACKLOG.md` item 19 specifies the three
endpoints they need; until those exist, the controls fail with a plain
sentence naming the provider, which is the intended behaviour.

4. Deploy. Then go back and correct `NEXT_PUBLIC_SITE_URL` with the real
   hostname **and redeploy** — see §0.4, the value is already baked into the
   first build.

`next.config.mjs` builds `next/image`'s `remotePatterns` from
`NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_MEDIA_BASE_URL`, so posters break
if the media host is wrong. That is the first thing to check when images are
missing but the page renders.

---

## 5. CI/CD — what a push actually does

### The shape

```
git push origin main
   │
   ├─► GitHub Actions: ci.yml        backend  — ruff, mypy, missing-migration
   │                                            check, pytest, image build,
   │                                            SDK-import + non-root checks
   ├─► GitHub Actions: frontend.yml  frontend — tsc, eslint, stylelint,
   │                                            vitest, build, bundle budget,
   │                                            Playwright + axe
   │
   ├─► Render   waits for CI, then builds and deploys all three services
   └─► Vercel   builds and deploys the frontend
```

**Render is set to `autoDeployTrigger: checksPass`** in the blueprint. A
commit that fails CI never reaches the environment. This is the whole reason
to keep the existing CI: `ci.yml`'s `image` job already proves the container
starts, runs as non-root, imports every SDK its backends select, and carries
no dependency it does not select.

**Vercel deploys on every push regardless of CI** — that is Vercel's model.
The frontend build itself runs `tsc` and the linters, so a broken build still
fails; but a failing *test* will not stop a Vercel deploy. If you want that,
turn off Vercel's Git integration and deploy from Actions instead (§5.2).

### Preview deployments

Every pull request gets a Vercel preview at a **new random hostname**. Those
origins are not in `CORS_ALLOWED_ORIGINS`, so previews cannot call the API.

Three options, in order of preference:

1. **Accept it.** Previews render; API calls fail. Fine for reviewing layout,
   and it is what I would do for a two-week test.
2. **Regex allow-list — needs a one-line settings change first.**
   django-cors-headers supports `CORS_ALLOWED_ORIGIN_REGEXES`, but
   `config/settings/base.py` reads **only** `CORS_ALLOWED_ORIGINS` today, so
   setting the regex variable on Render alone does nothing. Add beside it:

   ```python
   # Vercel preview deployments get a new hostname per commit, so they cannot
   # be enumerated. Empty by default — a regex here widens the origin
   # allow-list, and it must never reach production.
   CORS_ALLOWED_ORIGIN_REGEXES = env.list("CORS_ALLOWED_ORIGIN_REGEXES", default=[])
   ```

   then set `CORS_ALLOWED_ORIGIN_REGEXES=^https://<your-app>-[a-z0-9-]+\.vercel\.app$`
   on the **preview/staging** backend only. Understand what you are allowing:
   any hostname matching that pattern. Vercel controls that namespace, so the
   blast radius is your own preview deployments — but it is still a wider door
   than production should ever have.
3. **A second Render service** for previews, with its own permissive CORS and
   a throwaway database. Correct, and probably not worth it for two weeks.

### 5.2 The upgrade: one validated image for all three services

The blueprint above has Render build the Dockerfile — **three times**, once per
service, and the image Render runs is not byte-identical to the one CI
validated. For a two-week test that is a fine trade.

For real production, build once and deploy that exact artefact. Render's docs
are explicit that *"services using Docker images must deploy manually, as they
don't support automatic deployments"* — so the trigger becomes a deploy hook:

`.github/workflows/deploy-render.yml`:

```yaml
name: deploy
on:
  workflow_run:
    workflows: [CI]           # only after ci.yml succeeds
    types: [completed]
    branches: [main]

jobs:
  push-and-deploy:
    if: github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: ./backend
          push: true
          tags: |
            ghcr.io/${{ github.repository }}/backend:${{ github.sha }}
            ghcr.io/${{ github.repository }}/backend:latest
      # One image, three services. They cannot drift.
      - run: |
          curl -fsS -X POST "${{ secrets.RENDER_HOOK_WEB }}"
          curl -fsS -X POST "${{ secrets.RENDER_HOOK_WORKER }}"
          curl -fsS -X POST "${{ secrets.RENDER_HOOK_SCHEDULER }}"
```

Point each Render service at `ghcr.io/<owner>/<repo>/backend:latest` with a
registry credential, and copy the three deploy-hook URLs into repository
secrets.

---

## 6. After the first successful deploy

### 6.1 Register the Razorpay webhook

This is the one credential you could not obtain before, because it needs a
public HTTPS URL. In the Razorpay dashboard:

- URL: `https://curatix-api.onrender.com/api/v1/payments/webhook`
- Events: `payment.captured`, `payment.failed`, `refund.processed`
- Copy the signing secret into `RAZORPAY_WEBHOOK_SECRET` and redeploy.

The signature **is** the credential — the endpoint takes no user token and
verifies the HMAC over the raw request body. A wrong secret is a 400 and
nothing happens, which is the correct failure.

### 6.2 Verify the whole money path

Do not trust a green health check. Buy a ticket with a Razorpay test card and
confirm, in order:

1. the booking goes `reserved → paid`;
2. a `Ticket` row exists with a QR token;
3. the confirmation email arrives — **this proves the worker is alive**;
4. wait ~2 minutes and check the scheduler's cron log for a run —
   **this proves the clock is alive**;
5. abandon a second checkout and confirm the hold is released within a few
   minutes.

Steps 3 and 4 are the two that are invisible from the web service and are
exactly what §0.1 warns about.

### 6.3 Watch for the region tax

Render Singapore ↔ Supabase Mumbai is ~50ms per round trip. This codebase
survives it because its public read paths are **1–2 queries** (0 warm, served
from Redis) rather than a dozen — that was a deliberate design constraint, and
this is where it pays. But it does mean p50 latency is dominated by geography,
not by your code. If the numbers bother you during the test, move Supabase to
Singapore rather than optimising anything.

---

## 7. Moving off Render later

Nothing below changes application code. That is the point of the ports-and-
adapters split: **the host is a configuration decision.**

### 7.1 To Google Cloud Run

| Render | Cloud Run | Notes |
| --- | --- | --- |
| `web` service | Cloud Run **service** | `--min-instances=1` or you reintroduce cold starts |
| `worker` service | Cloud Run service, `--min-instances=1`, no public traffic | or a Cloud Run **Job** on a schedule |
| `scheduler` cron | **Cloud Scheduler → Cloud Run Job** running `run_scheduled_jobs --once` | exactly the mode the command documents |
| Blueprint env group | **Secret Manager** + service env | one secret per credential |
| Render build | **Cloud Build** or push to Artifact Registry from Actions | same Dockerfile, unchanged |

Steps:

1. Push the image to Artifact Registry (`asia-south1` to sit beside Supabase).
2. `gcloud run deploy curatix-api --image ... --region asia-south1
   --min-instances 1 --port 8000`.
3. Same image, `--command` overridden, for the worker.
4. `gcloud scheduler jobs create http` hitting a Cloud Run Job for the clock.
5. Update `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, and the Razorpay webhook
   URL to the new hostname. Redeploy Vercel with the new
   `NEXT_PUBLIC_API_BASE_URL` — remember §0.4, it is baked in.

**The one thing worth switching on once you are there:** `QUEUE_BACKEND=cloud_tasks`.
The adapter and its receiver (`core/task_dispatch.py`,
`POST /internal/tasks/run`) are already built and tested. It buys you real
retries and dead-lettering managed by Google instead of the in-process worker.
It is not required — `local` plus the worker is a supported topology — so do
it when the queue depth justifies it, not on arrival.

### 7.2 To AWS

| Render | AWS |
| --- | --- |
| `web` | ECS Fargate service behind an ALB, or App Runner |
| `worker` | ECS Fargate service, desired count 1, no load balancer |
| `scheduler` | EventBridge Scheduler → ECS RunTask (`--once`) |
| env group | SSM Parameter Store / Secrets Manager |
| image | ECR, pushed from the same Actions workflow |

Storage needs no change at all — `STORAGE_BACKEND=s3` is already the S3
adapter; only the endpoint and credentials move.

### 7.3 The checklist for any move

1. Same image, three processes. Confirm all three are running.
2. `DATABASE_URL` pooled, `DIRECT_DATABASE_URL` direct.
3. `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `CORS_ALLOWED_ORIGINS`,
   `FRONTEND_BASE_URL` → new hostnames.
4. Razorpay webhook URL → new hostname, secret unchanged.
5. Vercel `NEXT_PUBLIC_API_BASE_URL` → new hostname, **then redeploy**.
6. `TICKET_QR_SIGNING_KEY` **must be carried across unchanged**, or every
   already-issued ticket stops scanning.
7. Run `/health/` and repeat §6.2 end to end.

Item 6 is the one that silently ruins a migration. It is a signing key, not a
config value: rotate it and every QR code in every customer's phone becomes
invalid, with the gate reporting `denied_invalid` and no way back.
