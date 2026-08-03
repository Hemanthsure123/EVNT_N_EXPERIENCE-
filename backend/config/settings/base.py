"""Base settings shared by every environment.

Nothing in this file (or any settings file) should hard-code a vendor
credential or branch on ENVIRONMENT directly for business logic — that
belongs in config/di.py, which reads the *_BACKEND switches below to decide
which adapter to build. Settings only exposes configuration values; it never
imports a concrete adapter.
"""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import environ
from corsheaders.defaults import default_headers as default_cors_headers

# backend/config/settings/base.py -> backend/ -> repo root
BASE_DIR = Path(__file__).resolve().parent.parent.parent
REPO_ROOT = BASE_DIR.parent

env = environ.Env()
environ.Env.read_env(str(REPO_ROOT / ".env"))

ENVIRONMENT = env.str("ENVIRONMENT", default="development")
SECRET_KEY = env.str("SECRET_KEY")
DEBUG = env.bool("DEBUG", default=False)
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # third-party
    "django.contrib.postgres",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "drf_spectacular",
    "corsheaders",
    # shared kernel (owns the outbox / audit-log tables)
    "core",
    # business modules
    "apps.accounts",
    "apps.organizations",
    "apps.events",
    "apps.ticketing",
    "apps.booking",
    "apps.payments",
    "apps.checkin",
    "apps.notifications",
    "apps.settlements",
    # Read-only operator console: platform aggregates across every module.
    "apps.console",
    "apps.organizer",
    "apps.cms",
    "apps.announcements",
    # The Hire a Band marketplace. Owned by organizations, moderated by the
    # same gate as events - see the module docstring.
    "apps.performers",
    # Google Maps Platform: a thin read surface over the Maps web services.
    "apps.maps",
    # Third-party account connections (Google Calendar today).
    "apps.integrations",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # Compresses responses; placed early so its process_response (which runs
    # last, since middleware unwinds in reverse) compresses the final body
    # after every other middleware has already touched it.
    "django.middleware.gzip.GZipMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "core.middleware.RequestIDMiddleware",
    "core.middleware.PerformanceLoggingMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# Lightweight per-request profiler (django-silk), OFF by default even in
# dev — it has real overhead (its own DB tables, per-query capture) and
# should be switched on deliberately, not run all the time. Requires the
# `dev` extra (`pip install -e ".[dev]"`) and a `migrate` afterwards to
# create its tables.
ENABLE_SILK = env.bool("ENABLE_SILK", default=False)
if ENABLE_SILK:
    INSTALLED_APPS += ["silk"]
    MIDDLEWARE += ["silk.middleware.SilkyMiddleware"]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# CONN_MAX_AGE=0 and DISABLE_SERVER_SIDE_CURSORS=True are the two settings
# Django needs to sit behind a transaction-mode pooler (PgBouncer locally,
# Supabase's Supavisor on port 6543 in staging/prod): server-side cursors need
# session affinity that transaction pooling doesn't provide, and Django
# shouldn't hold its own long-lived connections on top of an external pool.
# sslmode (e.g. ?sslmode=require) travels inside DATABASE_URL itself and is
# parsed straight into OPTIONS by django-environ.
DATABASES = {"default": env.db_url("DATABASE_URL")}
DATABASES["default"]["CONN_MAX_AGE"] = env.int("CONN_MAX_AGE", default=60)
DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = env.bool(
    "DISABLE_SERVER_SIDE_CURSORS", default=False
)


# TLS is REQUIRED, not merely preferred.
#
# psycopg2 defaults to `sslmode=prefer`, which negotiates TLS if the server
# offers it and SILENTLY FALLS BACK TO PLAINTEXT if it does not. Against a
# managed Postgres that is usually encrypted in practice and unverifiable in
# principle — the client never asserts anything, so a downgrade produces no
# error. `require` makes the client refuse an unencrypted connection.
#
# Set here rather than relying on the URL's query string, because a URL
# pasted from a dashboard frequently omits it and the omission is invisible.
# An explicit `sslmode` in DATABASE_URL still wins: django-environ parses it
# into OPTIONS first and `setdefault` leaves it alone.
#
# Skipped for a loopback/container-network host, where there is no TLS
# listener and requiring one would break local development.
def _require_tls(config: dict) -> dict:
    host = str(config.get("HOST", ""))
    local = host in ("", "localhost", "127.0.0.1", "::1", "postgres", "pgbouncer", "db")
    if not local:
        config.setdefault("OPTIONS", {}).setdefault("sslmode", "require")
    return config


