"""Refuse to start production on a placeholder.

Every other guard in this codebase protects data at runtime. This one
protects the deploy: it turns "we shipped with the fake payment adapter and
found out from a customer" into "the container never came up".

It exists because the failure mode is silent by construction. A fake
adapter, a dummy secret and a real one all satisfy the same interface — the
app boots, serves traffic, and looks healthy. `PAYMENTS_BACKEND=fake` in
production means every checkout succeeds and no money moves; the shipped
`SECRET_KEY` in production means anyone holding this repo can mint a session
cookie; the shipped `TICKET_QR_SIGNING_KEY` means anyone can forge a ticket
that passes the gate scanner. None of those raise anything on their own.

Two rules govern what belongs here:

1. **Only checks that are certainly wrong in production.** A missing
   optional integration is not an error — the app is designed to run
   without push, without Sentry, without OAuth. Those get warnings.
2. **Fail at import, not on first request.** A process that starts and then
   serves broken traffic is worse than one that never starts, because a
   rollout controller will happily replace healthy instances with it.

The check runs from `config/settings/prod.py` and `staging.py` at import
time, and from `manage.py check --deploy` via `core.apps`. It is
deliberately NOT run in dev or test — dev is meant to run on fakes, and a
test suite that needed real credentials would be a test suite nobody runs.
"""

from __future__ import annotations

import logging
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


class InsecureConfigurationError(RuntimeError):
    """Raised at startup when production config would be unsafe or fake."""


# Values shipped in `.env.example`. Any of them reaching production means the
# secrets manager was not wired up, not that somebody chose a weak secret.
SHIPPED_PLACEHOLDERS = frozenset(
    {
        "dev-secret-change-me-0000000000000000",
        "dev-jwt-signing-key-change-me-0000000000",
        "dev-qr-signing-key-change-me-000000000000",
        "rzp_test_dummy1234567890",
        "dummy_rzp_secret_0000000000000000",
        "dummy_rzp_webhook_secret_00000000",
        "dummy-sms-api-key",
    }
)

# Secrets that must be present, long enough to be worth having, and not the
# shipped example. Length matters for the two signing keys specifically:
# HMAC-SHA256 with a key shorter than its 32-byte block is a real weakening,
# and PyJWT warns about exactly this (see CLAUDE.md "Known benign quirks").
_REQUIRED_SECRETS = (
    ("SECRET_KEY", 32),
    ("JWT_SIGNING_KEY", 32),
    ("TICKET_QR_SIGNING_KEY", 32),
)

# Backend switch -> the value that means "a local fake, not a vendor".
# Each of these silently succeeds while doing nothing real.
_FAKE_BACKENDS = {
    "PAYMENTS_BACKEND": ("fake", "no money would move; every checkout would succeed for free"),
    "STORAGE_BACKEND": (
        "local",
        "uploads would go to the container's disk and vanish on the next restart",
    ),
    "EMAIL_PROVIDER": (
        "console",
        "no customer would receive a ticket, a receipt or a refund notice",
    ),
    "SMS_PROVIDER": ("console", "no OTP or booking SMS would be delivered"),
}

# Credentials each real adapter needs. Selecting the adapter without them is a
# 500 on the first send, which is to say: on the first ticket somebody buys.
_ADAPTER_CREDENTIALS = {
    ("PAYMENTS_BACKEND", "razorpay"): (
        "RAZORPAY_KEY_ID",
        "RAZORPAY_KEY_SECRET",
        "RAZORPAY_WEBHOOK_SECRET",
    ),
    ("STORAGE_BACKEND", "gcs"): ("GCP_PROJECT_ID", "GCS_BUCKET_NAME"),
    ("STORAGE_BACKEND", "s3"): (
        "S3_BUCKET_NAME",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
        "S3_ENDPOINT_URL",
    ),
    ("EMAIL_PROVIDER", "smtp"): ("SMTP_HOST", "SMTP_FROM_EMAIL"),
    ("SMS_PROVIDER", "http"): ("SMS_API_KEY", "SMS_SENDER_ID", "SMS_DLT_ENTITY_ID"),
    ("EVENT_BUS_BACKEND", "pubsub"): ("GCP_PROJECT_ID", "PUBSUB_TOPIC_EVENTS"),
    ("QUEUE_BACKEND", "cloud_tasks"): (
        "GCP_PROJECT_ID",
        "CLOUD_TASKS_QUEUE",
        "CLOUD_TASKS_LOCATION",
        "CLOUD_TASKS_TARGET_URL",
        "INTERNAL_TASK_SECRET",
    ),
}


