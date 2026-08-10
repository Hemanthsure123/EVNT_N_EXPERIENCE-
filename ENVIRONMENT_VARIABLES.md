# Environment variables

The single source of truth for configuring Eventful.

Every variable below is **read by code**. That is not an aspiration — it is
enforced by `backend/core/tests/test_env_contract.py`, which fails the build if
a variable is read but undeclared, declared but unread, declared twice, or
missing from this document. Nothing here is aspirational and nothing is
fabricated.

## Which template to copy

Pick the one for your target, copy it to `.env`, fill in every `<PLACEHOLDER>`,
and change nothing else. **All four declare the identical variable set** — a
variable added to one must be added to all, which
`backend/core/tests/test_env_templates.py` enforces rather than requests.

| Target | Backend template | Frontend template |
| --- | --- | --- |
| Development | `.env.example` | `frontend/.env.local.example` |
| Staging | `.env.staging.example` | `frontend/.env.production.example` |
| Production | `.env.production.example` | `frontend/.env.production.example` |

`.env.example` doubles as the canonical reference: it explains every variable at
length, and the per-environment files stay terse and point back to it. There is
deliberately no `.env.development.example` — it would be a byte-for-byte copy
of `.env.example` under a second name, and two files that must stay identical
are two files that eventually will not be.

The templates contain **placeholders only**. A test scans them for anything
shaped like a real Razorpay key, Supabase URL, Upstash URL, Google API key or
Sentry DSN, because these files are committed and the likeliest way a secret
reaches one is somebody filling a template in place instead of copying it first.

- **Where to get each credential:** `REAL_INTEGRATIONS_AUDIT.md` §3
- **The ordered runbook that fills these in:** `DEPLOYMENT.md`

---

## Classification

| Class | Meaning | Count |
| --- | --- | --- |
| **Required for Development** | `docker compose up` will not work without it | 11 |
| **Required for Production** | The deploy gate (`core/preflight.py`) refuses to boot without it | 14 |
| **Optional** | Has a working default, or gates a feature that disables itself cleanly | 37 |
| **Future Integration** | Declared for a capability that is built-but-uncontracted (SMS) or not built (Google OAuth) | 9 |

Two mechanisms make this safe rather than merely documented:

- **Production refuses to boot on a placeholder.** `core/preflight.py` reports
  every problem at once — a missing credential, a shipped dummy secret, a fake
  adapter — rather than one per deploy.
- **A production frontend build fails without its public URLs.**
  `lib/api/config.ts` throws, so `next build` stops before a deploy rather than
  emitting a sitemap full of `localhost`.

---

## Backend

### Django

| Variable | Required | Default | Used By | Description |
| --- | --- | --- | --- | --- |
| `ENVIRONMENT` | Optional | `development` | `settings/base.py`, `core/observability.py` | Free-text environment name. Tags Sentry events; never branched on for business logic. |
| `DJANGO_SETTINGS_MODULE` | **Dev + Prod** | — | `manage.py`, `wsgi.py`, `asgi.py`, `config/worker.py` | Which settings module to load: `config.settings.{dev,test,staging,prod}`. Read by Django itself before any project code. |
| `DEBUG` | Optional | `False` | `settings/base.py` | Leaks settings, SQL and stack traces. Production refuses to boot with it on. |
| `SECRET_KEY` | **Dev + Prod** | — | Django core (sessions, signing, CSRF) | Min 32 chars. Production refuses the shipped dummy. |
| `ALLOWED_HOSTS` | **Production** | `localhost,127.0.0.1` | `settings/base.py` | Comma-separated. Production refuses to boot if empty — an empty list accepts any `Host` header. |
| `ENABLE_SILK` | Optional | `false` | `settings/base.py` | django-silk profiler at `/silk/`. Production refuses it: it records request bodies (passwords, payment payloads) and serves them unauthenticated. |

### Database (Supabase PostgreSQL)

| Variable | Required | Default | Used By | Description |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | **Dev + Prod** | — | `settings/base.py` → `DATABASES` | Supavisor **transaction** mode, port **6543**. All runtime queries. |
| `DIRECT_DATABASE_URL` | **Dev + Prod** | falls back to `DATABASE_URL` | `settings/test.py` | Supavisor **session** mode, port **5432**. Migrations, admin, pytest — a transaction pooler cannot create the throwaway `test_<db>` database pytest-django makes. |
| `CONN_MAX_AGE` | Optional | `60` (set to **`0`**) | `settings/base.py` | Must be `0` behind a pooler; it already manages connection reuse. |
| `DISABLE_SERVER_SIDE_CURSORS` | Optional | `False` (set to **`true`**) | `settings/base.py` | Must be `true` behind a transaction pooler — server-side cursors need session affinity it does not provide. |

Two Supabase specifics that cost an afternoon each if missed:

