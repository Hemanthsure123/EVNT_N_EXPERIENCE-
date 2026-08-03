"""The per-environment templates and the deploy gate must agree.

`.env.example` is the development template and the canonical reference.
Staging and production get their own files, because "copy the dev one and
change the fifteen values that matter" is a step nobody performs completely —
and every value missed is silent: a fake payment backend that takes no money,
a localhost redirect URI Google will never match, a signing key shared with
development.

Four files is four chances to drift, so the parity is enforced here rather
than asked for in a document.

`test_env_contract.py` owns the other half of the contract: that the code and
`.env.example` agree. This file owns the templates.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]

# The dev container mounts only `backend/`, so the repo root is unreachable
# there. These are assertions about files, not about the application.
pytestmark = pytest.mark.skipif(
    not (REPO_ROOT / ".env.example").exists(),
    reason="repository root not mounted (running inside the backend container)",
)

CANONICAL = ".env.example"
BACKEND_TEMPLATES = (".env.staging.example", ".env.production.example")
FRONTEND_DEVELOPMENT = "frontend/.env.local.example"
FRONTEND_PRODUCTION = "frontend/.env.production.example"

ALL_TEMPLATES = BACKEND_TEMPLATES + (FRONTEND_PRODUCTION,)


def _declarations(relative: str) -> dict[str, list[bool]]:
    """name -> [is_commented, ...] for each declaration found."""
    found: dict[str, list[bool]] = {}
    for line in (REPO_ROOT / relative).read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        commented = stripped.startswith("#")
        body = stripped.lstrip("#").strip() if commented else stripped
        match = re.match(r"^([A-Z][A-Z0-9_]*)\s*=", body)
        if match:
            found.setdefault(match.group(1), []).append(commented)
    return found


def _active_values(relative: str) -> dict[str, str]:
    """name -> value, for uncommented declarations only."""
    values: dict[str, str] = {}
    for line in (REPO_ROOT / relative).read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        match = re.match(r"^([A-Z][A-Z0-9_]*)\s*=(.*)$", stripped)
        if match:
            values[match.group(1)] = match.group(2).strip()
    return values


class TestParity:
    @pytest.mark.parametrize("relative", BACKEND_TEMPLATES)
    def test_every_template_declares_the_canonical_variable_set(self, relative):
        """A variable added to one file and not the others is how an
        environment silently falls back to a default nobody chose."""
        canonical = _declarations(CANONICAL)
        template = _declarations(relative)

        assert not sorted(
            set(canonical) - set(template)
        ), f"{relative} is missing: {sorted(set(canonical) - set(template))}"
        assert not sorted(set(template) - set(canonical)), (
            f"{relative} declares variables {CANONICAL} does not: "
            f"{sorted(set(template) - set(canonical))}"
        )

    def test_the_frontend_production_template_matches_the_development_one(self):
        development = _declarations(FRONTEND_DEVELOPMENT)
        production = _declarations(FRONTEND_PRODUCTION)
        assert set(production) == set(development), (
            f"only in production: {sorted(set(production) - set(development))}\n"
            f"only in {FRONTEND_DEVELOPMENT}: {sorted(set(development) - set(production))}"
        )

    @pytest.mark.parametrize("relative", ALL_TEMPLATES)
    def test_a_template_declares_nothing_twice(self, relative):
        """A second active declaration silently wins, so the value somebody
        reads in the file is not the value the process gets."""
        duplicates = {
            name: states.count(False)
            for name, states in _declarations(relative).items()
            if states.count(False) > 1
        }
        assert not duplicates, f"{relative} declares these more than once: {duplicates}"


# Value shapes that mean a real credential reached a committed file.
_LOOKS_LIVE = (
    re.compile(r"^rzp_live_(?!<)"),
    re.compile(r"^postgres(?:ql)?://[^<\s]*supabase", re.I),
    re.compile(r"^rediss?://[^<\s]*upstash", re.I),
    re.compile(r"^AIza[0-9A-Za-z_\-]{30,}"),
    re.compile(r"^https://[0-9a-f]{16,}@[^<\s]*sentry\.io", re.I),
)


class TestNoSecrets:
    """These files are COMMITTED.

    The most likely way a real value reaches one is somebody filling a
    template in place instead of copying it to `.env` first — which is exactly
    what the instructions at the top of each file tell them not to do, and
    exactly what people do anyway.
    """

    @pytest.mark.parametrize("relative", ALL_TEMPLATES)
    def test_a_template_contains_no_real_credential(self, relative):
        offenders = {
            name: value[:24]
            for name, value in _active_values(relative).items()
            if any(pattern.search(value) for pattern in _LOOKS_LIVE)
        }
        assert not offenders, (
            f"{relative} appears to contain REAL credentials rather than "
            f"placeholders: {offenders}. This file is committed — rotate "
            f"anything real that reached it."
        )

    @pytest.mark.parametrize("relative", ALL_TEMPLATES)
    def test_every_secret_slot_is_an_obvious_placeholder(self, relative):
        """A plausible-looking dummy is worse than an obvious one: it gets
        deployed. Every credential slot is either blank or `<BRACKETED>`."""
        # Matched as a SUFFIX, not a substring. `TOKEN` anywhere in the name
        # also catches ACCESS_TOKEN_LIFETIME_MIN, which is an integer.
        secret_like = re.compile(
            r"(_SECRET|_PASSWORD|_KEY|_KEY_ID|_TOKEN|_DSN|_CREDENTIALS)$", re.IGNORECASE
        )
        offenders = {}
        for name, value in _active_values(relative).items():
            if not secret_like.search(name) or not value:
                continue
            # A placeholder either is bracketed, or contains one (a URL with
            # <PROJECT-REF> embedded), or is a documented public prefix.
            if "<" in value and ">" in value:
                continue
            offenders[name] = value
        assert not offenders, (
            f"{relative} has credential slots that are neither blank nor an "
            f"obvious <PLACEHOLDER>: {offenders}"
        )


# Values somebody else must reach: Google matches a redirect URI verbatim, a
# browser enforces CORS, Django rejects an unlisted Host.
_PUBLIC_URL_VARS = frozenset(
    {
        "PUBLIC_SITE_URL",
        "CORS_ALLOWED_ORIGINS",
        "CSRF_TRUSTED_ORIGINS",
        "ALLOWED_HOSTS",
        "GOOGLE_OAUTH_REDIRECT_URI",
        "S3_PUBLIC_BASE_URL",
        "NEXT_PUBLIC_API_BASE_URL",
        "NEXT_PUBLIC_SITE_URL",
        "NEXT_PUBLIC_MEDIA_BASE_URL",
    }
)


class TestProductionShape:
    """An operator who fills in every `<PLACEHOLDER>` must get a configuration
    that BOOTS. A template that ships a value preflight refuses wastes a
    deploy to teach a lesson the file could have taught."""

    @pytest.mark.parametrize("relative", (".env.production.example", FRONTEND_PRODUCTION))
    def test_the_production_templates_never_suggest_localhost(self, relative):
        """A leftover localhost does not error — it simply never works, and
        the symptom appears at Google's end or in a browser console rather
        than in our logs."""
        offenders = {
            name: value
            for name, value in _active_values(relative).items()
            if name in _PUBLIC_URL_VARS
            and re.search(r"localhost|127\.0\.0\.1|0\.0\.0\.0|::1", value)
        }
        assert not offenders, f"{relative} points production at localhost: {offenders}"

    @pytest.mark.parametrize("relative", (".env.production.example", FRONTEND_PRODUCTION))
    def test_public_urls_are_https(self, relative):
        offenders = {
            name: value
            for name, value in _active_values(relative).items()
            if name in _PUBLIC_URL_VARS and value.startswith("http://")
        }
        assert not offenders, f"{relative} suggests plain http: {offenders}"

    def test_the_production_template_selects_no_fake_adapter(self):
        from core.preflight import _FAKE_BACKENDS

        values = _active_values(".env.production.example")
        for switch, (fake_value, consequence) in _FAKE_BACKENDS.items():
            if switch == "SMS_PROVIDER":
                # The one honest exception. India's DLT registration takes
                # WEEKS, and `console` sends nothing rather than pretending
                # to. Preflight still refuses it, so launching SMS is a
                # deliberate edit — the right amount of friction for a
                # regulated channel that cannot be switched on in an afternoon.
                continue
            assert (
                values.get(switch) != fake_value
            ), f".env.production.example sets {switch}={fake_value}: {consequence}"

    def test_the_production_template_declares_every_credential_preflight_requires(self):
        """Ties the template to the deploy gate.

        Add a real adapter and its credentials to `_ADAPTER_CREDENTIALS`
        without adding them here, and the first person to deploy discovers the
        gap from a refusal at boot rather than from the file they were handed.
        """
        from core.preflight import _ADAPTER_CREDENTIALS, _REQUIRED_SECRETS

        active = {
            name
            for name, states in _declarations(".env.production.example").items()
            if not all(states)
        }

        required = {name for name, _ in _REQUIRED_SECRETS}
        for credentials in _ADAPTER_CREDENTIALS.values():
            required |= set(credentials)

        missing = sorted(required - active)
        assert not missing, (
            f".env.production.example does not actively declare {missing}, "
            f"which core/preflight.py requires for one or more adapters."
        )

    def test_the_production_template_does_not_enable_the_profiler(self):
        """django-silk records request bodies — passwords, payment payloads —
        and serves them unauthenticated."""
        assert _active_values(".env.production.example").get("ENABLE_SILK") == "false"

    def test_the_production_template_does_not_enable_debug(self):
        assert _active_values(".env.production.example").get("DEBUG") == "false"

    def test_the_production_template_leaves_the_test_database_override_blank(self):
        """pytest CREATES AND DROPS its database. `ALLOW_REMOTE_TEST_DATABASE`
        is the only thing standing between a routine test run and a dropped
        production database."""
        assert _active_values(".env.production.example").get("ALLOW_REMOTE_TEST_DATABASE") == ""

    def test_the_production_template_configures_the_pooler_correctly(self):
        """Both are required behind Supabase's transaction pooler: it manages
        connection reuse itself, and server-side cursors need a session
        affinity it does not provide."""
        values = _active_values(".env.production.example")
        assert values.get("CONN_MAX_AGE") == "0"
        assert values.get("DISABLE_SERVER_SIDE_CURSORS") == "true"

    def test_the_production_database_urls_assert_tls(self):
        values = _active_values(".env.production.example")
        for name in ("DATABASE_URL", "DIRECT_DATABASE_URL"):
            assert "sslmode=require" in values[name], f"{name} does not require TLS"

    def test_the_two_database_urls_use_different_pooler_ports(self):
        """Runtime uses transaction mode (6543); migrations and pytest need
        session mode (5432), because DDL through a transaction pooler is
        unreliable and pytest creates a database the pooler has never heard
        of."""
        values = _active_values(".env.production.example")
        assert ":6543/" in values["DATABASE_URL"]
        assert ":5432/" in values["DIRECT_DATABASE_URL"]

    def test_the_production_redis_url_verifies_its_certificate(self):
        """`?ssl_cert_reqs=none` exists only for the self-signed certificate
        in local development. Carried into production it disables certificate
        verification against a real, CA-signed endpoint."""
        assert "ssl_cert_reqs=none" not in _active_values(".env.production.example")["REDIS_URL"]


class TestSettingsModuleSelection:
    """The settings module decides WHICH gate runs.

    A production template shipping `config.settings.dev` would mean DEBUG=True
    and CORS_ALLOW_ALL_ORIGINS over real data with the production gate never
    invoked — the exact state the production readiness audit found live.
    """

    @pytest.mark.parametrize(
        "relative,expected",
        [
            (CANONICAL, "config.settings.dev"),
            (".env.staging.example", "config.settings.staging"),
            (".env.production.example", "config.settings.prod"),
        ],
    )
    def test_each_template_selects_its_own_settings_module(self, relative, expected):
        assert _active_values(relative).get("DJANGO_SETTINGS_MODULE") == expected

    @pytest.mark.parametrize(
        "relative,expected",
        [
            (CANONICAL, "development"),
            (".env.staging.example", "staging"),
            (".env.production.example", "production"),
        ],
    )
    def test_each_template_names_its_own_environment(self, relative, expected):
        """`ENVIRONMENT` is what tags Sentry events and what preflight reports.
        A production deploy labelled `development` sends its alerts to the
        wrong stream."""
        assert _active_values(relative).get("ENVIRONMENT") == expected

    def test_staging_never_ships_live_payment_keys(self):
        """A staging checkout must not move real money."""
        assert not _active_values(".env.staging.example")["RAZORPAY_KEY_ID"].startswith("rzp_live_")