_require_tls(DATABASES["default"])

# A SECOND alias for DDL and anything a transaction pooler cannot serve.
#
# In production `DATABASE_URL` is Supavisor in TRANSACTION mode (port 6543),
# which hands each statement to whichever backend is free — fine for the
# app's short queries, wrong for a multi-statement migration. `direct` points
# at Supavisor SESSION mode (port 5432), which holds one backend per
# connection. `manage.py migrate_safe` uses it; nothing on the request path
# does, so it costs one idle connection slot and nothing else.
#
# Falls back to DATABASE_URL when DIRECT_DATABASE_URL is unset (CI, where a
# plain Postgres sits behind no pooler at all).
DATABASES["direct"] = _require_tls(
    env.db_url("DIRECT_DATABASE_URL", default=env.str("DATABASE_URL"))
)
DATABASES["direct"]["CONN_MAX_AGE"] = 0
DATABASES["direct"]["DISABLE_SERVER_SIDE_CURSORS"] = False

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 8},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- REST framework -----------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_PAGINATION_CLASS": "core.pagination.DefaultPagination",
    "PAGE_SIZE": 20,
    "EXCEPTION_HANDLER": "core.errors.exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
    # --- Rate limiting ---------------------------------------------------
    # There was none, which made `POST /auth/login` an unmetered password
    # oracle: an attacker could try a stolen credential list at whatever rate
    # the network allowed, and nothing in the stack would notice.
    #
    # `anon` is keyed on client IP and `user` on the authenticated user id, so
    # one abusive visitor cannot spend everybody's budget. The scoped rates
    # below are the ones that actually matter, and each is set from what the
    # endpoint COSTS rather than from a house number:
    #
    # - `auth`      credential-guessing surface. Deliberately the tightest
    #               thing here; a human signing in never approaches it.
    # - `otp`       every request sends a real SMS that costs real money, so
    #               this one is as much a spend limit as a security control.
    # - `webhook`   Razorpay retries a failed delivery, so this must sit well
    #               above their retry schedule — it is a flood ceiling, not a
    #               throttle on normal traffic. Signature verification is the
    #               real gate; this only stops an unsigned flood reaching it.
    # - `checkin`   a gate scans fast during a rush. High on purpose: denying
    #               a real scan is worse than absorbing a fake one, which the
    #               per-ticket row lock already makes harmless.
    # - `upload`    bytes, virus-scanning-shaped work, and storage cost.
    # - `write`     the general authenticated write budget.
    #
    # The store is the same Redis every other cache uses, so limits hold
    # across every process rather than per-container (a per-process limiter
    # multiplies its own ceiling by the replica count, which is how a limit
    # that reads as 5/min silently becomes 50/min).
    "DEFAULT_THROTTLE_CLASSES": (
        "core.throttling.BurstAnonThrottle",
        "core.throttling.BurstUserThrottle",
    ),
    # MUST be inside REST_FRAMEWORK, not a top-level Django setting: DRF reads
    # it via `api_settings.NUM_PROXIES`, so a module-level assignment is
    # silently ignored — and the fallback branch keys on the WHOLE
    # X-Forwarded-For, which is client-supplied. Anyone could then rotate their
    # own rate-limit key by varying the header, which is the exact attack the
    # setting exists to prevent. It must equal the number of proxies that
    # PREPEND to that header in front of this app (a CDN plus a load balancer
    # is 2); 0 means "trust REMOTE_ADDR only".
    "NUM_PROXIES": env.int("NUM_PROXIES", default=0),
    "DEFAULT_THROTTLE_RATES": {
        "anon": env.str("THROTTLE_ANON", default="120/min"),
        "user": env.str("THROTTLE_USER", default="600/min"),
        "auth": env.str("THROTTLE_AUTH", default="10/min"),
        "otp": env.str("THROTTLE_OTP", default="5/hour"),
        "webhook": env.str("THROTTLE_WEBHOOK", default="600/min"),
        "checkin": env.str("THROTTLE_CHECKIN", default="1200/min"),
        "upload": env.str("THROTTLE_UPLOAD", default="60/hour"),
        "write": env.str("THROTTLE_WRITE", default="120/min"),
        # Every Maps call costs money at Google. This is a SPEND limit as much
        # as an abuse control, and it is per-user rather than global so one
        # organizer typing in the venue picker cannot exhaust everyone's.
        "maps": env.str("THROTTLE_MAPS", default="120/min"),
    },
}