# ── RUNTIME DEPENDENCIES ─────────────────────────────────────────────────
#
# Every vendor SDK lives behind an optional extra and `config/di.py` imports
# it LAZILY, so a missing package produces no build error, no import error and
# no boot error. It produces a ModuleNotFoundError on the first REQUEST — and
# for `PAYMENTS_BACKEND=razorpay` that request is somebody's first checkout.
#
# This table pairs each selected backend with the module that must be
# importable for it to work, so the mismatch stops the container instead.
#
# WHEN YOU ADD A BACKEND THAT NEEDS AN SDK, ADD IT HERE and to the
# INSTALL_EXTRAS build arg in backend/Dockerfile.
_ADAPTER_MODULES: dict[tuple[str, str], tuple[str, str]] = {
    # (switch, value): (importable module, pip extra that provides it)
    ("PAYMENTS_BACKEND", "razorpay"): ("razorpay", "razorpay"),
    ("STORAGE_BACKEND", "gcs"): ("google.cloud.storage", "gcp"),
    ("STORAGE_BACKEND", "s3"): ("boto3", "s3"),
    ("EVENT_BUS_BACKEND", "pubsub"): ("google.cloud.pubsub_v1", "gcp"),
    ("QUEUE_BACKEND", "cloud_tasks"): ("google.cloud.tasks_v2", "gcp"),
}

# Features switched on by a CREDENTIAL rather than by a backend switch, which
# still need a package to honour it.
_FEATURE_MODULES: tuple[tuple[str, str, str, str], ...] = (
    # (setting that enables it, module, pip extra, what breaks without it)
    (
        "VAPID_PRIVATE_KEY",
        "pywebpush",
        "push",
        "Web Push is configured but no notification can be delivered",
    ),
    (
        "GOOGLE_OAUTH_CLIENT_ID",
        "cryptography",
        "push",
        "OAuth refresh tokens cannot be encrypted, so connecting a calendar fails",
    ),
    (
        "SENTRY_DSN",
        "sentry_sdk",
        "observability",
        "errors are logged but never reported",
    ),
)


def _module_importable(dotted: str) -> bool:
    """Whether a module REALLY imports — by importing it.

    ── WHY THIS ACTUALLY IMPORTS, RATHER THAN ASKING `find_spec` ─────────

    It used to call `importlib.util.find_spec`, on the reasoning that a path
    lookup is cheaper than executing a vendor SDK's module body. That check
    answers the wrong question, and the difference is not theoretical:

        find_spec("razorpay")  ->  True      (the package is on disk)
        import razorpay        ->  ModuleNotFoundError: pkg_resources

    razorpay 1.4 imports `pkg_resources` at module scope, which ships with
    setuptools — and Python 3.12 images no longer install setuptools by
    default. So the gate passed, the container started, and the failure was
    waiting on the first checkout. That is precisely the class of bug this
    check exists to prevent, and it walked straight through.

    A package can be present and unimportable for several ordinary reasons: a
    missing transitive dependency, a C extension built for another Python, a
    partially-written install. Only an import distinguishes them.

    The cost argument does not survive contact either. Every module checked
    here belongs to a SELECTED backend or a CONFIGURED credential, so it will
    be imported within the first few requests anyway — doing it at boot is
    strictly earlier, not extra, and it converts a 500 for a paying customer
    into a container that refuses to start.
    """
    import importlib

    try:
        importlib.import_module(dotted)
        return True
    except Exception:
        # Deliberately broad. A module body can raise anything at all — an
        # ImportError for a missing dependency, an OSError for a missing
        # shared library, a RuntimeError from an SDK that dislikes its
        # environment. Every one of them means "this cannot be used", which is
        # the only thing the caller needs to know.
        return False


