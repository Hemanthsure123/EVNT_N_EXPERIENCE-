"""The deploy gate.

These assert the thing the audit was about: a production configuration that
would silently do nothing real must not be able to start. Each test names the
consequence it prevents, because "it raises" is not the point — WHAT it
refuses is.
"""

from __future__ import annotations

import pytest

from core.preflight import (
    InsecureConfigurationError,
    check_development_settings,
    check_production_settings,
)

# Bound HERE, before the autouse fixture below can monkeypatch the module
# attribute, so one test can still exercise the genuine implementation.
from core.preflight import _module_importable as _real_module_importable


class _Settings:
    """A settings module, as an object with attributes — which is exactly what
    `sys.modules[__name__]` is at the point prod.py calls the checker."""

    def __init__(self, **overrides: object) -> None:
        defaults = {
            "SECRET_KEY": "x" * 50,
            "JWT_SIGNING_KEY": "y" * 50,
            "TICKET_QR_SIGNING_KEY": "z" * 50,
            "DEBUG": False,
            "ALLOWED_HOSTS": ["curatix.example"],
            "CORS_ALLOWED_ORIGINS": ["https://curatix.example"],
            "CORS_ALLOW_ALL_ORIGINS": False,
            "ENABLE_SILK": False,
            "PAYMENTS_BACKEND": "razorpay",
            "STORAGE_BACKEND": "gcs",
            "EMAIL_PROVIDER": "smtp",
            "SMS_PROVIDER": "http",
            "EVENT_BUS_BACKEND": "pubsub",
            "QUEUE_BACKEND": "local",
            "RAZORPAY_KEY_ID": "rzp_live_real",
            "RAZORPAY_KEY_SECRET": "real-secret",
            "RAZORPAY_WEBHOOK_SECRET": "real-webhook-secret",
            "GCP_PROJECT_ID": "curatix-prod",
            "GCS_BUCKET_NAME": "curatix-uploads",
            "SMTP_HOST": "smtp.example.com",
            "SMTP_FROM_EMAIL": "tickets@curatix.example",
            "SMS_API_KEY": "real-sms-key",
            "SMS_SENDER_ID": "EVNTFL",
            "SMS_DLT_ENTITY_ID": "1234567890",
            "PUBSUB_TOPIC_EVENTS": "platform-events",
            "SENTRY_DSN": "https://x@sentry.io/1",
            "VAPID_PRIVATE_KEY": "key",
            "PUBLIC_SITE_URL": "https://curatix.example",
            "GOOGLE_OAUTH_REDIRECT_URI": "https://api.curatix.example/api/v1/calendar/callback",
            "REST_FRAMEWORK": {"NUM_PROXIES": 1},
            "CSRF_TRUSTED_ORIGINS": ["https://api.curatix.example"],
            "ENVIRONMENT": "production",
        }
        for key, value in {**defaults, **overrides}.items():
            setattr(self, key, value)


@pytest.fixture(autouse=True)
def _assume_sdks_present(monkeypatch):
    """These tests are about CONFIGURATION rules, not about what happens to be
    installed on the machine running them.

    The dependency check is real and fires for the `_Settings` fixture (which
    selects razorpay, gcs and pubsub), so without this every test here would
    fail for a reason it is not testing. `TestRuntimeDependencies` below
    exercises that check directly, with the importability answer controlled.
    """
    monkeypatch.setattr("core.preflight._module_importable", lambda _: True)


def _refuses(settings: _Settings, *, strict: bool = True) -> str:
    with pytest.raises(InsecureConfigurationError) as caught:
        check_production_settings(settings, strict=strict, expected_environment="production")
    return str(caught.value)


def test_a_fully_real_configuration_starts_cleanly():
    assert check_production_settings(_Settings(), strict=True) == []


