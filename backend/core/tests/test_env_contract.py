"""The environment files and the code must agree.

Env drift is silent by construction: a variable the code reads but nobody
declares falls back to a default that is usually wrong in production, and a
variable declared but read by nothing looks like configuration while doing
nothing. Both were found by hand in this repository; neither would have been
caught by any other test.

So the contract is enforced here rather than in a document that goes stale:

  1. Every variable the backend reads is declared in `.env.example`.
  2. Every ACTIVE declaration in `.env.example` is read by something.
  3. `.env` and `.env.example` declare exactly the same variables.
  4. Nothing is declared twice.
  5. The frontend example declares exactly what the frontend reads.
  6. `ENVIRONMENT_VARIABLES.md` documents every variable.

Commented-out declarations are exempt from (2): they are the documented home
for a credential whose integration is not built yet (Google OAuth), and the
whole point is that nothing consumes them.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND = REPO_ROOT / "backend"
FRONTEND = REPO_ROOT / "frontend"

# The dev container mounts only `backend/`, so the repo root and the frontend
# are not reachable from inside it. These assertions are about files, not about
# the application, so they SKIP there and run where the whole repository is
# checked out — the developer's machine and CI, which is where env drift is
# introduced and where it must be caught.
pytestmark = pytest.mark.skipif(
    not (REPO_ROOT / ".env.example").exists(),
    reason="repository root not mounted (running inside the backend container)",
)

SKIP_DIRS = {
    ".venv",
    "node_modules",
    ".next",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    ".git",
    "staticfiles",
    "media",
    "storybook-static",
}

# Read by Django/manage.py itself before any of our code runs, so it never
# appears in an `env.str(...)` call — but it is genuinely required.
FRAMEWORK_OWNED = {"DJANGO_SETTINGS_MODULE"}

# Read by the Google client libraries straight from the process environment,
# never through Django settings.
SDK_OWNED = {"GOOGLE_APPLICATION_CREDENTIALS"}

# Read by docker-compose's own variable substitution rather than by any
# process — `docker-compose.override.yml` interpolates them when it builds a
# service's environment. They ARE read, and by a file this suite already
# tests (test_deployment_topology), just not by Python.
# Read by docker-compose.override.yml to CHOOSE a value for a real setting
# (PAYMENTS_BACKEND, EMAIL_PROVIDER), never by Django. They are development
# switches, so no `env(...)` call will ever mention them — but they are not
# dead config either, which is why they are named here rather than deleted.
COMPOSE_OWNED = {
    # Backend-adjacent switches the compose files read.
    "DEV_EMAIL_PROVIDER",
    "DEV_PAYMENTS_BACKEND",
    # DEPLOYMENT TOPOLOGY. Read by docker-compose and Caddy, never by Django —
    # but they belong in the env contract all the same, because a deploy
    # variable that lives only in somebody's private `.env` is one nobody else
    # can reproduce the environment from. That is the same failure the
    # `.env`/`.env.example` parity test exists to catch, one layer out.
    "SITE_DOMAIN",
    "ACME_EMAIL",
    "FRONTEND_UPSTREAM",
    "WEB_PORT",
    # The bundled Postgres container's OWN credentials — distinct from
    # DATABASE_URL, which is what the app connects with.
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
    # Frontend build args. The compose file passes them into the Next.js image
    # build; the backend never reads them, and `frontend/.env.local.example`
    # documents what each one does.
    "NEXT_PUBLIC_API_BASE_URL",
    "NEXT_PUBLIC_SITE_URL",
    "NEXT_PUBLIC_MEDIA_BASE_URL",
    "NEXT_PUBLIC_RAZORPAY_KEY_ID",
    "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
}

# Frontend variables that exist for dev tooling (the fixture API server,
# Playwright) rather than the application, and are documented rather than
# declared — see frontend/.env.local.example.
FRONTEND_TOOLING = {"CI", "NODE_ENV", "MOCK_API_PORT", "MOCK_API_ORIGIN", "MOCK_RAZORPAY_KEY_ID"}

# Credentials the operator HOLDS but whose integration is not built, so the
# value has a documented home rather than living in someone's password manager
# until the feature lands.
#
# This is a NARROW, NAMED exemption from "every active declaration must be
# read", not a loophole. Two rules keep it honest:
#
#   1. Every entry must say so in the env file itself. The Google OAuth and
#      frontend-Sentry blocks both open with an explicit "NOTHING READS THIS
#      YET", so nobody sets one and believes a feature turned on.
#   2. An entry LEAVES this set the moment its consumer ships. If it is still
#      here after the integration is built, the exemption has become the stale
#      config it was meant to prevent.
#
# `test_a_held_credential_still_declares_itself_unread` enforces (1).
CREDENTIALS_HELD_PENDING_INTEGRATION = {
    # Frontend error reporting — needs @sentry/nextjs wired.
    "NEXT_PUBLIC_SENTRY_DSN",
    #
    # GOOGLE_OAUTH_* LEFT THIS SET when Google Calendar shipped and started
    # reading them. That is the mechanism working: the exemption expires on
    # its own terms rather than quietly outliving the gap it covered.
}


def _walk(root: Path, suffixes: tuple[str, ...]):
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix not in suffixes:
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        yield path


def _declarations(path: Path) -> dict[str, list[bool]]:
    """name -> [is_commented, ...] for each declaration found."""
    found: dict[str, list[bool]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        commented = stripped.startswith("#")
        body = stripped.lstrip("#").strip() if commented else stripped
        match = re.match(r"^([A-Z][A-Z0-9_]*)\s*=", body)
        if match:
            found.setdefault(match.group(1), []).append(commented)
    return found


@pytest.fixture(scope="module")
def backend_reads() -> dict[str, set[str]]:
    patterns = (
        re.compile(
            r"""env\.(?:str|int|bool|list|dict|float|db_url|url|json)\(\s*["']([A-Z0-9_]+)["']"""
        ),
        re.compile(r"""os\.getenv\(\s*["']([A-Z0-9_]+)["']"""),
        re.compile(r"""os\.environ(?:\.get)?[\[\(]\s*["']([A-Z0-9_]+)["']"""),
    )
    reads: dict[str, set[str]] = {}
    for path in _walk(BACKEND, (".py",)):
        text = path.read_text(encoding="utf-8", errors="replace")
        for pattern in patterns:
            for name in pattern.findall(text):
                reads.setdefault(name, set()).add(str(path.relative_to(REPO_ROOT)))
    return reads