def _check_runtime_dependencies(settings: object, problems: list[str]) -> None:
    for (switch, value), (module, extra) in _ADAPTER_MODULES.items():
        if str(getattr(settings, switch, "")) != value:
            continue
        if not _module_importable(module):
            # Fatal: the backend is selected, so the code path WILL be taken.
            problems.append(
                f"{switch}={value} is selected but the module {module!r} is not "
                f"installed. Add the {extra!r} extra to the image "
                f"(INSTALL_EXTRAS in backend/Dockerfile)."
            )

    for setting, module, extra, consequence in _FEATURE_MODULES:
        if not getattr(settings, setting, ""):
            continue
        if not _module_importable(module):
            # Fatal too, deliberately: a credential is configured, so somebody
            # expects the feature to work. Degrading quietly is how a platform
            # runs for a month with push "on" and nothing ever delivered.
            problems.append(
                f"{setting} is set but the module {module!r} is not installed, so "
                f"{consequence}. Add the {extra!r} extra to the image."
            )


# The service names `docker-compose.override.yml` points the app at. If
# production resolves one of these, the development override is loaded.
_COMPOSE_SERVICE_HOSTS = frozenset({"postgres", "pgbouncer", "redis", "db"})


def _check_not_development_infrastructure(settings: object, problems: list[str]) -> None:
    """Production must not be running against the development containers.

    Compose loads `docker-compose.override.yml` AUTOMATICALLY when the file is
    present. On a production host that silently reinstates the worst bug the
    readiness audit found: the process holds real Supabase, Upstash and
    Razorpay credentials while every read and write goes to an empty container
    — and nothing reports it, because both configurations are internally valid.

    `DEPLOYMENT.md` says to remove the override on a deployed host. That is a
    manual step, and a manual step is not a guard, so this is the guard.

    It matches the compose SERVICE NAMES specifically rather than any local
    address: a self-hosted deployment with Postgres on `127.0.0.1` is a
    legitimate topology and stays allowed. Resolving the literal host
    `pgbouncer` is not a topology, it is an accident.
    """
    databases = getattr(settings, "DATABASES", {}) or {}
    for alias in ("default", "direct"):
        host = str((databases.get(alias) or {}).get("HOST", ""))
        if host in _COMPOSE_SERVICE_HOSTS:
            problems.append(
                f"DATABASES['{alias}'] resolves to '{host}', which is a "
                f"docker-compose.override.yml service. That file is loaded "
                f"automatically when present, so this process holds production "
                f"credentials while reading and writing an empty container "
                f"database. Remove docker-compose.override.yml from this host and "
                f"deploy with: docker compose -f docker-compose.yml up -d"
            )
            break

    redis_url = str(getattr(settings, "REDIS_URL", "") or "")
    if redis_url:
        host = urlparse(redis_url).hostname or ""
        if host in _COMPOSE_SERVICE_HOSTS:
            problems.append(
                f"REDIS_URL resolves to '{host}', a docker-compose.override.yml "
                f"service. Same cause as the database above."
            )
        if "ssl_cert_reqs=none" in redis_url:
            problems.append(
                "REDIS_URL carries ssl_cert_reqs=none, which DISABLES TLS certificate "
                "verification. It exists only for the self-signed certificate in local "
                "development; a managed endpoint's certificate is CA-signed. Drop the "
                "query parameter."
            )


