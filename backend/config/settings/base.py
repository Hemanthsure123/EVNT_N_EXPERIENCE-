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
# Neon's pooled endpoint in staging/prod): server-side cursors need session
# affinity that transaction pooling doesn't provide, and Django shouldn't
# hold its own long-lived connections on top of an external pool. sslmode
# (e.g. ?sslmode=require) travels inside DATABASE_URL itself and is parsed
# straight into OPTIONS by django-environ.
DATABASES = {"default": env.db_url("DATABASE_URL")}
DATABASES["default"]["CONN_MAX_AGE"] = env.int("CONN_MAX_AGE", default=60)
DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = env.bool(
    "DISABLE_SERVER_SIDE_CURSORS", default=False
)

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
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env.int("ACCESS_TOKEN_LIFETIME_MIN", default=15)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env.int("REFRESH_TOKEN_LIFETIME_DAYS", default=30)),
    "SIGNING_KEY": env.str("JWT_SIGNING_KEY"),
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

# Razorpay
RAZORPAY_KEY_ID = env.str("RAZORPAY_KEY_ID", default="")
RAZORPAY_KEY_SECRET = env.str("RAZORPAY_KEY_SECRET", default="")
RAZORPAY_WEBHOOK_SECRET = env.str("RAZORPAY_WEBHOOK_SECRET", default="")
RAZORPAY_ROUTE_ENABLED = env.bool("RAZORPAY_ROUTE_ENABLED", default=True)
# Platform's per-ticket fee, in MINOR units (paise) — kept integer like every
# other money value. The organizer receives (total - platform_fee) at
# settlement; the platform never holds their funds beyond that split.
PLATFORM_FEE_PER_TICKET = env.int("PLATFORM_FEE_PER_TICKET", default=10)

# Booking hold window: how long a reservation is held awaiting payment before
# the sweeper auto-releases it. Short, so unpaid holds don't starve inventory.
BOOKING_HOLD_MINUTES = env.int("BOOKING_HOLD_MINUTES", default=10)
# Server secret for signing ticket QR tokens (HMAC). Rotatable independently
# of SECRET_KEY. checkin verifies tokens with this same key.
TICKET_QR_SIGNING_KEY = env.str("TICKET_QR_SIGNING_KEY", default="")

# Check-in scan window: a ticket may be scanned from this many minutes BEFORE
# the event starts until this many minutes AFTER it ends (or after it starts,
# if no end time is set). A scan well outside the window is denied — a ticket
# can't be used days early or long after the event.
CHECKIN_WINDOW_OPENS_BEFORE_MINUTES = env.int("CHECKIN_WINDOW_OPENS_BEFORE_MINUTES", default=180)
CHECKIN_WINDOW_GRACE_AFTER_MINUTES = env.int("CHECKIN_WINDOW_GRACE_AFTER_MINUTES", default=360)

# Google OAuth
GOOGLE_OAUTH_CLIENT_ID = env.str("GOOGLE_OAUTH_CLIENT_ID", default="")
GOOGLE_OAUTH_CLIENT_SECRET = env.str("GOOGLE_OAUTH_CLIENT_SECRET", default="")
GOOGLE_OAUTH_REDIRECT_URI = env.str("GOOGLE_OAUTH_REDIRECT_URI", default="")

# Email
EMAIL_API_KEY = env.str("EMAIL_API_KEY", default="")
EMAIL_FROM = env.str("EMAIL_FROM", default="tickets@example.com")
EMAIL_API_BASE_URL = env.str("EMAIL_API_BASE_URL", default="")

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

# Google Cloud
GCP_PROJECT_ID = env.str("GCP_PROJECT_ID", default="")
GCS_BUCKET_NAME = env.str("GCS_BUCKET_NAME", default="")
GOOGLE_APPLICATION_CREDENTIALS = env.str("GOOGLE_APPLICATION_CREDENTIALS", default="")
PUBSUB_TOPIC_EVENTS = env.str("PUBSUB_TOPIC_EVENTS", default="platform-events")
CLOUD_TASKS_QUEUE = env.str("CLOUD_TASKS_QUEUE", default="default-queue")
CLOUD_TASKS_LOCATION = env.str("CLOUD_TASKS_LOCATION", default="")

# --- Logging -------------------------------------------------------------
from core.logging import build_logging_config  # noqa: E402

LOGGING = build_logging_config(debug=DEBUG)