@pytest.fixture(scope="module")
def frontend_reads() -> dict[str, set[str]]:
    pattern = re.compile(r"process\.env\.([A-Z0-9_]+)")
    reads: dict[str, set[str]] = {}
    for path in _walk(FRONTEND, (".ts", ".tsx", ".js", ".mjs", ".cjs")):
        text = path.read_text(encoding="utf-8", errors="replace")
        for name in pattern.findall(text):
            reads.setdefault(name, set()).add(str(path.relative_to(REPO_ROOT)))
    return reads


@pytest.fixture(scope="module")
def env_example() -> dict[str, list[bool]]:
    return _declarations(REPO_ROOT / ".env.example")


def test_every_variable_the_backend_reads_is_declared(backend_reads, env_example):
    """An undeclared variable silently falls back to a default — which for
    `SECRET_KEY` is a hard failure, but for `PLATFORM_FEE_PER_TICKET` is
    charging the wrong fee with no error at all."""
    missing = sorted(name for name in backend_reads if name not in env_example)
    assert not missing, f"read by code but absent from .env.example: {missing}\n" + "\n".join(
        f"  {n}: {sorted(backend_reads[n])[:2]}" for n in missing
    )


def test_no_active_declaration_is_unread(backend_reads, frontend_reads, env_example):
    """A declared variable nothing reads looks like configuration and is not.

    Commented-out entries are exempt: they document where a credential will
    live once its integration exists (Google OAuth).
    """
    orphans = sorted(
        name
        for name, states in env_example.items()
        if not all(states)  # at least one ACTIVE declaration
        and name not in backend_reads
        and name not in frontend_reads
        and name not in FRAMEWORK_OWNED
        and name not in SDK_OWNED
        and name not in COMPOSE_OWNED
        and name not in CREDENTIALS_HELD_PENDING_INTEGRATION
    )
    assert not orphans, f"declared and active in .env.example but read by nothing: {orphans}"


def test_env_and_env_example_declare_the_same_variables(env_example):
    """Drift between them is how a working local setup stops reproducing."""
    real = REPO_ROOT / ".env"
    if not real.exists():
        pytest.skip(".env is not present (CI)")

    declared_real = {n for n, states in _declarations(real).items() if not all(states)}
    declared_example = {n for n, states in env_example.items() if not all(states)}

    assert declared_real == declared_example, (
        f"only in .env: {sorted(declared_real - declared_example)}\n"
        f"only in .env.example: {sorted(declared_example - declared_real)}"
    )


@pytest.mark.parametrize("relative", [".env.example", ".env", "frontend/.env.local.example"])
def test_no_variable_is_declared_twice(relative):
    """A second active declaration silently wins, so the value somebody reads
    in the file is not the value the process gets."""
    path = REPO_ROOT / relative
    if not path.exists():
        pytest.skip(f"{relative} is not present")

    duplicates = {
        name: states.count(False)
        for name, states in _declarations(path).items()
        if states.count(False) > 1
    }
    assert not duplicates, f"{relative} declares these more than once: {duplicates}"