def _check_public_urls(settings: object, problems: list[str], warnings: list[str]) -> None:
    """Localhost in a production URL is a silent, total failure.

    Each of these is followed by somebody else: an OAuth redirect Google must
    match verbatim, a calendar deep link, a CORS allow-list. A leftover
    localhost does not error — it simply never works, and the symptom appears
    at Google's end rather than in our logs.
    """
    markers = ("localhost", "127.0.0.1", "0.0.0.0", "::1")

    def is_local(value: str) -> bool:
        return any(marker in value for marker in markers)

    for name in ("PUBLIC_SITE_URL", "GOOGLE_OAUTH_REDIRECT_URI", "CLOUD_TASKS_TARGET_URL"):
        value = str(getattr(settings, name, "") or "")
        if not value:
            continue
        if is_local(value):
            problems.append(
                f"{name} points at localhost ({value}). In production this must be the "
                f"public URL that clients and Google actually reach."
            )
        elif value.startswith("http://"):
            problems.append(
                f"{name} is http ({value}). OAuth redirect URIs and deep links must be "
                f"https in production."
            )

    # An EMPTY ALLOWED_HOSTS is refused elsewhere. A localhost-ONLY one was
    # not, and is just as total: Django answers every request for the real
    # domain with 400 DisallowedHost. The deployment looks healthy from inside
    # the container and is unreachable from outside it.
    hosts = [str(h) for h in (getattr(settings, "ALLOWED_HOSTS", []) or [])]
    if hosts and all(is_local(host) for host in hosts):
        problems.append(
            f"ALLOWED_HOSTS contains only local names ({hosts}). Django would answer "
            f"400 DisallowedHost for every request to the real domain. Set it to the "
            f"public hostname(s) this API answers on."
        )

    origins = list(getattr(settings, "CORS_ALLOWED_ORIGINS", []) or [])
    if origins and all(is_local(origin) for origin in origins):
        problems.append(
            "CORS_ALLOWED_ORIGINS contains only localhost origins, so no deployed "
            "frontend can call this API."
        )

    # Behind a proxy, DRF reads the client IP from X-Forwarded-For only when
    # NUM_PROXIES is set. At 0 it uses REMOTE_ADDR — the proxy's own address —
    # so every IP-keyed rate limit collapses into ONE global bucket, and
    # `auth: 10/min` becomes 10/min for the entire internet.
    rest = getattr(settings, "REST_FRAMEWORK", {}) or {}
    if not rest.get("NUM_PROXIES"):
        warnings.append(
            "NUM_PROXIES is 0. If anything proxies this app (a tunnel, a CDN, a load "
            "balancer) every IP-keyed rate limit is currently one shared bucket. Set it "
            "to the number of proxies that prepend to X-Forwarded-For."
        )

    if not getattr(settings, "CSRF_TRUSTED_ORIGINS", None):
        warnings.append(
            "CSRF_TRUSTED_ORIGINS is empty, so the Django admin will reject form posts "
            "over a proxied https origin. Harmless if /admin/ is not exposed."
        )

    # Gmail is a common and workable choice that has two limits worth stating
    # once, out loud, rather than discovering at 500 tickets.
    if "gmail.com" in str(getattr(settings, "SMTP_HOST", "")):
        warnings.append(
            "SMTP_HOST is Gmail: ~500 recipients/day, and Gmail rewrites the From "
            "header so SPF/DKIM cannot align to your own domain. Fine for launch, "
            "not for volume — move to a transactional provider before scaling."
        )


def _check_environment_label(settings: object, expected: str, problems: list[str]) -> None:
    """`ENVIRONMENT` and the settings module must name the same environment.

    They are set independently — one is `DJANGO_SETTINGS_MODULE`, the other is
    `ENVIRONMENT` — and nothing connected them, so a production deploy could
    carry `ENVIRONMENT=development` and behave correctly in every way except
    the ones nobody watches:

    - Every Sentry event is TAGGED with it. A production incident filed under
      `development` is filtered out of the production alert stream — the
      failure is not that alerting breaks, it is that it appears to work.
    - It is what preflight and the logs report, so an operator reading them
      is told the wrong thing while diagnosing.

    Fatal rather than a warning, and exact-match rather than a fuzzy one: the
    cost of refusing is one clear line at deploy time, and the cost of
    accepting `prod` for `production` is alerts routed to a stream that does
    not exist.
    """
    actual = str(getattr(settings, "ENVIRONMENT", "") or "")
    if actual != expected:
        problems.append(
            f"ENVIRONMENT is {actual!r} but the settings module is for {expected!r}. "
            f"Sentry tags every event with this, so production incidents would be "
            f"filed under the wrong environment and filtered out of the alerts that "
            f"page somebody. Set ENVIRONMENT={expected}."
        )


