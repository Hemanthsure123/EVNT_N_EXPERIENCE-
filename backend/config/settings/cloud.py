"""Local process, real cloud resources — Supabase Postgres, Upstash Redis, S3.

── WHY THIS MODULE EXISTS ────────────────────────────────────────────────────

`config.settings.dev` REFUSES to boot against a non-local database, and that
refusal is correct rather than inconvenient. Development settings carry
`DEBUG=True` and `CORS_ALLOW_ALL_ORIGINS=True`; over a real database that pair
means any 500 renders `SECRET_KEY`, the database password and the Razorpay
secret to whoever triggered it, and any website can call the API with a
signed-in visitor's token. Neither half is an error alone, which is why
nothing reported the combination until `check_development_settings` was
written to.

`config.settings.staging` is the module the refusal points at, and it does not
fit either: it sets `SECURE_SSL_REDIRECT` and secure-only cookies, which assume
a TLS terminator in front. Run it on `http://localhost:8000` and every request
is redirected to an `https` port nothing is listening on.

So this is the third case, and it is a real one: **the application running on
this machine, against the same managed services production uses.** It is what
you want when the question is "does this work against Supabase", which no
amount of local Postgres can answer.

── WHAT IT KEEPS FROM PRODUCTION, AND WHAT IT DROPS ──────────────────────────

Kept, because these are what make a real database safe to point at:

  * `DEBUG = False` — the single most important line here. It is the reason
    this module can exist at all.
  * `CORS_ALLOWED_ORIGINS` from the environment, never `CORS_ALLOW_ALL_ORIGINS`.
  * The full production preflight (`strict=False`, as staging runs it), so a
    placeholder secret, a fake adapter or a missing SDK is reported here rather
    than discovered in production.

Dropped, and each has a reason that only applies to a local process:

  * `SECURE_SSL_REDIRECT` — nothing terminates TLS on localhost.
  * `SESSION_COOKIE_SECURE` / `CSRF_COOKIE_SECURE` — a secure-only cookie is
    never sent over `http://localhost`, so the Django admin could not hold a
    session and an operator could not sign in to the thing they came to use.

Those three are the ENTIRE difference from staging. That is deliberate: a
"local" settings module that quietly relaxes half a dozen production
behaviours stops being a way to test against production.

── THE COOKIE FLAGS ARE THE ONE REAL TRADE ───────────────────────────────────

An insecure-flagged cookie could be sent over a plaintext connection. Here the
connection is a loopback socket on the developer's own machine — there is no
network path to intercept — and the alternative is not "a more secure session"
but "no session at all". It is stated rather than buried because this is the
line that must NOT be copied into a deployed settings module; `prod.py` and
`staging.py` set all three and are what a deployment uses.

── ENVIRONMENT LABEL ─────────────────────────────────────────────────────────

`ENVIRONMENT=staging`. The label describes the DATA and the vendors, not where
the process runs — this connects to the same Supabase project and the same
Upstash instance as staging, so a Sentry event from here belongs in the staging
stream. Calling it `development` would file real-resource incidents where
nobody looks.
"""

import sys

from .base import *  # noqa: F403

DEBUG = False

# No SSL redirect and no secure-only cookies: see the module docstring. These
# three lines are the only relaxations, and none of them may be copied into a
# deployed settings module.
SECURE_SSL_REDIRECT = False
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

SESSION_COOKIE_HTTPONLY = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"

# The Next dev server posts to the Django admin and to CSRF-protected routes
# from another origin. Defaults cover the two spellings of localhost so this
# works with no extra configuration; `.env` can add more.
CSRF_TRUSTED_ORIGINS = env.list(  # noqa: F405
    "CSRF_TRUSTED_ORIGINS",
    default=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8000"],
)

from core.preflight import check_production_settings  # noqa: E402

# `strict=False`, exactly as staging runs it: a fake adapter here is a loud
# warning rather than a refusal, because exercising a flow without moving money
# is a legitimate reason to be on this module. The SECRET checks stay fatal —
# this process holds real user data the moment anybody signs in.
check_production_settings(sys.modules[__name__], strict=False, expected_environment="staging")

from core.observability import init_error_reporting  # noqa: E402

init_error_reporting(
    dsn=SENTRY_DSN,  # noqa: F405
    environment=ENVIRONMENT,  # noqa: F405
    release=SENTRY_RELEASE,  # noqa: F405
    traces_sample_rate=SENTRY_TRACES_SAMPLE_RATE,  # noqa: F405
)