class TestSecrets:
    """Each of these means somebody with this repository can forge something."""

    def test_the_shipped_secret_key_is_refused(self):
        message = _refuses(_Settings(SECRET_KEY="dev-secret-change-me-0000000000000000"))
        assert "SECRET_KEY" in message
        assert "placeholder" in message

    def test_the_shipped_jwt_key_is_refused(self):
        # With this key, anyone holding the repo can mint a valid session for
        # any user id — including a staff one.
        assert "JWT_SIGNING_KEY" in _refuses(
            _Settings(JWT_SIGNING_KEY="dev-jwt-signing-key-change-me-0000000000")
        )

    def test_the_shipped_qr_key_is_refused(self):
        # With this key, anyone can forge a ticket that passes the gate scanner.
        assert "TICKET_QR_SIGNING_KEY" in _refuses(
            _Settings(TICKET_QR_SIGNING_KEY="dev-qr-signing-key-change-me-000000000000")
        )

    def test_a_short_signing_key_is_refused(self):
        message = _refuses(_Settings(JWT_SIGNING_KEY="short"))
        assert "32 is the minimum" in message

    def test_a_missing_secret_is_refused(self):
        assert "is not set" in _refuses(_Settings(SECRET_KEY=""))

    def test_secrets_are_fatal_in_staging_too(self):
        # Staging holds real credentials the moment anybody signs in.
        assert "SECRET_KEY" in _refuses(
            _Settings(SECRET_KEY="dev-secret-change-me-0000000000000000"), strict=False
        )


class TestFakeAdapters:
    """A fake adapter satisfies the same interface as a real one, so the app
    boots, serves traffic and looks healthy while doing nothing."""

    def test_the_fake_payment_adapter_is_refused_in_production(self):
        message = _refuses(_Settings(PAYMENTS_BACKEND="fake"))
        assert "no money would move" in message

    def test_the_console_email_adapter_is_refused_in_production(self):
        assert "would receive a ticket" in _refuses(_Settings(EMAIL_PROVIDER="console"))

    def test_local_storage_is_refused_in_production(self):
        assert "vanish on the next restart" in _refuses(_Settings(STORAGE_BACKEND="local"))

    def test_the_console_sms_adapter_is_refused_in_production(self):
        assert "no OTP or booking SMS" in _refuses(_Settings(SMS_PROVIDER="console"))

    def test_sms_deliberately_disabled_is_allowed_but_never_silent(self):
        """`disabled` and `console` must not be treated alike.

        `console` ACCEPTS every message and drops it, so the log reads `sent`
        while no OTP arrives — that stays a hard refusal above. `disabled`
        reports it cannot deliver, so `NotificationService.notify` skips the
        send before claiming a row.

        Allowing it matters because India's DLT registration takes weeks and a
        platform can be ready to take money before it clears. Warning about it
        matters just as much: losing SMS is a real reduction in service, and
        whoever reads a boot log should see it stated rather than find out
        when a customer asks where their OTP went.
        """
        warnings = check_production_settings(_Settings(SMS_PROVIDER="disabled"), strict=True)
        assert any("no OTP or booking SMS will be delivered" in w for w in warnings)
        assert any(
            "SMS_PROVIDER=http" in w for w in warnings
        ), "the warning must say how to turn SMS back on"

    def test_fakes_are_a_warning_in_staging_not_a_refusal(self):
        # Exercising the booking funnel without moving money is what staging
        # is FOR, so this must not block a deploy there.
        warnings = check_production_settings(_Settings(PAYMENTS_BACKEND="fake"), strict=False)
        assert any("no money would move" in warning for warning in warnings)


class TestAdapterCredentials:
    """Selecting a real adapter without its credentials is a 500 on the first
    ticket somebody buys, not at boot — unless this catches it."""

    def test_razorpay_without_a_webhook_secret_is_refused(self):
        assert "RAZORPAY_WEBHOOK_SECRET" in _refuses(_Settings(RAZORPAY_WEBHOOK_SECRET=""))

    def test_razorpay_with_the_shipped_dummy_secret_is_refused(self):
        assert "shipped placeholder" in _refuses(
            _Settings(RAZORPAY_WEBHOOK_SECRET="dummy_rzp_webhook_secret_00000000")
        )

    def test_gcs_without_a_bucket_is_refused(self):
        assert "GCS_BUCKET_NAME" in _refuses(_Settings(GCS_BUCKET_NAME=""))

    def test_cloud_tasks_without_a_target_url_is_refused(self):
        # This is the exact gap the audit found: the queue accepted tasks and
        # posted them to a URL that did not exist.
        message = _refuses(_Settings(QUEUE_BACKEND="cloud_tasks", CLOUD_TASKS_TARGET_URL=""))
        assert "CLOUD_TASKS_TARGET_URL" in message

    def test_cloud_tasks_without_the_internal_secret_is_refused(self):
        # An unauthenticated dispatch endpoint is a URL anyone can use to
        # trigger a payout release.
        message = _refuses(
            _Settings(
                QUEUE_BACKEND="cloud_tasks",
                CLOUD_TASKS_TARGET_URL="https://api.curatix.example/internal/tasks/run",
                INTERNAL_TASK_SECRET="",
            )
        )
        assert "INTERNAL_TASK_SECRET" in message

    def test_credentials_are_not_checked_for_an_unselected_adapter(self):
        # Razorpay unset is fine when payments run on something else — which
        # is the whole point of not checking every credential unconditionally.
        assert (
            check_production_settings(
                _Settings(PAYMENTS_BACKEND="fake", RAZORPAY_KEY_SECRET=""), strict=False
            )
            is not None
        )