1. The pooler username is **`postgres.<project-ref>`**, not `postgres`.
2. Do **not** use `db.<ref>.supabase.co:5432` for `DIRECT_DATABASE_URL` — that
   host is IPv6-only for new projects unless you buy the IPv4 add-on. Supavisor
   session mode (same pooler host, port 5432) is IPv4-reachable and equivalent.

### Redis

| Variable | Required | Default | Used By | Description |
| --- | --- | --- | --- | --- |
| `REDIS_URL` | **Dev + Prod** | `redis://localhost:6379/0` | `di.cache_port()`, `CACHES["default"]` | Cache, distributed locks, and rate-limit counters. **Upstash in every environment including development** — the cache is where "works locally" diverges most from production. Include `?ssl_cert_reqs=none` ONLY for the local `--profile local-redis` container, whose certificate is self-signed; a real Upstash certificate is CA-signed and the parameter would disable verification where it matters. The adapter fails OPEN, so an unreachable cache degrades to a database read. |
| `CACHE_BACKEND` | Optional | `redis` | `di.cache_port()`, `settings/base.py` | `redis` \| `locmem`. `locmem` is used only by the test settings; it is per-process, so a rate limit on it is per-replica. |

### Authentication

| Variable | Required | Default | Used By | Description |
| --- | --- | --- | --- | --- |
| `JWT_SIGNING_KEY` | **Dev + Prod** | — | `SIMPLE_JWT`, `apps/accounts` | Min 32 chars. With the shipped dummy, anyone holding this repo can mint a session for any user id — including a staff one. |
| `ACCESS_TOKEN_LIFETIME_MIN` | Optional | `15` | `SIMPLE_JWT` | Access-token lifetime, minutes. |
| `REFRESH_TOKEN_LIFETIME_DAYS` | Optional | `30` | `SIMPLE_JWT` | Refresh-token lifetime, days. Blacklisted on logout. |

### Payments — Razorpay

| Variable | Required | Default | Used By | Description |
| --- | --- | --- | --- | --- |
| `PAYMENTS_BACKEND` | **Production** | `fake` | `di.payment_port()` | `fake` \| `razorpay`. Production refuses `fake` — every checkout would succeed and no money would move. |
| `RAZORPAY_KEY_ID` | **Production** | `""` | `RazorpayPaymentAdapter` | Dashboard → Settings → API Keys. |
| `RAZORPAY_KEY_SECRET` | **Production** | `""` | `RazorpayPaymentAdapter` | Shown once at generation. |
| `RAZORPAY_WEBHOOK_SECRET` | **Dev + Prod** | `""` | `RazorpayPaymentAdapter`, `FakePaymentAdapter` | Verifies the **only** proof of payment the platform accepts. Needed in dev too: the fake adapter runs the same real HMAC. |

### Email (SMTP)

| Variable | Required | Default | Used By | Description |
| --- | --- | --- | --- | --- |
| `EMAIL_PROVIDER` | **Production** | `console` | `di.email_port()` | `console` \| `smtp`. Production refuses `console` — no customer would receive a ticket, receipt or refund notice. |
| `SMTP_HOST` | **Production** | `""` | `SmtpEmailAdapter` | Relay hostname. Preflight requires it when `EMAIL_PROVIDER=smtp`. |
| `SMTP_PORT` | Optional | `587` | `SmtpEmailAdapter` | `587` for STARTTLS, `465` for implicit TLS. |
| `SMTP_USERNAME` | Optional | `""` | `SmtpEmailAdapter` | Empty for an unauthenticated internal relay. |
| `SMTP_PASSWORD` | Optional | `""` | `SmtpEmailAdapter` | — |
| `SMTP_FROM_EMAIL` | **Production** | `""` | `SmtpEmailAdapter` | Envelope sender. **Requires SPF, DKIM and DMARC** on its domain, or ticket emails land in spam and the customer reaches the gate with no QR. |
| `SMTP_USE_TLS` | Optional | `true` | `SmtpEmailAdapter` | STARTTLS (port 587). **Mutually exclusive** with `SMTP_USE_SSL`; the adapter refuses both at construction. |
| `SMTP_USE_SSL` | Optional | `false` | `SmtpEmailAdapter` | Implicit TLS (port 465). |
| `SMTP_TIMEOUT_SECONDS` | Optional | `10` | `SmtpEmailAdapter` | Without it a wedged relay hangs the worker forever, so the notification is neither sent nor retried. |

### Google Maps Platform

**ONE key for every Maps service.** That is Google's own model — a key is
enabled per-API in the Cloud console — so one key means one quota, one bill and
one rotation. Do not create a key per service.

