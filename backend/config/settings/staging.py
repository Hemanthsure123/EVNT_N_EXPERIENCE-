import sys

from .base import *  # noqa: F403

DEBUG = False

SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"

CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])  # noqa: F405

# `strict=False`: staging is ALLOWED to run a fake adapter — exercising the
# booking funnel without moving money is exactly what it is for — so those are
# warnings here. The SECRET checks stay fatal, because the moment a real person
# signs in to staging it holds real credentials, and the shipped signing key
# would let anyone with this repository forge their session.
from core.preflight import check_production_settings  # noqa: E402

check_production_settings(sys.modules[__name__], strict=False, expected_environment="staging")

from core.observability import init_error_reporting  # noqa: E402

init_error_reporting(
    dsn=SENTRY_DSN,  # noqa: F405
    environment=ENVIRONMENT,  # noqa: F405
    release=SENTRY_RELEASE,  # noqa: F405
    traces_sample_rate=SENTRY_TRACES_SAMPLE_RATE,  # noqa: F405
)
