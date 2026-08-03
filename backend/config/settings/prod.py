import sys

from .base import *  # noqa: F403

DEBUG = False

SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
# Referrers leak URLs to third parties. Event, booking and ticket URLs carry
# ids meant to be unguessable, so the full path must not travel cross-origin.
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"

# Only /admin/ and the browsable schema use cookie auth and therefore CSRF.
# The API is Bearer-token authenticated, so no cookie authorises it and there
# is nothing for a cross-site form post to ride on.
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])  # noqa: F405

if not env.list("ALLOWED_HOSTS", default=[]):  # noqa: F405
    raise RuntimeError("ALLOWED_HOSTS must be set explicitly in production")

# The deploy gate. It RAISES rather than warns, because a process that boots on
# the fake payment adapter looks healthy to a rollout controller — which will
# then cheerfully replace the working instances with it. See core/preflight.py.
from core.preflight import check_production_settings  # noqa: E402

check_production_settings(sys.modules[__name__], strict=True, expected_environment="production")

from core.observability import init_error_reporting  # noqa: E402

init_error_reporting(
    dsn=SENTRY_DSN,  # noqa: F405
    environment=ENVIRONMENT,  # noqa: F405
    release=SENTRY_RELEASE,  # noqa: F405
    traces_sample_rate=SENTRY_TRACES_SAMPLE_RATE,  # noqa: F405
)