def check_production_settings(
    settings: object, *, strict: bool, expected_environment: str | None = None
) -> list[str]:
    """Return the list of warnings; raise on anything fatal.

    `strict` is True in production and False in staging. Staging is expected
    to run some fakes on purpose — that is what it is for — so there the fake
    adapters are a loud warning rather than a refusal. The secret checks are
    fatal in both: a staging environment with the repo's own signing key can
    mint tokens the production key would... not accept, in fact, but it also
    holds real user data the moment anyone signs in.

    `expected_environment` is the name the calling settings module belongs to
    ("production", "staging"). See `_check_environment_label`.
    """
    problems: list[str] = []
    warnings: list[str] = []

    if expected_environment is not None:
        _check_environment_label(settings, expected_environment, problems)

    for name, minimum_length in _REQUIRED_SECRETS:
        value = str(getattr(settings, name, "") or "")
        if not value:
            problems.append(f"{name} is not set.")
        elif value in SHIPPED_PLACEHOLDERS:
            problems.append(
                f"{name} is still the placeholder shipped in .env.example. "
                f"Anyone with this repository can forge whatever it signs."
            )
        elif len(value) < minimum_length:
            problems.append(
                f"{name} is {len(value)} characters; {minimum_length} is the minimum "
                f"(HMAC-SHA256 with a key shorter than its block size is weakened)."
            )

    if getattr(settings, "DEBUG", False):
        problems.append("DEBUG is on. It leaks settings, SQL and stack traces to anyone.")

    if not getattr(settings, "ALLOWED_HOSTS", None):
        problems.append("ALLOWED_HOSTS is empty, which accepts any Host header.")

    if not getattr(settings, "CORS_ALLOWED_ORIGINS", None) and not getattr(
        settings, "CORS_ALLOW_ALL_ORIGINS", False
    ):
        warnings.append(
            "CORS_ALLOWED_ORIGINS is empty — no browser frontend can call this API. "
            "Correct only if this deployment is server-to-server."
        )
    if getattr(settings, "CORS_ALLOW_ALL_ORIGINS", False):
        problems.append("CORS_ALLOW_ALL_ORIGINS is on, which lets any site call this API.")

    if getattr(settings, "ENABLE_SILK", False):
        problems.append(
            "ENABLE_SILK is on. The profiler records request bodies — including "
            "passwords and payment payloads — and serves them unauthenticated."
        )

    for switch, (fake_value, consequence) in _FAKE_BACKENDS.items():
        if str(getattr(settings, switch, "")) == fake_value:
            message = f"{switch}={fake_value} is a local fake: {consequence}."
            (problems if strict else warnings).append(message)

    # ── DELIBERATELY OFF IS NOT THE SAME AS ACCIDENTALLY FAKE ──────────────
    #
    # `SMS_PROVIDER=console` stays a hard refusal above: it ACCEPTS every
    # message and drops it, so logs read `sent` while no OTP is delivered.
    #
    # `disabled` is the opposite — the adapter reports it cannot deliver, and
    # `NotificationService.notify` skips SMS before claiming a log row. That is
    # a legitimate way to launch: India's DLT registration takes weeks, and a
    # platform can be ready to take money before it clears.
    #
    # It is a WARNING and not silence, because "no SMS" is a real reduction in
    # service that whoever reads this output should see stated, every boot,
    # rather than discovering it when a customer asks where their OTP went.
    # ── SUPABASE STORAGE NEEDS A REAL REGION, AND FAILS LATE WITHOUT ONE ───
    #
    # `S3_REGION` defaults to `auto`, which is correct for Cloudflare R2 and
    # wrong for Supabase: its S3 gateway validates the SigV4 credential scope
    # against the project's actual region and rejects a mismatch. Nothing
    # notices at boot — the adapter constructs fine and the health check does
    # not touch storage — so the first symptom is an organizer's image upload
    # failing in production while every other page works.
    #
    # A WARNING and not a refusal, on purpose. Storage is not on the request
    # path for any page that currently renders, so refusing to boot would
    # convert a broken upload button into a site-wide outage — a strictly
    # worse failure than the one being reported.
    if str(getattr(settings, "STORAGE_BACKEND", "")) == "s3":
        endpoint = str(getattr(settings, "S3_ENDPOINT_URL", ""))
        region = str(getattr(settings, "S3_REGION", "")).strip()
        if endpoint.rstrip("/").endswith("/storage/v1/s3") and region in ("", "auto"):
            warnings.append(
                f"S3_REGION={region or '(unset)'} with a Supabase storage endpoint. "
                "Supabase validates the SigV4 credential scope against the project's "
                "region, so uploads will fail with SignatureDoesNotMatch while every "
                "other page keeps working. Set S3_REGION to the project's region "
                "(Supabase dashboard -> Project Settings -> General). Note the name: "
                "the setting is S3_REGION, not S3_REGION_NAME."
            )

    if str(getattr(settings, "SMS_PROVIDER", "")) == "disabled":
        warnings.append(
            "SMS_PROVIDER=disabled: no OTP or booking SMS will be delivered. "
            "This is explicit, not a fake — email still sends tickets, receipts "
            "and refund notices. Set SMS_PROVIDER=http with SMS_API_KEY, "
            "SMS_SENDER_ID and SMS_DLT_ENTITY_ID to enable delivery."
        )

    for (switch, real_value), required in _ADAPTER_CREDENTIALS.items():
        if str(getattr(settings, switch, "")) != real_value:
            continue
        for credential in required:
            value = str(getattr(settings, credential, "") or "")
            if not value or value in SHIPPED_PLACEHOLDERS:
                problems.append(
                    f"{switch}={real_value} is selected but {credential} is "
                    f"{'unset' if not value else 'still the shipped placeholder'}."
                )

    # A selected backend whose SDK is missing is a 500 on the first request
    # that needs it. Caught at boot instead.
    _check_runtime_dependencies(settings, problems)

    # Localhost URLs, proxy posture and mail-provider limits. Production only:
    # staging legitimately runs on internal hostnames.
    if strict:
        _check_public_urls(settings, problems, warnings)
        _check_not_development_infrastructure(settings, problems)

    # Optional integrations. Absent is a legitimate deployment choice, so these
    # never block a boot — but a silent absence is how a platform runs for a
    # month with no error reporting and nobody notices.
    if not getattr(settings, "SENTRY_DSN", ""):
        warnings.append("SENTRY_DSN is unset — server exceptions are logged but not reported.")
    if not getattr(settings, "VAPID_PRIVATE_KEY", ""):
        warnings.append("VAPID keys are unset — Web Push is off and the UI says so.")

    if problems:
        raise InsecureConfigurationError(
            "Refusing to start: this configuration is not production-safe.\n"
            + "\n".join(f"  - {problem}" for problem in problems)
            + "\n\nSee REAL_INTEGRATIONS_AUDIT.md for what each value is and where to get it."
        )

    for warning in warnings:
        logger.warning("preflight.%s", warning)
    return warnings


