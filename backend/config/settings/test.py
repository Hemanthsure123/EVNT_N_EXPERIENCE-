"""Settings used by pytest. Always fakes every external vendor, no matter what
.env says, so the test suite is deterministic, hermetic and needs zero
credentials."""

from .base import *  # noqa: F403

DEBUG = False

# pytest-django creates a throwaway "test_<dbname>" database on the fly —
# a transaction-mode pooler (PgBouncer locally, Neon's pooled endpoint in
# CI-against-staging scenarios) only knows how to route to databases in its
# static list, so it can't reach a database that didn't exist yet when it
# started. Tests always go straight to Postgres via the direct connection
# string, bypassing the pooler entirely (falls back to DATABASE_URL when
# DIRECT_DATABASE_URL isn't set, e.g. in CI, which has no pooler at all).
_direct_db_url_default = env.str("DATABASE_URL")
DATABASES["default"] = env.db_url("DIRECT_DATABASE_URL", default=_direct_db_url_default)
DATABASES["default"]["CONN_MAX_AGE"] = 0
DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = False

PAYMENTS_BACKEND = "fake"
STORAGE_BACKEND = "local"
QUEUE_BACKEND = "local"
EVENT_BUS_BACKEND = "inprocess"
EMAIL_PROVIDER = "console"
SMS_PROVIDER = "console"
CACHE_BACKEND = "locmem"

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