# A MODULE-LEVEL setting, not only a key inside SIMPLE_JWT below.
#
# It used to exist only as `SIMPLE_JWT["SIGNING_KEY"]`, which worked for
# authentication and broke the deploy gate: `core/preflight.py` validates the
# three required secrets with `getattr(settings, name)`, so it read `""` for
# this one no matter what was configured and reported "JWT_SIGNING_KEY is not
# set" on every production boot. The gate could never pass — and worse, the
# length and placeholder checks for the key that signs every session token had
# never actually run against a real value.
#
# The preflight tests did not catch it because they exercise a hand-built
# settings double that sets the attribute directly. `test_settings_shape.py`
# now asserts against the REAL settings module instead.
JWT_SIGNING_KEY = env.str("JWT_SIGNING_KEY")

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env.int("ACCESS_TOKEN_LIFETIME_MIN", default=15)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env.int("REFRESH_TOKEN_LIFETIME_DAYS", default=30)),
    "SIGNING_KEY": JWT_SIGNING_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Event & Experience Platform API",
    "DESCRIPTION": "Ticketing & experience platform — public REST API.",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])

# `Idempotency-Key` MUST be here. `POST /bookings` documents it and dedupes on
# `(user, key)`, but django-cors-headers' defaults don't include it — and a
# browser will not send a header the preflight didn't allow, so from any
# cross-origin frontend the request never leaves at all. It fails looking like a
# network error, not a CORS one, which makes it expensive to find: the booking
# simply never reaches the server that was built to deduplicate it.
CORS_ALLOW_HEADERS = (*default_cors_headers, "idempotency-key")

# --- Vendor selection (ports & adapters) --------------------------------
# These switches are the ONLY thing config/di.py needs to decide which
# adapter to build for each port. Real credentials below are only ever read
# by the matching real adapter; local/fake adapters ignore them entirely.
PAYMENTS_BACKEND = env.str("PAYMENTS_BACKEND", default="fake")
STORAGE_BACKEND = env.str("STORAGE_BACKEND", default="local")
QUEUE_BACKEND = env.str("QUEUE_BACKEND", default="local")
EVENT_BUS_BACKEND = env.str("EVENT_BUS_BACKEND", default="inprocess")
EMAIL_PROVIDER = env.str("EMAIL_PROVIDER", default="console")
SMS_PROVIDER = env.str("SMS_PROVIDER", default="console")
CACHE_BACKEND = env.str("CACHE_BACKEND", default="redis")

REDIS_URL = env.str("REDIS_URL", default="redis://localhost:6379/0")

# Django's own cache framework. The application's caching goes through
# `CachePort` and never touches this — the ONE thing that needs it is DRF's
# throttling, which has no port and reads `caches["default"]` directly.
#
# It has to be Redis for the same reason the throttles have to be shared: the
# default LocMemCache is per-process, so with N replicas every limit is
# silently N times what it says and resets on each deploy. It follows the same
# CACHE_BACKEND switch as CachePort so the test suite stays hermetic rather
# than needing a Redis to assert a rate limit.
if CACHE_BACKEND == "redis":
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": REDIS_URL,
            "KEY_PREFIX": "throttle",
        }
    }
else:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


# Razorpay
RAZORPAY_KEY_ID = env.str("RAZORPAY_KEY_ID", default="")
RAZORPAY_KEY_SECRET = env.str("RAZORPAY_KEY_SECRET", default="")
RAZORPAY_WEBHOOK_SECRET = env.str("RAZORPAY_WEBHOOK_SECRET", default="")
# Platform's per-ticket fee, in MINOR units (paise) — kept integer like every
# other money value. The organizer receives (total - platform_fee) at
# settlement; the platform never holds their funds beyond that split.
PLATFORM_FEE_PER_TICKET = env.int("PLATFORM_FEE_PER_TICKET", default=10)

# Booking hold window: how long a reservation is held awaiting payment before
# the sweeper auto-releases it. Short, so unpaid holds don't starve inventory.
BOOKING_HOLD_MINUTES = env.int("BOOKING_HOLD_MINUTES", default=10)