| Variable | Required | Default | Used By | Description |
| --- | --- | --- | --- | --- |
| `GOOGLE_MAPS_API_KEY` | Optional | `""` | `di.maps_port()` → `GoogleMapsAdapter` | Server key for Places, Geocoding, Directions, Distance Matrix and Places Photos. Blank disables Maps honestly: every `/maps/` endpoint answers 503 and the UI shows an address plus a directions link instead of an empty map. |
| `GOOGLE_MAPS_REGION` | Optional | `""` (set to `in`) | `GoogleMapsAdapter` | ccTLD bias for geocoding and autocomplete. Without it an Indian venue search returns a lot of Springfields. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Optional | `""` | `lib/maps/use-google-maps.ts` | **Frontend.** Maps JavaScript API only — a map must render client-side. Same key VALUE is fine; restrict it by HTTP referrer in the console. Public by necessity: anything the browser uses is in the page source. |

Enable on the key: **Places API, Geocoding API, Directions API, Distance Matrix
API, Maps JavaScript API**. Restrict it to exactly those five — an unrestricted
key is a billable credential anyone who finds it can spend.

Everything except the JavaScript API is proxied through the backend, so the
server key never reaches a browser, results are cached (which is where nearly
all the cost saving comes from), and a runaway client hits our rate limit
rather than the billing account.

### Storage

| Variable | Required | Default | Used By | Description |
| --- | --- | --- | --- | --- |
| `STORAGE_BACKEND` | **Production** | `local` | `di.storage_port()` | `local` \| `s3` \| `gcs`. Production refuses `local` — uploads go to the container's disk and vanish on restart. **Use `s3`**: it speaks the S3 API, so Supabase Storage, Cloudflare R2, Backblaze B2, MinIO and AWS S3 are all the same adapter and a credential change. |
| `S3_BUCKET_NAME` | Optional¹ | `""` | `S3StorageAdapter` | ¹Required when `STORAGE_BACKEND=s3`. On Supabase this is the bucket you create under Storage; it must be **public** if you serve via `S3_PUBLIC_BASE_URL`. |
| `S3_ENDPOINT_URL` | Optional¹ | `""` | `S3StorageAdapter` | ¹Required for anything that is not AWS. Supabase: `https://<project-ref>.supabase.co/storage/v1/s3`. R2: `https://<account>.r2.cloudflarestorage.com`. Blank means real AWS S3. |
| `S3_ACCESS_KEY_ID` | Optional¹ | `""` | `S3StorageAdapter` | ¹Required when `STORAGE_BACKEND=s3`. Supabase: Storage → S3 Access Keys → New access key. **Not** the anon or service-role key. |
| `S3_SECRET_ACCESS_KEY` | Optional¹ | `""` | `S3StorageAdapter` | ¹Shown once at creation. Rotating it is a credential change with no code change. |
| `S3_REGION` | Optional | `auto` | `S3StorageAdapter` | Supabase shows the region beside the endpoint (e.g. `ap-south-1`). R2 uses `auto`. Signing (SigV4) needs it to match. |
| `S3_PUBLIC_BASE_URL` | Optional | `""` | `S3StorageAdapter` | The base URL browsers fetch objects from — a CDN or the bucket's public URL. Blank falls back to the endpoint, which works but is neither cached nor cheap. Whatever host this resolves to must also be in `NEXT_PUBLIC_MEDIA_BASE_URL`, or `next/image` refuses every poster. |
| `GCS_BUCKET_NAME` | Optional¹ | `""` | `GCSStorageAdapter` | ¹Required when `STORAGE_BACKEND=gcs`. The `gcp` extra is **not** in the production image — see `INSTALL_EXTRAS` in `backend/Dockerfile`. |
| `GCP_PROJECT_ID` | Optional¹ | `""` | `GCSStorageAdapter`, `PubSubEventBusAdapter`, `CloudTasksQueueAdapter` | ¹Required for any GCS/Pub-Sub/Cloud-Tasks backend. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Optional | `""` | Google client libraries (process env, not Django) | **Local dev only.** In production use an attached, least-privilege service account — never a downloaded key file. |

### Background tasks

| Variable | Required | Default | Used By | Description |
| --- | --- | --- | --- | --- |
| `QUEUE_BACKEND` | Optional | `local` | `di.task_queue_port()` | `local` (synchronous, in-process) \| `cloud_tasks`. |
| `EVENT_BUS_BACKEND` | Optional | `inprocess` | `di.event_bus_port()` | `inprocess` \| `pubsub`. |
| `CLOUD_TASKS_QUEUE` | Optional¹ | `default-queue` | `CloudTasksQueueAdapter` | ¹Required when `QUEUE_BACKEND=cloud_tasks`. |
| `CLOUD_TASKS_LOCATION` | Optional¹ | `""` | `CloudTasksQueueAdapter` | ¹ e.g. `asia-south1`. |
| `CLOUD_TASKS_TARGET_URL` | Optional¹ | `""` | `CloudTasksQueueAdapter` | ¹**This service's own** `/internal/tasks/run`. Without it every enqueue succeeds and every delivery 404s, silently. |
| `CLOUD_TASKS_SERVICE_ACCOUNT` | Optional | `""` | `CloudTasksQueueAdapter` | Enables a Google-signed OIDC token Cloud Run can verify before Django is reached. |
| `PUBSUB_TOPIC_EVENTS` | Optional¹ | `platform-events` | `PubSubEventBusAdapter` | ¹Required when `EVENT_BUS_BACKEND=pubsub`. |