class TestExposure:
    def test_debug_is_refused(self):
        assert "DEBUG" in _refuses(_Settings(DEBUG=True))

    def test_wide_open_cors_is_refused(self):
        assert "any site" in _refuses(_Settings(CORS_ALLOW_ALL_ORIGINS=True))

    def test_empty_allowed_hosts_is_refused(self):
        assert "ALLOWED_HOSTS" in _refuses(_Settings(ALLOWED_HOSTS=[]))

    def test_the_profiler_is_refused(self):
        # django-silk records request bodies — passwords and payment payloads
        # — and serves them unauthenticated at /silk/.
        assert "passwords" in _refuses(_Settings(ENABLE_SILK=True))


class TestOptionalIntegrations:
    """Absent optional integrations are a deployment choice, never a blocker —
    but a silent absence is how a platform runs a month with no error
    reporting and nobody notices."""

    def test_missing_sentry_warns_but_starts(self):
        warnings = check_production_settings(_Settings(SENTRY_DSN=""), strict=True)
        assert any("SENTRY_DSN" in warning for warning in warnings)

    def test_missing_vapid_warns_but_starts(self):
        warnings = check_production_settings(_Settings(VAPID_PRIVATE_KEY=""), strict=True)
        assert any("VAPID" in warning for warning in warnings)


def test_every_problem_is_reported_at_once_not_one_per_deploy():
    """Fixing one secret, redeploying, and being told about the next is a very
    slow way to learn there were four."""
    message = _refuses(
        _Settings(
            SECRET_KEY="dev-secret-change-me-0000000000000000",
            JWT_SIGNING_KEY="short",
            DEBUG=True,
            PAYMENTS_BACKEND="fake",
        )
    )
    for expected in ("SECRET_KEY", "JWT_SIGNING_KEY", "DEBUG", "no money would move"):
        assert expected in message