# --- Payment reconciliation (payments.reconcile_pending) ------------------
# The job that asks the provider "was this booking's order actually paid?",
# so fulfilment never depends on the customer's browser completing a call.
#
# MIN_AGE: how long a booking must have existed before it is asked about. The
# browser's own verify call fires within a second of the payment; asking before
# that has had a chance is a provider call spent to learn nothing.
PAYMENT_RECONCILE_MIN_AGE_SECONDS = env.int("PAYMENT_RECONCILE_MIN_AGE_SECONDS", default=90)
# GRACE: how long after a hold lapsed the platform keeps asking. A captured
# payment found in here is REFUNDED (the tickets are gone), which is the whole
# point — without it, "paid, no ticket, no refund" is a permanent state. It is
# bounded because every abandoned checkout leaves an order id behind, and an
# unbounded window means a provider call per abandoned checkout, forever.
PAYMENT_RECONCILE_GRACE_MINUTES = env.int("PAYMENT_RECONCILE_GRACE_MINUTES", default=180)
# Server secret for signing ticket QR tokens (HMAC). Rotatable independently
# of SECRET_KEY. checkin verifies tokens with this same key.
TICKET_QR_SIGNING_KEY = env.str("TICKET_QR_SIGNING_KEY", default="")

# Check-in scan window: a ticket may be scanned from this many minutes BEFORE
# the event starts until this many minutes AFTER it ends (or after it starts,
# if no end time is set). A scan well outside the window is denied — a ticket
# can't be used days early or long after the event.
CHECKIN_WINDOW_OPENS_BEFORE_MINUTES = env.int("CHECKIN_WINDOW_OPENS_BEFORE_MINUTES", default=180)
CHECKIN_WINDOW_GRACE_AFTER_MINUTES = env.int("CHECKIN_WINDOW_GRACE_AFTER_MINUTES", default=360)

# --- Google Maps Platform ------------------------------------------------
# ONE key for every Maps service (Places, Geocoding, Directions, Distance
# Matrix, Places Photos). That is Google's own model — a key is enabled
# per-API in the Cloud console — and one key is one quota, one bill and one
# rotation. Blank disables Maps: the port reports itself unconfigured, the
# endpoints answer 503, and the UI falls back to a plain address plus a
# directions link rather than an empty grey map.
#
# The BROWSER uses NEXT_PUBLIC_GOOGLE_MAPS_API_KEY for the Maps JavaScript
# API. Same key value, restricted by HTTP referrer in the console. Everything
# else goes through this server so the key is never in a page source.
GOOGLE_MAPS_API_KEY = env.str("GOOGLE_MAPS_API_KEY", default="")
# Biases geocoding and autocomplete toward a country. `in` for India.
GOOGLE_MAPS_REGION = env.str("GOOGLE_MAPS_REGION", default="")

# --- Google OAuth (Calendar) ---------------------------------------------
# ONE OAuth client, reused by every Google feature. Calendar asks for its own
# scopes on top; a second client would mean a second consent screen and a
# second verification review for the same application.
GOOGLE_OAUTH_CLIENT_ID = env.str("GOOGLE_OAUTH_CLIENT_ID", default="")
GOOGLE_OAUTH_CLIENT_SECRET = env.str("GOOGLE_OAUTH_CLIENT_SECRET", default="")
# Must match an Authorized redirect URI in the Google console VERBATIM.
GOOGLE_OAUTH_REDIRECT_URI = env.str("GOOGLE_OAUTH_REDIRECT_URI", default="")
# Sign-in returns to its OWN callback, because that callback does something
# entirely different from the calendar one: it mints an Curatix session
# rather than storing a grant. Same OAuth client (Google issues one per
# application) — a client may register many redirect URIs, and both must be
# listed verbatim in the console.
GOOGLE_OAUTH_SIGNIN_REDIRECT_URI = env.str("GOOGLE_OAUTH_SIGNIN_REDIRECT_URI", default="")

# Email (SMTP). `EMAIL_PROVIDER=console` in dev/test; `smtp` in production.
# SMTP_USE_TLS and SMTP_USE_SSL are MUTUALLY EXCLUSIVE — 587 is STARTTLS,
# 465 is implicit TLS. The adapter refuses both at construction rather than
# letting Django raise lazily on the first ticket somebody buys.
SMTP_HOST = env.str("SMTP_HOST", default="")
SMTP_PORT = env.int("SMTP_PORT", default=587)
SMTP_USERNAME = env.str("SMTP_USERNAME", default="")
SMTP_PASSWORD = env.str("SMTP_PASSWORD", default="")
SMTP_FROM_EMAIL = env.str("SMTP_FROM_EMAIL", default="")
SMTP_USE_TLS = env.bool("SMTP_USE_TLS", default=True)
SMTP_USE_SSL = env.bool("SMTP_USE_SSL", default=False)
# Without a timeout a wedged relay hangs the worker forever, so the
# notification is neither sent nor retried — it just stops.
SMTP_TIMEOUT_SECONDS = env.int("SMTP_TIMEOUT_SECONDS", default=10)