### Notifications

| Variable | Required | Default | Used By | Description |
| --- | --- | --- | --- | --- |
| `NOTIFICATION_MAX_ATTEMPTS` | Optional | `5` | `NotificationService` | Attempts before a send is dead-lettered (recorded, never dropped). |
| `NOTIFICATION_RETRY_BACKOFF_SECONDS` | Optional | `30` | `NotificationService` | Base for exponential backoff. |
| `NOTIFICATION_EVENT_REMINDER_HOURS_BEFORE` | Optional | `24` | `apps/events` handlers | How long before an event its reminder is scheduled. |
| `NOTIFICATION_DISPLAY_TIMEZONE` | Optional | `Asia/Kolkata` | `apps/notifications/templates.py` | The timezone every human-readable date in an outbound message renders in. Separate from the database's UTC: one is how an instant is stored, the other is how a person reads it. The ticket PDF carried to a gate must say the same time as the event page it was bought from. |
| `PLATFORM_ADMIN_EMAILS` | Optional | `[]` | `apps/notifications/handlers.py` | Comma-separated operator mailboxes for "something is waiting for your decision" alerts (event submitted for review, organization verification, performer profile). **Empty sends no alert** — the submission still succeeds and the skip is logged, so an unset value fails silently from the organiser's side. There is no safe address to default to, which is why it does not have one. |
| `PUBLIC_SITE_URL` | Optional | `""` | `ReminderService` | The **frontend's** origin, for deep links that leave the backend. Blank omits the link rather than guessing — a notification pointing at the wrong host is worse than one with no link. |

### Web Push (VAPID)

| Variable | Required | Default | Used By | Description |
| --- | --- | --- | --- | --- |
| `VAPID_PUBLIC_KEY` | Optional | `""` | `di.push_port()`, `GET /push/config` | Self-generated. Public by design — every subscribing browser receives it. |
| `VAPID_PRIVATE_KEY` | Optional | `""` | `WebPushAdapter` | Self-generated: `manage.py generate_vapid_keys --env`. **No vendor account.** |
| `VAPID_CONTACT` | Optional¹ | `""` | `WebPushAdapter` | ¹Required when the keys are set — the VAPID spec mandates it and Firefox rejects tokens without one. |
| `PUSH_BACKEND` | Optional | `webpush` | `di.push_port()` | Only `webpush` exists. Any other value raises rather than silently disabling. |

With the keys unset, push disables itself honestly: the port reports
`is_configured() == False`, `POST /me/push/subscriptions` returns 422, and the
UI renders nothing instead of asking for a browser permission it could never
honour.

### Sentry

| Variable | Required | Default | Used By | Description |
| --- | --- | --- | --- | --- |
| `SENTRY_DSN` | Optional | `""` | `core/observability.py` | **Backend DSN only** — a separate Sentry project from the frontend's. Unset = the SDK is never imported; errors are logged as structured JSON either way. PII is scrubbed. Needs `pip install -e ".[observability]"`. |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional | `0.0` | `core/observability.py` | `0.0`–`1.0`. |
| `SENTRY_RELEASE` | Optional | `""` | `core/observability.py` | Set per deploy (e.g. the git SHA) so a stack trace maps to a commit. |

### Security