class TestRuntimeDependencies:
    """The gap that let a missing SDK reach production.

    Every vendor SDK sits behind an optional extra and `config/di.py` imports
    it lazily, so a missing package produces no build error, no import error
    and no boot error — it produces a ModuleNotFoundError on the first
    REQUEST. For `PAYMENTS_BACKEND=razorpay` that request is somebody's first
    checkout.
    """

    @staticmethod
    def _without(monkeypatch, *missing: str):
        monkeypatch.setattr("core.preflight._module_importable", lambda name: name not in missing)

    def test_a_selected_backend_without_its_sdk_refuses_to_boot(self, monkeypatch):
        self._without(monkeypatch, "razorpay")
        message = _refuses(_Settings(PAYMENTS_BACKEND="razorpay"))
        assert "razorpay" in message
        # The message must say how to fix it, not merely that it is broken.
        assert "INSTALL_EXTRAS" in message

    def test_an_unselected_backend_does_not_require_its_sdk(self, monkeypatch):
        """The image ships no `gcp` extra on purpose. That must be fine as long
        as nothing selects a GCP-backed adapter."""
        from core.preflight import _check_runtime_dependencies

        self._without(monkeypatch, "google.cloud.storage", "google.cloud.pubsub_v1")
        problems: list[str] = []
        _check_runtime_dependencies(
            _Settings(STORAGE_BACKEND="s3", EVENT_BUS_BACKEND="inprocess"), problems
        )
        assert problems == []

    def test_a_configured_credential_without_its_sdk_refuses(self, monkeypatch):
        """A credential set means somebody expects the feature to work.

        Degrading quietly is how a platform runs for a month with push
        switched "on" and nothing ever delivered.
        """
        self._without(monkeypatch, "pywebpush")
        message = _refuses(_Settings(VAPID_PRIVATE_KEY="a-key"))
        assert "pywebpush" in message
        assert "no notification can be delivered" in message

    def test_calendar_credentials_require_the_encryption_library(self, monkeypatch):
        # Without `cryptography`, core/encryption.py raises and the OAuth
        # callback 500s at the moment it stores a refresh token.
        self._without(monkeypatch, "cryptography")
        message = _refuses(_Settings(GOOGLE_OAUTH_CLIENT_ID="id.apps.googleusercontent.com"))
        assert "cryptography" in message

    def test_a_sentry_dsn_without_the_sdk_refuses(self, monkeypatch):
        self._without(monkeypatch, "sentry_sdk")
        assert "sentry_sdk" in _refuses(_Settings(SENTRY_DSN="https://x@sentry.io/1"))

    def test_the_real_importability_check_does_not_raise_on_a_missing_parent(self):
        """A missing parent package raises rather than returning cleanly, so
        the check that exists to prevent a crash must not itself crash."""
        assert _real_module_importable("json") is True
        assert _real_module_importable("definitely.not.a.real.package") is False

    def test_a_package_that_is_present_but_unimportable_is_reported_missing(self, tmp_path):
        """THE case that shipped.

        `find_spec("razorpay")` returned True while `import razorpay` raised
        ModuleNotFoundError for `pkg_resources` — razorpay imports it at module
        scope, and Python 3.12 images no longer install setuptools. The gate
        passed, the container started, and the failure waited for the first
        checkout.

        A path lookup cannot see this. Only an import can.
        """
        import sys

        broken = tmp_path / "broken_probe_pkg.py"
        broken.write_text("import a_dependency_that_is_not_installed", encoding="utf-8")
        sys.path.insert(0, str(tmp_path))
        try:
            import importlib.util

            # Present on disk, and findable...
            assert importlib.util.find_spec("broken_probe_pkg") is not None
            # ...but it does not import, so it is unusable.
            assert _real_module_importable("broken_probe_pkg") is False
        finally:
            sys.path.remove(str(tmp_path))
            sys.modules.pop("broken_probe_pkg", None)


class TestPublicUrls:
    """A leftover localhost does not error. It simply never works, and the
    symptom appears at Google's end rather than in our logs."""

    def test_a_localhost_oauth_redirect_is_refused(self):
        message = _refuses(
            _Settings(GOOGLE_OAUTH_REDIRECT_URI="http://localhost:8000/api/v1/auth/callback")
        )
        assert "GOOGLE_OAUTH_REDIRECT_URI" in message

    def test_a_localhost_site_url_is_refused(self):
        assert "PUBLIC_SITE_URL" in _refuses(_Settings(PUBLIC_SITE_URL="http://localhost:3000"))

    def test_a_plain_http_public_url_is_refused(self):
        message = _refuses(_Settings(PUBLIC_SITE_URL="http://curatix.example"))
        assert "https" in message

    def test_localhost_only_allowed_hosts_is_refused(self):
        """An EMPTY ALLOWED_HOSTS was already refused. A localhost-ONLY one is
        just as total and was not: Django answers 400 DisallowedHost for every
        request to the real domain, so the deployment looks healthy from inside
        the container and is unreachable from outside it."""
        message = _refuses(_Settings(ALLOWED_HOSTS=["localhost", "127.0.0.1"]))
        assert "ALLOWED_HOSTS" in message
        assert "DisallowedHost" in message

    def test_a_real_hostname_alongside_a_local_one_is_accepted(self):
        """Keeping localhost for a container healthcheck is legitimate; it is
        only ALL-local that means unreachable."""
        settings = _Settings(ALLOWED_HOSTS=["api.curatix.example", "127.0.0.1"])
        assert check_production_settings(settings, strict=True) == []

    def test_localhost_only_cors_is_refused(self):
        message = _refuses(_Settings(CORS_ALLOWED_ORIGINS=["http://localhost:3000"]))
        assert "no deployed" in message

    def test_a_real_https_url_is_accepted(self):
        assert (
            check_production_settings(
                _Settings(
                    PUBLIC_SITE_URL="https://curatix.example",
                    GOOGLE_OAUTH_REDIRECT_URI="https://api.curatix.example/cb",
                ),
                strict=True,
            )
            is not None
        )

    def test_public_url_checks_do_not_apply_to_staging(self):
        # Staging legitimately runs on internal hostnames.
        warnings = check_production_settings(
            _Settings(PUBLIC_SITE_URL="http://localhost:3000"), strict=False
        )
        assert isinstance(warnings, list)

    def test_zero_proxies_warns_because_rate_limits_become_one_bucket(self):
        """DRF reads the client IP from X-Forwarded-For only when NUM_PROXIES
        is set. At 0 it uses the proxy's own address, so `auth: 10/min`
        becomes 10/min for the entire internet."""
        warnings = check_production_settings(_Settings(REST_FRAMEWORK={}), strict=True)
        assert any("NUM_PROXIES" in warning for warning in warnings)

    def test_gmail_smtp_warns_about_its_limits(self):
        warnings = check_production_settings(_Settings(SMTP_HOST="smtp.gmail.com"), strict=True)
        assert any("Gmail" in warning for warning in warnings)