# SMS (+ India DLT)
SMS_API_KEY = env.str("SMS_API_KEY", default="")
SMS_SENDER_ID = env.str("SMS_SENDER_ID", default="")
SMS_DLT_ENTITY_ID = env.str("SMS_DLT_ENTITY_ID", default="")
SMS_DLT_TEMPLATE_ID = env.str("SMS_DLT_TEMPLATE_ID", default="")
SMS_API_BASE_URL = env.str("SMS_API_BASE_URL", default="")

# Notifications
# Per-notification-type India DLT template ids ("type=template_id,..."). Each
# SMS type has its OWN DLT-approved template in production; every type not
# listed here falls back to the single SMS_DLT_TEMPLATE_ID above.
NOTIFICATION_SMS_DLT_TEMPLATE_IDS = env.dict("NOTIFICATION_SMS_DLT_TEMPLATE_IDS", default={})
# Delivery reliability: retry a failed send up to this many attempts with
# exponential backoff, then dead-letter it (status=failed).
NOTIFICATION_MAX_ATTEMPTS = env.int("NOTIFICATION_MAX_ATTEMPTS", default=5)
NOTIFICATION_RETRY_BACKOFF_SECONDS = env.int("NOTIFICATION_RETRY_BACKOFF_SECONDS", default=30)
# How long before an event its reminder is scheduled to fire.
NOTIFICATION_EVENT_REMINDER_HOURS_BEFORE = env.int(
    "NOTIFICATION_EVENT_REMINDER_HOURS_BEFORE", default=24
)
# The timezone every human-readable date in an outbound message is rendered
# in. SEPARATE from TIME_ZONE above, which is UTC and must stay UTC: one is
# how the database stores an instant, the other is how a person reads it.
#
# The events are in India, so the default is IST — and the ticket PDF somebody
# carries to a gate must say the same time as the event page they bought it
# from (frontend/lib/discovery/format.ts renders Asia/Kolkata). Rendering the
# ticket in UTC put a five-and-a-half-hour error on the one artifact nobody
# can check against anything.
NOTIFICATION_DISPLAY_TIMEZONE = env.str("NOTIFICATION_DISPLAY_TIMEZONE", default="Asia/Kolkata")
# Where a "something is waiting for a human decision" alert goes: an event
# submitted for review, an organization asking to be verified, a performer
# profile waiting in the queue.
#
# A LIST because operations is a team — a shared ops mailbox and three named
# people are the same shape here, and one row per address is what the dedupe
# ledger expects.
#
# EMPTY MEANS NO ALERT IS SENT, deliberately. There is no safe default to fall
# back on: `ADMINS` is Django's crash-report list and `DEFAULT_FROM_EMAIL` is
# a sender, so mailing either would route operational alerts somewhere nobody
# chose. Unconfigured, the handler logs and skips — a submission is never
# failed because nobody set up an ops mailbox. Same refuse-rather-than-pretend
# rule as push and payments.
PLATFORM_ADMIN_EMAILS = env.list("PLATFORM_ADMIN_EMAILS", default=[])

# Settlements
# The organizer payout is released only after the event has ended AND this
# refund window has closed — so `net` is final and there's nothing to claw back.
SETTLEMENT_REFUND_WINDOW_HOURS = env.int("SETTLEMENT_REFUND_WINDOW_HOURS", default=48)
# Payout reliability: retry a failed release up to this many attempts with
# exponential backoff, then dead-letter it (status=failed; still owed).
SETTLEMENT_MAX_ATTEMPTS = env.int("SETTLEMENT_MAX_ATTEMPTS", default=5)
SETTLEMENT_RETRY_BACKOFF_SECONDS = env.int("SETTLEMENT_RETRY_BACKOFF_SECONDS", default=60)