| Variable | Required | Default | Used By | Description |
| --- | --- | --- | --- | --- |
| `TICKET_QR_SIGNING_KEY` | **Dev + Prod** | `""` | `apps/booking/qr.py` (mint), `apps/checkin` (verify) | Min 32 chars. With the shipped dummy anyone can forge a ticket that passes the gate scanner. **Rotating invalidates every issued ticket.** |
| `INTERNAL_TASK_SECRET` | Optional¹ | `""` | `core/task_dispatch.py`, `CloudTasksQueueAdapter` | ¹Required when `QUEUE_BACKEND=cloud_tasks`. The endpoint runs task handlers, one of which releases a payout. Compared in constant time. |
| `CORS_ALLOWED_ORIGINS` | **Production** | `[]` | django-cors-headers | Browser origins allowed to call the API. `CORS_ALLOW_ALL_ORIGINS` is refused in production. |
| `CSRF_TRUSTED_ORIGINS` | Optional | `[]` | `settings/{prod,staging}.py` | `/admin/` only — the API is Bearer-token authenticated, so no cookie authorises it. |
| `NUM_PROXIES` | Optional | `0` | `REST_FRAMEWORK["NUM_PROXIES"]` | Proxies that **prepend** to `X-Forwarded-For` (CDN + LB = 2). Too small trusts a client-supplied header and lets anyone rotate their own rate-limit key; too large keys every request on the proxy's IP. |
| `THROTTLE_ANON` | Optional | `120/min` | `core/throttling.py` | Unauthenticated ceiling, IP-keyed. |
| `THROTTLE_USER` | Optional | `600/min` | `core/throttling.py` | Authenticated ceiling, user-keyed. |
| `THROTTLE_AUTH` | Optional | `10/min` | `AuthThrottle` | Sign-in / register / refresh. The credential-guessing surface. |
| `THROTTLE_OTP` | Optional | `5/hour` | `OtpThrottle` | Each request sends a paid SMS — a spend limit as much as a security control. |
| `THROTTLE_WEBHOOK` | Optional | `600/min` | `WebhookThrottle` | Deliberately **above** Razorpay's retry schedule; the signature is the real gate. |
| `THROTTLE_CHECKIN` | Optional | `1200/min` | `CheckinThrottle` | High on purpose — denying a real scan is a queue at a door. |
| `THROTTLE_UPLOAD` | Optional | `60/hour` | `UploadThrottle` | User-keyed. |
| `THROTTLE_WRITE` | Optional | `120/min` | `WriteThrottle`, `AnonWriteThrottle` | Authenticated writes, plus the push-rotation endpoint. |
| `THROTTLE_MAPS` | Optional | `120/min` | `MapsThrottle` | Google Maps calls. A **spend** limit as much as an abuse control — autocomplete fires per keystroke and every call is billed. User-keyed, so one organizer in the venue picker cannot exhaust everybody's budget. |

### Business configuration

Commercial decisions, not infrastructure defaults to accept silently.

| Variable | Required | Default | Used By | Description |
| --- | --- | --- | --- | --- |
| `BOOKING_HOLD_MINUTES` | Optional | `10` | `apps/booking` | How long a reservation is held awaiting payment. Short, so unpaid holds do not starve inventory during an on-sale. |
| `PAYMENT_RECONCILE_MIN_AGE_SECONDS` | Optional | `90` | `apps/payments` | How old a booking must be before `payments.reconcile_pending` asks the provider about it — below this the browser's own verify call has not had its chance yet. |
| `PAYMENT_RECONCILE_GRACE_MINUTES` | Optional | `180` | `apps/payments` | How long after a hold lapses the platform keeps asking. A capture found here is **refunded** (the seats are gone); without the window, "paid, no ticket, no refund" is permanent. |
| `PLATFORM_FEE_PER_TICKET` | Optional | `10` | `apps/booking`, `apps/settlements` | **Minor units (paise).** Taken *out* of the total, never added on top — the organizer receives (total − fee). |
| `SETTLEMENT_REFUND_WINDOW_HOURS` | Optional | `48` | `apps/settlements` | A payout releases only once the event ended **and** this window passed, so `net` is final. |
| `SETTLEMENT_MAX_ATTEMPTS` | Optional | `5` | `apps/settlements` | Attempts before a payout is dead-lettered. It stays **owed**, never lost. |
| `SETTLEMENT_RETRY_BACKOFF_SECONDS` | Optional | `60` | `apps/settlements` | — |
| `CHECKIN_WINDOW_OPENS_BEFORE_MINUTES` | Optional | `180` | `apps/checkin` | Earliest a ticket may be scanned, before `starts_at`. |
| `CHECKIN_WINDOW_GRACE_AFTER_MINUTES` | Optional | `360` | `apps/checkin` | Latest a ticket may be scanned, after the event ends. |

> The names are `..._OPENS_BEFORE_MINUTES` / `..._GRACE_AFTER_MINUTES` — in
> **minutes**, not hours. They are what the code reads.

### SMS — Future Integration

The adapter and every template are **built and tested**. What is missing is a
contracted provider and India DLT registration. `console` logs instead of
sending, so nothing is faked — an SMS simply does not go out.