class TestDevelopmentGate:
    """The audit's C1, made impossible rather than documented.

    `DEBUG=True` over production data is not an error state — it is a running,
    healthy-looking process that leaks every secret on the first 500.
    """

    class _Dev:
        def __init__(self, **overrides: object) -> None:
            defaults = {
                "DATABASES": {
                    "default": {"HOST": "pgbouncer"},
                    "direct": {"HOST": "postgres"},
                },
                "PAYMENTS_BACKEND": "fake",
                "RAZORPAY_KEY_ID": "",
                "EMAIL_PROVIDER": "console",
                "SMS_PROVIDER": "console",
                "ENVIRONMENT": "development",
            }
            for key, value in {**defaults, **overrides}.items():
                setattr(self, key, value)

    def _refused(self, settings) -> str:
        with pytest.raises(InsecureConfigurationError) as caught:
            check_development_settings(settings)
        return str(caught.value)

    def test_a_local_development_stack_starts(self):
        assert check_development_settings(self._Dev()) == []

    def test_a_remote_runtime_database_is_refused(self):
        message = self._refused(
            self._Dev(
                DATABASES={
                    "default": {"HOST": "aws-1-ap-south-1.pooler.supabase.com"},
                    "direct": {"HOST": "postgres"},
                }
            )
        )
        assert "SECRET_KEY" in message
        # It must name the way out, not merely refuse.
        assert "config.settings.prod" in message

    def test_a_remote_direct_database_is_refused_too(self):
        """The `direct` alias is the one migrations and pytest use, so a
        remote value there is the more dangerous of the two."""
        message = self._refused(
            self._Dev(
                DATABASES={
                    "default": {"HOST": "pgbouncer"},
                    "direct": {"HOST": "aws-1-ap-south-1.pooler.supabase.com"},
                }
            )
        )
        assert "DIRECT_DATABASE_URL" in message

    def test_live_payment_keys_are_refused(self):
        message = self._refused(
            self._Dev(PAYMENTS_BACKEND="razorpay", RAZORPAY_KEY_ID="rzp_live_abc123")
        )
        assert "real money" in message

    def test_test_mode_payment_keys_are_allowed(self):
        # `rzp_test_` keys against a local database are a legitimate way to
        # exercise the real adapter without moving money.
        assert (
            check_development_settings(
                self._Dev(PAYMENTS_BACKEND="razorpay", RAZORPAY_KEY_ID="rzp_test_abc123")
            )
            == []
        )

    def test_a_real_relay_warns_rather_than_refusing(self):
        """Recoverable — an email to a real person is embarrassing, not a
        breach — so it must not stop a developer working."""
        warnings = check_development_settings(self._Dev(EMAIL_PROVIDER="smtp"))
        assert any("real email" in warning for warning in warnings)

    def test_a_real_sms_provider_warns(self):
        warnings = check_development_settings(self._Dev(SMS_PROVIDER="http"))
        assert any("billed SMS" in warning for warning in warnings)


