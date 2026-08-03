"""Settings used by pytest.

Every external vendor is faked no matter what `.env` says, so the suite is
deterministic, hermetic and needs zero credentials.

── THE DATABASE GUARD IS THE IMPORTANT PART OF THIS FILE ─────────────────

pytest-django CREATES and DROPS a `test_<dbname>` database. That is harmless
against a local Postgres and catastrophic against a production one, and the
path to the second was one unset environment variable: `DIRECT_DATABASE_URL`
falls back to `.env`, and `.env` now holds a live Supabase URL. Running
`pytest` would have created and dropped a database on the production
instance.

Nothing in Django or pytest prevents that, so `_refuse_non_local_database`
below does. It is a deny-by-default host allow-list, overridable only by an
explicit `ALLOW_REMOTE_TEST_DATABASE=1` for the rare CI that genuinely runs
against a managed database it owns.
"""

from .base import *  # noqa: F403

DEBUG = False

# Hosts a test run may create and drop databases on. Loopback, the compose
# service names, and nothing else — anything reachable over the internet is
# somebody's real data until proven otherwise.
_LOCAL_DB_HOSTS = frozenset(
    {"", "localhost", "127.0.0.1", "::1", "postgres", "pgbouncer", "db", "host.docker.internal"}
)


def _refuse_non_local_database(config: dict) -> dict:
    """Stop the test suite before it touches a database it does not own.

    Raises at IMPORT time — before pytest-django connects, before it issues
    `CREATE DATABASE`, and therefore before anything irreversible.
    """
    host = str(config.get("HOST", ""))
    if host in _LOCAL_DB_HOSTS:
        return config
    if env.bool("ALLOW_REMOTE_TEST_DATABASE", default=False):
        # Deliberate, explicit, and logged by being visible in the config.
        return config
    raise RuntimeError(
        "REFUSING TO RUN TESTS AGAINST A NON-LOCAL DATABASE.\n\n"
        f"  resolved test database host: {host}\n\n"
        "pytest-django CREATES and DROPS a `test_<dbname>` database. Against a\n"
        "managed instance that is destructive and irreversible.\n\n"
        "This normally means DIRECT_DATABASE_URL fell through to .env, which\n"
        "holds production credentials. Point it at a local database:\n\n"
        "  DIRECT_DATABASE_URL=postgres://app:app@postgres:5432/eventsdb\n\n"
        "If this really is a disposable database you own, set\n"
        "ALLOW_REMOTE_TEST_DATABASE=1."
    )


# pytest-django creates a throwaway `test_<dbname>` on the fly, and a
# TRANSACTION-mode pooler (PgBouncer locally, Supavisor on 6543 in prod)
# cannot create or route to a database that did not exist when it started.
# So tests use the DIRECT/session connection. Falls back to DATABASE_URL when
# unset — e.g. CI, which has no pooler in front of Postgres at all.
DATABASES["default"] = _refuse_non_local_database(
    env.db_url("DIRECT_DATABASE_URL", default=env.str("DATABASE_URL"))
)
DATABASES["default"]["CONN_MAX_AGE"] = 0
DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = False

# `migrate_safe` resolves the `direct` alias; in tests both must point at the
# same throwaway database or a migration test would target the real one.
DATABASES["direct"] = DATABASES["default"]

PAYMENTS_BACKEND = "fake"
STORAGE_BACKEND = "local"
QUEUE_BACKEND = "local"
EVENT_BUS_BACKEND = "inprocess"
EMAIL_PROVIDER = "console"
SMS_PROVIDER = "console"
CACHE_BACKEND = "locmem"

# Vendor credentials are blanked so a test can never reach a real service even
# if a fixture selects a real adapter by mistake. `.env` holds LIVE Razorpay
# and Google keys; without this, one `settings.PAYMENTS_BACKEND = "razorpay"`
# in a test would put them on the wire.
RAZORPAY_KEY_ID = ""
RAZORPAY_KEY_SECRET = ""
GOOGLE_MAPS_API_KEY = ""
GOOGLE_OAUTH_CLIENT_ID = ""
GOOGLE_OAUTH_CLIENT_SECRET = ""
VAPID_PUBLIC_KEY = ""
VAPID_PRIVATE_KEY = ""
SENTRY_DSN = ""
SMTP_HOST = ""
SMTP_PASSWORD = ""

# No operator mailbox, whatever `.env` holds. The approval alerts subscribe to
# events other modules publish (an event submitted for review, a performer
# submitted), so a developer who configures a real ops address locally would
# otherwise add a render + claim + send to those modules' tests — silently
# breaking the `django_assert_num_queries` budgets that guard their write
# paths. A test that wants an operator sets one through the `settings` fixture.
PLATFORM_ADMIN_EMAILS = []
# Fixed, so a rendered date in an assertion cannot move with an env var.
NOTIFICATION_DISPLAY_TIMEZONE = "Asia/Kolkata"

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