| Variable | Required | Default | Used By | Description |
| --- | --- | --- | --- | --- |
| `SMS_PROVIDER` | Future | `console` | `di.sms_port()` | `console` \| `http`. Production refuses `console` once SMS is contracted. |
| `SMS_API_KEY` | Future | `""` | `HttpSmsAdapter` | MSG91 / Twilio / Gupshup. |
| `SMS_API_BASE_URL` | Future | `""` | `HttpSmsAdapter` | Provider's API base. |
| `SMS_SENDER_ID` | Future | `""` | `HttpSmsAdapter` | 6-character DLT-approved header. |
| `SMS_DLT_ENTITY_ID` | Future | `""` | `HttpSmsAdapter` | From your DLT registration. |
| `SMS_DLT_TEMPLATE_ID` | Future | `""` | `HttpSmsAdapter` | Default template id. |
| `NOTIFICATION_SMS_DLT_TEMPLATE_IDS` | Future | `{}` | `apps/notifications/templates.py` | Per-type overrides: `otp=tmpl_a,booking_confirmation_sms=tmpl_b`. India approves a **distinct template per message type**. |

**DLT registration takes days to weeks.** Start it well before you need it.

### Google OAuth (Calendar)

**These are now READ** — by Google Calendar connection
(`di.calendar_port()` → `GoogleCalendarAdapter`). ONE OAuth client serves every
Google feature; Calendar simply requests its own scopes on top. A second client
would mean a second consent screen and a second verification review.

Scopes requested, and only these:

| Scope | Why |
| --- | --- |
| `.../auth/calendar.events` | Create, update and delete events. **Not** the broader `calendar` scope, which also permits deleting entire calendars — a permission this never needs and which makes Google's consent screen far more alarming. |
| `openid`, `email` | Name the connected account. Without it "Disconnect Google Calendar" is a button whose effect a person with two Google accounts cannot predict. |

Also enable the **Google Calendar API** on the project, or the token exchange
succeeds and every calendar write 403s.

Blank disables Calendar honestly: the port reports itself unconfigured, the
connect endpoint answers 503, and the UI does not offer the button.

**Google sign-in is still not built** — these credentials authorise a calendar
grant on top of an already-signed-in Eventful account, not authentication. See
`REAL_INTEGRATIONS_AUDIT.md` R1.

| Variable | Required | Default | Used By | Description |
| --- | --- | --- | --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | Optional¹ | `""` | `di.calendar_port()` | Cloud Console → Credentials → OAuth client ID → Web application. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Optional¹ | `""` | `di.calendar_port()` | Same screen. |
| `GOOGLE_OAUTH_REDIRECT_URI` | Optional¹ | `""` | `di.build_google_oauth_service()` | Must be registered **verbatim** as an Authorized redirect URI in the Google console, or the callback fails with `redirect_uri_mismatch`. |
| `GOOGLE_OAUTH_SIGNIN_REDIRECT_URI` | Optional | `""` | `di.build_google_sign_in_service()` | Where Google returns the browser after **sign-in** (as opposed to connecting a calendar). The SAME OAuth client — Google issues one per application — but its own callback, because that callback mints an Eventful session rather than storing a grant. Register BOTH URIs verbatim in the console or Google refuses with `redirect_uri_mismatch`. Blank disables Google sign-in: `GET /auth/oauth/google/config` reports it unavailable and the UI hides the button. |

When built it will be **Django-side**, against `apps/accounts` and the
platform's own JWTs — **not Supabase Auth**, which this project does not use.
Supabase is the PostgreSQL host and nothing else. The implementation is
specified in `REAL_INTEGRATIONS_AUDIT.md` (R1), including the mandatory
single-use `state` nonce and the `email_verified` check without which a Google
account with an unverified address could take over an existing password account.

¹All three are required together once Calendar is switched on.

> There is deliberately **no `GOOGLE_OAUTH_ALLOWED_ORIGINS`**. Google's
> "Authorized JavaScript origins" is configured in their console, not read by
> this application, and browser access is already governed by
> `CORS_ALLOWED_ORIGINS`. Adding it would be a variable nothing could consume.

### Web server (gunicorn)

Read by `backend/docker/gunicorn.conf.py` at process start, **not by Django**.
Every one has a working default; they exist so a process can be retuned
without rebuilding the image.

| Variable | Required | Default | Used By | Description |
| --- | --- | --- | --- | --- |
| `PORT` | Optional | `8000` | `gunicorn.conf.py` | The port gunicorn binds. Compose maps it — change both or neither. |
| `WEB_CONCURRENCY` | Optional | `(2×CPU)+1`, capped at 9 | `gunicorn.conf.py` | Worker processes. **Bounded by the connection pooler, not by CPU**: each worker holds its own database connections, and the scheduler and outbox worker draw from the same Supavisor client limit. Exhausting it presents as a database outage. The cap applies to the **computed default**; an explicit value here is honoured — silently discarding what an operator set is the bug this configuration exists to prevent — but a value above 9 prints a warning naming the risk on the process's first line of output. |
| `WEB_THREADS` | Optional | `2` | `gunicorn.conf.py` | Threads per worker. Above 1 lets a worker serve another request while one waits on Postgres or Razorpay — which is most of what this workload does. |
| `WEB_TIMEOUT` | Optional | `60` | `gunicorn.conf.py` | Seconds before a worker is presumed hung and killed. Above the slowest legitimate request, below any upstream proxy timeout. |
| `WEB_GRACEFUL_TIMEOUT` | Optional | `30` | `gunicorn.conf.py` | Seconds to finish in-flight requests after SIGTERM. **Must stay below `stop_grace_period` in `docker-compose.yml` (40s)** — otherwise Docker kills the worker first, and mid-deploy that can land between recording a payment and issuing the ticket. Asserted by `core/tests/test_deployment_topology.py`. |
| `GUNICORN_LOG_LEVEL` | Optional | `info` | `gunicorn.conf.py` | gunicorn's own logs. The application's logging is configured in `config/settings/base.py` and is unaffected. |
| `FORWARDED_ALLOW_IPS` | Optional | private ranges | `gunicorn.conf.py` | Which peers gunicorn believes `X-Forwarded-*` from. Deliberately **not** `*`: trusting every peer lets anything that can reach the container forge its source IP and defeat every IP-keyed rate limit. |