# S3-compatible object storage — Supabase Storage, Cloudflare R2, AWS S3 or
# MinIO. One adapter serves all four; only the endpoint differs. Required when
# STORAGE_BACKEND=s3, which is the production answer now that `local` is
# refused (uploads on a container filesystem vanish on redeploy).
S3_BUCKET_NAME = env.str("S3_BUCKET_NAME", default="")
S3_ENDPOINT_URL = env.str("S3_ENDPOINT_URL", default="")
S3_ACCESS_KEY_ID = env.str("S3_ACCESS_KEY_ID", default="")
S3_SECRET_ACCESS_KEY = env.str("S3_SECRET_ACCESS_KEY", default="")
S3_REGION = env.str("S3_REGION", default="auto")
# Where a BROWSER fetches objects from — normally a CDN in front of the
# bucket. Blank falls back to the bucket endpoint, which works but pays
# origin egress on every view.
S3_PUBLIC_BASE_URL = env.str("S3_PUBLIC_BASE_URL", default="")

# Google Cloud
GCP_PROJECT_ID = env.str("GCP_PROJECT_ID", default="")
GCS_BUCKET_NAME = env.str("GCS_BUCKET_NAME", default="")
GOOGLE_APPLICATION_CREDENTIALS = env.str("GOOGLE_APPLICATION_CREDENTIALS", default="")
PUBSUB_TOPIC_EVENTS = env.str("PUBSUB_TOPIC_EVENTS", default="platform-events")
CLOUD_TASKS_QUEUE = env.str("CLOUD_TASKS_QUEUE", default="default-queue")
CLOUD_TASKS_LOCATION = env.str("CLOUD_TASKS_LOCATION", default="")
# The absolute URL Cloud Tasks POSTs each task to — this service's own
# `/internal/tasks/run` (see core/task_dispatch.py). It is a full URL rather
# than a path because the queue is outside the app and has no notion of "here".
CLOUD_TASKS_TARGET_URL = env.str("CLOUD_TASKS_TARGET_URL", default="")
# Shared secret proving a task-dispatch request really came from our queue.
# The endpoint runs registered task handlers, so an unauthenticated one would
# let anyone on the internet trigger a payout release.
INTERNAL_TASK_SECRET = env.str("INTERNAL_TASK_SECRET", default="")
# Optional second factor: the queue's service account, so Cloud Tasks attaches
# a Google-signed OIDC token Cloud Run can verify before Django is reached.
CLOUD_TASKS_SERVICE_ACCOUNT = env.str("CLOUD_TASKS_SERVICE_ACCOUNT", default="")

# --- Web Push (VAPID) ----------------------------------------------------
# Self-generated, NOT vendor-issued: `python -m manage generate_vapid_keys`
# prints a fresh pair. Both empty (the default) means push is off — the port
# reports itself unconfigured, no subscription endpoint accepts a save, and
# the UI says push is unavailable rather than asking for permission it cannot
# honour. See REAL_INTEGRATIONS_AUDIT.md.
VAPID_PUBLIC_KEY = env.str("VAPID_PUBLIC_KEY", default="")
VAPID_PRIVATE_KEY = env.str("VAPID_PRIVATE_KEY", default="")
# The `mailto:` or https contact a push service can reach you at when a send
# misbehaves. Required by the VAPID spec; browsers reject a claim without it.
VAPID_CONTACT = env.str("VAPID_CONTACT", default="")
PUSH_BACKEND = env.str("PUSH_BACKEND", default="webpush")
# The public origin of the FRONTEND, used to build deep links that leave the
# backend — a push notification's tap target, and any absolute URL in an
# email. Blank means "omit the link" rather than "guess": a notification
# pointing at the wrong host is worse than one with no link at all.
PUBLIC_SITE_URL = env.str("PUBLIC_SITE_URL", default="").rstrip("/")

# --- Error reporting -----------------------------------------------------
# Unset means "log only". Setting it turns on Sentry with no code change;
# nothing else in the codebase imports the SDK. Errors are still logged
# either way, so this is reporting, never the only record.
SENTRY_DSN = env.str("SENTRY_DSN", default="")
SENTRY_TRACES_SAMPLE_RATE = env.float("SENTRY_TRACES_SAMPLE_RATE", default=0.0)
SENTRY_RELEASE = env.str("SENTRY_RELEASE", default="")

# --- Logging -------------------------------------------------------------
from core.logging import build_logging_config  # noqa: E402

LOGGING = build_logging_config(debug=DEBUG)