class TestEnvironmentLabel:
    """`ENVIRONMENT` and the settings module are set independently, and nothing
    connected them.

    A production deploy carrying `ENVIRONMENT=development` behaves correctly in
    every way except the one nobody watches: Sentry tags every event with it, so
    a production incident is filed under the wrong environment and filtered out
    of the alerts that page somebody. Alerting does not break — it appears to
    work.
    """

    def test_production_refuses_a_mislabelled_environment(self):
        message = _refuses(_Settings(ENVIRONMENT="development"))
        assert "ENVIRONMENT" in message
        assert "ENVIRONMENT=production" in message

    def test_staging_refuses_a_mislabelled_environment(self):
        with pytest.raises(InsecureConfigurationError) as caught:
            check_production_settings(
                _Settings(ENVIRONMENT="production"),
                strict=False,
                expected_environment="staging",
            )
        assert "ENVIRONMENT=staging" in str(caught.value)

    def test_a_matching_label_is_accepted(self):
        assert (
            check_production_settings(
                _Settings(ENVIRONMENT="staging"), strict=False, expected_environment="staging"
            )
            is not None
        )

    def test_a_near_miss_is_still_refused(self):
        """Exact match, not fuzzy. `prod` routes alerts to a stream that does
        not exist, and the cost of refusing is one line at deploy time."""
        assert "ENVIRONMENT" in _refuses(_Settings(ENVIRONMENT="prod"))

    def test_the_check_is_skipped_when_no_expectation_is_given(self):
        """Every other caller — and forty-odd tests — pass no expectation, and
        must be unaffected."""
        assert check_production_settings(_Settings(ENVIRONMENT="anything"), strict=True) == []

    def test_development_warns_rather_than_refusing(self):
        """Weaker on purpose: mislabelling a developer's machine costs a
        misfiled event from a process that usually has no DSN at all."""
        warnings = check_development_settings(TestDevelopmentGate._Dev(ENVIRONMENT="production"))
        assert any("ENVIRONMENT" in warning for warning in warnings)


class TestDevelopmentInfrastructureInProduction:
    """Compose loads `docker-compose.override.yml` AUTOMATICALLY when present.

    Left on a production host it reinstates the worst finding of the readiness
    audit: the process holds real Supabase, Upstash and Razorpay credentials
    while every read and write goes to an empty container — and nothing
    reports it, because both configurations are internally valid.

    The runbook says to remove that file when deploying. A manual step is not
    a guard.
    """

    @staticmethod
    def _with_db(host: str) -> _Settings:
        return _Settings(DATABASES={"default": {"HOST": host}, "direct": {"HOST": host}})

    def test_a_compose_database_service_is_refused(self):
        message = _refuses(self._with_db("pgbouncer"))
        assert "docker-compose.override.yml" in message
        # It must say how to fix it, not merely that it is wrong.
        assert "-f docker-compose.yml" in message

    def test_the_direct_alias_is_checked_too(self):
        """`direct` is what migrations use, so a stale value there points DDL
        at the wrong database."""
        settings = _Settings(
            DATABASES={"default": {"HOST": "db.example.com"}, "direct": {"HOST": "postgres"}}
        )
        assert "docker-compose.override.yml" in _refuses(settings)

    def test_a_compose_redis_service_is_refused(self):
        settings = _Settings(
            DATABASES={"default": {"HOST": "db.example.com"}, "direct": {"HOST": "db.example.com"}},
            REDIS_URL="rediss://redis:6380/0",
        )
        assert "REDIS_URL" in _refuses(settings)

    def test_a_self_hosted_loopback_database_is_allowed(self):
        """Matched on the compose SERVICE NAMES, not on any local address. A
        deployment with Postgres on 127.0.0.1 is a legitimate topology;
        resolving the literal host `pgbouncer` is an accident."""
        settings = _Settings(
            DATABASES={"default": {"HOST": "127.0.0.1"}, "direct": {"HOST": "127.0.0.1"}},
            REDIS_URL="rediss://127.0.0.1:6379/0",
        )
        assert check_production_settings(settings, strict=True) == []

    def test_disabled_tls_verification_is_refused(self):
        """`ssl_cert_reqs=none` exists only for the self-signed certificate in
        local development. Carried into production it disables certificate
        verification against a real endpoint."""
        message = _refuses(
            _Settings(REDIS_URL="rediss://default:t@real.upstash.io:6379?ssl_cert_reqs=none")
        )
        assert "DISABLES TLS certificate verification" in message

    def test_staging_is_not_subject_to_this(self):
        """Staging self-hosting its own Postgres and Redis containers is a
        legitimate, cheap topology."""
        settings = _Settings(
            DATABASES={"default": {"HOST": "pgbouncer"}, "direct": {"HOST": "postgres"}}
        )
        warnings = check_production_settings(settings, strict=False)
        assert not any("docker-compose" in warning for warning in warnings)