### Test safety

| Variable | Required | Default | Used By | Description |
| --- | --- | --- | --- | --- |
| `ALLOW_REMOTE_TEST_DATABASE` | Optional | `false` | `config/settings/test.py` | **Leave blank.** pytest CREATES AND DROPS its database. Test settings refuse a non-local host because the production readiness audit found `DIRECT_DATABASE_URL` resolving to production Supabase — a `pytest` run would have dropped a database there. Set it only for a remote database you are certain is disposable. |

---

## Frontend

Seven variables, and that is the whole surface. Everything prefixed
`NEXT_PUBLIC_` is **inlined into the client bundle** and readable by any
visitor — no backend secret ever belongs here.

| Variable | Required | Default | Used By | Description |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | **Dev + Prod** | `http://localhost:8000` (dev only) | `lib/api/config.ts`, `app/sw.js/route.ts` | Backend origin, no trailing slash. **`next build` fails without it in production.** |
| `NEXT_PUBLIC_SITE_URL` | **Dev + Prod** | `http://localhost:3000` (dev only) | `lib/api/config.ts`, `lib/seo/metadata.ts` | This site's public origin: canonical URLs, sitemap, OpenGraph. **`next build` fails without it in production.** |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | Optional | `""` | `lib/booking/razorpay.ts` | Client-safe key id. Optional because `POST /bookings` returns the key its order was created with, and that one always wins; this is the hard-refresh fallback. |
| `NEXT_PUBLIC_OAUTH_BASE_URL` | Future | unset | `lib/api/auth.ts` | Turns on the Google/Apple buttons. **Leave unset until the backend endpoints exist**, or they fail against a 404 instead of explaining themselves. |
| `NEXT_PUBLIC_PHONE_AUTH_ENABLED` | Future | unset | `lib/api/auth.ts` | Turns on phone + OTP sign-in. Same caveat. |
| `NEXT_PUBLIC_MEDIA_BASE_URL` | Optional | unset | `next.config.mjs` | The host uploads are served from, added to `next/image`'s `remotePatterns` allow-list. Needed only when `STORAGE_BACKEND=s3\|gcs` — with `local`, uploads come through the API and `NEXT_PUBLIC_API_BASE_URL` already covers them. **`next/image` refuses any host not on that list**, so a wrong value here is every poster silently failing. |
| `NEXT_PUBLIC_SENTRY_DSN` | Future | `""` | *nothing yet* | **Frontend DSN** — a different Sentry project from the backend's; one DSN for both merges server and browser errors into one stream. Nothing reads it until `@sentry/nextjs` is wired. Public by design: an ingest endpoint that can send events and read nothing. |
| `NEXT_PUBLIC_SOCIAL_INSTAGRAM` | Optional | `""` | `lib/brand.ts` | Full profile URL. **Unset renders no icon at all**, and with all five unset the social row is absent entirely. These were hard-coded to `https://instagram.com` and friends — the platforms' login walls, not accounts — which is the one thing in the footer a visitor could catch us at. |
| `NEXT_PUBLIC_SOCIAL_X` | Optional | `""` | `lib/brand.ts` | As above. |
| `NEXT_PUBLIC_SOCIAL_FACEBOOK` | Optional | `""` | `lib/brand.ts` | As above. |
| `NEXT_PUBLIC_SOCIAL_YOUTUBE` | Optional | `""` | `lib/brand.ts` | As above. |
| `NEXT_PUBLIC_SOCIAL_LINKEDIN` | Optional | `""` | `lib/brand.ts` | As above. |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Recommended | `""` | `lib/brand.ts`, `/contact`, `/careers` | The address every support channel on `/contact` routes to, with a per-channel `mailto:` subject. Unset renders "Not open yet" rather than an address that bounces; with this AND the phone unset, `/contact` shows an explicit "support channels are being set up" notice. **Effectively required for go-live** — `/contact` is one of the four pages an Indian payment gateway checks during merchant onboarding. |
| `NEXT_PUBLIC_SUPPORT_PHONE` | Optional | `""` | `lib/brand.ts`, `/contact` | Rendered as a `tel:` link, for day-of-event urgency only. Same absent-rather-than-fake rule. |
| `NEXT_PUBLIC_REGISTERED_ADDRESS` | Optional | `""` | `lib/brand.ts`, `/terms` | The registered office, printed in the governing-law clause. Unset, `/terms` states plainly that the entity is being registered and points at `/contact` — there is deliberately **no placeholder**, because an invented address on a Terms page is the detail that voids the document it appears on. |
| `NEXT_PUBLIC_GSTIN` | Future | `""` | `lib/brand.ts` | Declared, not yet rendered anywhere. The GST tax invoice is the next thing that needs it, and a GST-registered platform must show it on one. |