# Hosts that cannot be anybody's production data. Matched exactly, so a
# hostname that merely CONTAINS "localhost" does not slip through.
LOCAL_DB_HOSTS = frozenset(
    {"", "localhost", "127.0.0.1", "::1", "postgres", "pgbouncer", "db", "host.docker.internal"}
)


def check_development_settings(settings: object) -> list[str]:
    """The other half of the gate: refuse DEVELOPMENT settings over real data.

    The production readiness audit found the exact state this prevents:
    `DJANGO_SETTINGS_MODULE=config.settings.dev` — so `DEBUG=True` and
    `CORS_ALLOW_ALL_ORIGINS=True` — pointed at the production Supabase
    instance, holding `rzp_live_` keys and a real SMTP relay.

    Nothing about that combination errors. It runs, and it looks fine:

    - `DEBUG=True` renders Django's full traceback page on any 500, which
      lists every setting — `SECRET_KEY`, `JWT_SIGNING_KEY`, the database URL
      with its password, and the Razorpay secret — to whoever triggered it.
    - `CORS_ALLOW_ALL_ORIGINS=True` lets any website on the internet call this
      API from a victim's browser with the victim's token attached.
    - `check_production_settings` is imported by prod.py and staging.py only,
      so under dev settings the deploy gate never runs at all.

    Neither half of that is a mistake on its own. Development settings are
    correct for development, and live credentials are correct for production.
    It is the PAIR that is dangerous, and the pair is what this refuses.

    There is deliberately no override flag. The fix is to use the settings
    module that matches the data — `staging` or `prod`, both of which run the
    production gate — and the refusal says so.
    """
    problems: list[str] = []
    warnings: list[str] = []

    databases = getattr(settings, "DATABASES", {}) or {}
    for alias in ("default", "direct"):
        host = str((databases.get(alias) or {}).get("HOST", ""))
        if host and host not in LOCAL_DB_HOSTS:
            problems.append(
                f"DATABASES['{alias}'] points at '{host}', which is not a local host, "
                f"but the settings module is config.settings.dev (DEBUG=True, "
                f"CORS_ALLOW_ALL_ORIGINS=True). Any 500 would render SECRET_KEY and "
                f"the Razorpay secret to the caller. Use config.settings.staging or "
                f"config.settings.prod for a real database, or point "
                f"{'DATABASE_URL' if alias == 'default' else 'DIRECT_DATABASE_URL'} "
                f"at a local one."
            )
            break

    if getattr(settings, "PAYMENTS_BACKEND", "") == "razorpay":
        key = str(getattr(settings, "RAZORPAY_KEY_ID", "") or "")
        if key.startswith("rzp_live_"):
            problems.append(
                "PAYMENTS_BACKEND=razorpay with a LIVE key (rzp_live_…) under "
                "development settings. A local checkout would move real money. Set "
                "PAYMENTS_BACKEND=fake for development — the fake adapter still "
                "verifies webhook signatures with real HMAC, so the security-critical "
                "path is identical."
            )

    # A warning, not a refusal, and deliberately weaker than the production
    # side. Mislabelling development costs a misfiled Sentry event from a
    # machine that usually has no DSN configured at all; mislabelling
    # production costs the alert that pages somebody.
    label = str(getattr(settings, "ENVIRONMENT", "") or "")
    if label != "development":
        warnings.append(
            f"ENVIRONMENT is {label!r} under development settings. It tags Sentry "
            f"events and appears in logs; set ENVIRONMENT=development."
        )

    if getattr(settings, "EMAIL_PROVIDER", "") == "smtp":
        warnings.append(
            "EMAIL_PROVIDER=smtp under development settings — a test booking will "
            "send a real email to a real person. EMAIL_PROVIDER=console prints it "
            "instead."
        )
    if getattr(settings, "SMS_PROVIDER", "") not in ("", "console"):
        warnings.append(
            "SMS_PROVIDER is a real provider under development settings — a test "
            "booking will send a real, billed SMS."
        )

    if problems:
        raise InsecureConfigurationError(
            "Refusing to start: development settings are pointed at production "
            "resources.\n"
            + "\n".join(f"  - {problem}" for problem in problems)
            + "\n\nRunning under Docker? `docker compose up` loads "
            "docker-compose.override.yml, which sets these correctly."
        )

    for warning in warnings:
        logger.warning("preflight.%s", warning)
    return warnings