def test_the_frontend_example_matches_what_the_frontend_reads(frontend_reads):
    declared = _declarations(FRONTEND / ".env.local.example")
    app_reads = {
        name
        for name in frontend_reads
        if name.startswith("NEXT_PUBLIC_") and name not in FRONTEND_TOOLING
    }

    missing = sorted(app_reads - set(declared))
    assert not missing, f"read by the frontend but absent from its example: {missing}"

    orphans = sorted(
        name
        for name in declared
        if name.startswith("NEXT_PUBLIC_")
        and name not in frontend_reads
        # Same narrow exemption as the backend's: a credential the operator
        # holds ahead of the code that will read it, declared with an explicit
        # "nothing reads this yet" warning beside it.
        and name not in CREDENTIALS_HELD_PENDING_INTEGRATION
    )
    assert not orphans, f"declared in the frontend example but read by nothing: {orphans}"


def test_no_backend_secret_leaks_into_the_frontend_example():
    """Everything NEXT_PUBLIC_ is inlined into the client bundle, so a secret
    declared here is a secret published to every visitor.

    Only DECLARATION lines are inspected — the prose in that file discusses
    secrets at length precisely to warn against putting them there, and a
    check that read the commentary would fail on its own warning.
    """
    text = (FRONTEND / ".env.local.example").read_text(encoding="utf-8")

    declarations = [
        line.strip()
        for line in text.splitlines()
        if re.match(r"^[A-Z][A-Z0-9_]*\s*=", line.strip())
    ]

    for line in declarations:
        name = line.split("=", 1)[0].strip()
        assert name.startswith("NEXT_PUBLIC_"), (
            f"{name} is declared in the frontend example without the NEXT_PUBLIC_ "
            "prefix. Next.js will not expose it, so either it is dead config or "
            "it is a secret that does not belong in this file."
        )
        # A NEXT_PUBLIC_ name that reads like a secret is the dangerous case:
        # the prefix means it WILL be published, so the name is the only
        # signal anyone gets.
        for forbidden in ("SECRET", "PRIVATE", "PASSWORD"):
            assert forbidden not in name.upper(), (
                f"{name} is declared in the frontend example and would be "
                f"inlined into the client bundle for anyone to read."
            )


def test_every_variable_is_documented(backend_reads, frontend_reads):
    """ENVIRONMENT_VARIABLES.md is the stated single source of truth, so a
    variable missing from it is a variable nobody will know to set."""
    doc = REPO_ROOT / "ENVIRONMENT_VARIABLES.md"
    if not doc.exists():
        pytest.skip("ENVIRONMENT_VARIABLES.md is not present")

    text = doc.read_text(encoding="utf-8")
    undocumented = sorted(
        name
        for name in set(backend_reads) | {n for n in frontend_reads if n.startswith("NEXT_PUBLIC_")}
        if f"`{name}`" not in text
    )
    assert not undocumented, f"not documented in ENVIRONMENT_VARIABLES.md: {undocumented}"


def test_a_held_credential_still_declares_itself_unread():
    """A credential kept ahead of its integration must SAY it does nothing.

    The whole risk of `CREDENTIALS_HELD_PENDING_INTEGRATION` is somebody
    pasting a real client secret into a live-looking slot and concluding that
    Google sign-in is now on. The mitigation is not the exemption list — which
    nobody reads — but a sentence in the env file next to the variable.
    """
    files = {
        FRONTEND / ".env.local.example": ("NEXT_PUBLIC_SENTRY_DSN",),
    }
    for path, names in files.items():
        text = path.read_text(encoding="utf-8")
        for name in names:
            assert name in text, f"{name} is not declared in {path.name}"
        assert "NOTHING" in text.upper() and "YET" in text.upper(), (
            f"{path.name} declares a held credential without warning that "
            "nothing consumes it yet"
        )


def test_a_held_credential_is_not_also_read_by_code(backend_reads, frontend_reads):
    """The exemption expires on its own terms.

    Once the integration ships, its variable IS read — and it must then leave
    the exemption set, or the safeguard silently stops applying to whatever is
    added next.
    """
    shipped = sorted(
        name
        for name in CREDENTIALS_HELD_PENDING_INTEGRATION
        if name in backend_reads or name in frontend_reads
    )
    assert not shipped, (
        f"these are now READ by code, so their integration has shipped: {shipped}. "
        "Remove them from CREDENTIALS_HELD_PENDING_INTEGRATION and drop the "
        '"nothing reads this yet" warning from the env file.'
    )