**Web Push needs nothing here.** The frontend asks the backend
(`GET /api/v1/push/config`) whether push is available and receives the VAPID
public key from it, so the key lives in one place and cannot drift.

### Dev tooling — documented, not declared

Read by scripts rather than the application, all with working defaults, so they
are described rather than declared. Putting them in `.env.local` would imply
the app uses them.

| Variable | Used By | Description |
| --- | --- | --- |
| `MOCK_API_PORT` | `scripts/mock-api.mjs` | Fixture API port. Defaults to 8000, the real backend's port — you run one or the other. |
| `MOCK_API_ORIGIN` | `scripts/mock-api.mjs` | Origin the fixture advertises. |
| `MOCK_RAZORPAY_KEY_ID` | `scripts/mock-api.mjs` | Key id the fixture returns from `POST /bookings`. |
| `CI` | `playwright.config.ts` | Standard CI flag: retries, no reuse of an existing server. |
| `NODE_ENV` | Next.js, `lib/api/config.ts` | Set by the framework, never by hand. Gates the fail-fast URL check. |

---

## Quick start

**Development** — 11 variables, all pre-filled in `.env.example`:

```bash
cp .env.example .env
cp frontend/.env.local.example frontend/.env.local
docker compose up
```

Everything vendor-facing runs on a local fake or a local service. Nothing
pretends: `PAYMENTS_BACKEND=fake` still verifies webhook signatures for real,
and `EMAIL_PROVIDER=console` logs the message instead of claiming to send it.

**Production** — change these, and preflight tells you if you missed one:

```bash
ENVIRONMENT=production
DJANGO_SETTINGS_MODULE=config.settings.prod
DEBUG=false
SECRET_KEY=<64 random chars>
JWT_SIGNING_KEY=<64 random chars>
TICKET_QR_SIGNING_KEY=<64 random chars>
ALLOWED_HOSTS=api.yourdomain.com
CORS_ALLOWED_ORIGINS=https://yourdomain.com
DATABASE_URL=<Supabase pooled, port 6543>
DIRECT_DATABASE_URL=<Supabase session, port 5432>
REDIS_URL=<Upstash rediss://>
PAYMENTS_BACKEND=razorpay
RAZORPAY_KEY_ID / _KEY_SECRET / _WEBHOOK_SECRET
EMAIL_PROVIDER=smtp
SMTP_HOST / _PORT / _USERNAME / _PASSWORD / _FROM_EMAIL
STORAGE_BACKEND=gcs
GCS_BUCKET_NAME / GCP_PROJECT_ID
NUM_PROXIES=<your real hop count>
```

Then, on the frontend:

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com
NEXT_PUBLIC_SITE_URL=https://yourdomain.com
```

Full deployment checklist, including the scheduler and outbox worker that must
be running or organizers never get paid: `REAL_INTEGRATIONS_AUDIT.md` §10.

---

## How this file stays true

`backend/core/tests/test_env_contract.py` enforces the contract on every test
run:

| Check | Fails when |
| --- | --- |
| Every read variable is declared | Code reads something `.env.example` does not declare |
| No active declaration is unread | A variable exists as configuration but nothing consumes it |
| `.env` matches `.env.example` | The two drift |
| No duplicates | A name is declared twice and the second silently wins |
| Frontend example matches frontend reads | Either side gains or loses a `NEXT_PUBLIC_` variable |
| No secret in the frontend example | A non-`NEXT_PUBLIC_` name, or one containing `SECRET`/`PRIVATE`/`PASSWORD` |
| Everything is documented | A variable is missing from **this file** |

Commented-out declarations are exempt from the "must be read" rule — that is
what makes the Google OAuth block legitimate rather than stale.

If you add a variable: read it in code, declare it in `.env.example` and `.env`,
and add a row here. The suite will tell you if you missed a step.
