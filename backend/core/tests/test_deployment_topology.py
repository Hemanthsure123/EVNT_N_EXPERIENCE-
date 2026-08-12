"""The deployment topology, asserted from the repository.

Every one of these encodes a failure the production readiness audit found by
reading files, and none of which any other test could have caught — the
application was correct and its deployment was not.

They parse the compose and Docker files rather than running anything, so they
work in CI with no Docker daemon.
"""

from __future__ import annotations

import re
from datetime import date
from pathlib import Path
from typing import Any

import pytest

yaml = pytest.importorskip("yaml", reason="PyYAML is needed to parse the compose files")

REPO_ROOT = Path(__file__).resolve().parents[3]
COMPOSE = REPO_ROOT / "docker-compose.yml"
OVERRIDE = REPO_ROOT / "docker-compose.override.yml"
DOCKERFILE = REPO_ROOT / "backend" / "Dockerfile"

pytestmark = pytest.mark.skipif(
    not COMPOSE.exists(),
    reason="repository root not mounted (running inside the backend container)",
)


def _load(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


@pytest.fixture(scope="module")
def production() -> dict:
    return _load(COMPOSE)


@pytest.fixture(scope="module")
def development() -> dict:
    return _load(OVERRIDE)


class TestNoHiddenEnvironmentOverrides:
    """The audit's most consequential finding.

    `environment:` outranks `env_file:` in Compose. The production file set
    DATABASE_URL and REDIS_URL there, so a carefully configured Supabase and
    Upstash in `.env` were silently ignored and every write went to a local
    Postgres — with nothing anywhere saying so.
    """

    def test_the_production_file_overrides_no_environment_variable(self, production):
        offenders = {
            name: sorted(service.get("environment") or {})
            for name, service in production["services"].items()
            if service.get("environment")
        }
        assert not offenders, (
            "docker-compose.yml sets environment variables that would silently "
            f"outrank .env: {offenders}. Development overrides belong in "
            "docker-compose.override.yml."
        )

    def test_every_production_service_reads_dot_env(self, production):
        for name, service in production["services"].items():
            assert ".env" in (service.get("env_file") or []), f"{name} does not read .env"

    def test_the_database_is_NOT_overridden_in_development(self, development):
        """`DATABASE_URL` is now deliberately ABSENT from the dev overrides.

        This test used to assert the opposite — that development pinned
        `DATABASE_URL` to a local PgBouncer — on the reasoning that local work
        must not write to Supabase. That reasoning was sound for a throwaway
        local database and became wrong the moment Supabase WAS the intended
        target: the override made the carefully configured URL in `.env` inert,
        which is the precedence trap this whole file exists to police, sprung
        in the file that documents it.

        The guard it was really providing is `pytest` never reaching a managed
        database. That now lives where it cannot be undone by editing a compose
        file: `config/settings/test.py` refuses a non-local host outright.

        The local pair is still here behind the `localdb` profile, exactly as
        the local Redis is behind `local-redis`, and for the same reason — a
        running container nothing connects to reads, to the next person, as the
        thing the app is using.
        """
        web_env = development["services"]["web"]["environment"]
        for name in ("DATABASE_URL", "DIRECT_DATABASE_URL", "STORAGE_BACKEND"):
            assert name not in web_env, (
                f"docker-compose.override.yml sets {name}, which outranks .env "
                f"and would silently disable the managed service configured there."
            )

    def test_development_runs_settings_that_tolerate_a_real_database(self, development):
        """`config.settings.dev` REFUSES a non-local database, correctly.

        DEBUG=True plus CORS_ALLOW_ALL_ORIGINS over real data means any 500
        renders SECRET_KEY and the Razorpay secret to the caller. Now that the
        stack points at Supabase, the settings module has to be one that does
        not carry that pair — otherwise the container simply will not boot, and
        the fix somebody reaches for under time pressure is disabling the gate.
        """
        module = development["services"]["web"]["environment"]["DJANGO_SETTINGS_MODULE"]
        assert module != "config.settings.dev", (
            "development points at a real database but uses config.settings.dev, "
            "which refuses to boot against one."
        )

    def test_the_local_database_is_opt_in(self, development):
        """Same rule as the local Redis, and it earns its own test.

        A Postgres that starts on every `docker compose up` is a database
        somebody will point something at by accident — which is precisely how
        the Supabase URLs in `.env` came to be inert.
        """
        for name in ("postgres", "pgbouncer"):
            profiles = development["services"][name].get("profiles") or []
            assert "localdb" in profiles, (
                f"{name} has no profile, so `docker compose up` starts a database "
                f"nothing connects to."
            )

    def test_nothing_waits_on_the_profiled_database(self, development):
        """A `depends_on` on a service that is not started hangs the stack."""
        for name in ("web", "scheduler", "worker"):
            depends = development["services"][name].get("depends_on") or {}
            assert "pgbouncer" not in depends, f"{name} still waits on the profiled pgbouncer"
            assert "postgres" not in depends, f"{name} still waits on the profiled postgres"

    def test_development_does_not_migrate_on_boot(self, development):
        """Migrations are a compose PROFILE, never a side effect of starting.

        The dev `command:` ran `manage.py migrate` before `runserver`. Against
        a throwaway container that was merely untidy; against Supabase it is
        the auto-migrate hazard `DEPLOYMENT.md` rule 3 exists to prevent —
        unreviewed schema changes applied on every start, racing across
        replicas, with no plan printed and no confirmation.
        """
        command = development["services"]["web"].get("command") or ""
        assert (
            "migrate" not in command
        ), "the development web service migrates on boot, against a managed database"

    def test_the_cache_is_NOT_overridden_in_development(self, development):
        """`REDIS_URL` is deliberately absent from the dev overrides.

        The same precedence rule this whole file exists to police, applied in
        the other direction: `environment:` outranks `env_file:`, so an entry
        here would make the Upstash URL in `.env` inert — a managed cache
        configured, paid for, and silently unused, with nothing anywhere
        saying so.

        Development points at the SAME managed instance the deployed app does,
        because the cache is the layer where "works locally" diverges most
        from production: TLS, an off-box round trip, dropped idle connections,
        rate limits. None of that is exercised by a Redis in the next
        container.

        The local one still exists behind the `local-redis` compose profile
        for offline work — a profile rather than a running service, because a
        container nothing connects to reads, to the next person, as the thing
        the app is using.
        """
        web_env = development["services"]["web"]["environment"]
        assert "REDIS_URL" not in web_env, (
            "docker-compose.override.yml sets REDIS_URL, which outranks .env "
            "and would silently disable the managed cache."
        )

    def test_nothing_waits_on_the_profiled_redis(self, development):
        """A `depends_on` pointing at a service that is not started hangs
        `docker compose up` forever. The dependency had to go with the
        override."""
        for name in ("web", "scheduler", "worker"):
            depends = development["services"][name].get("depends_on") or {}
            assert "redis" not in depends, f"{name} still waits on the profiled redis"

    def test_the_local_redis_is_opt_in(self, development):
        redis = development["services"]["redis"]
        assert "local-redis" in (redis.get("profiles") or []), (
            "The local Redis has no profile, so `docker compose up` starts a "
            "cache nothing connects to."
        )

    def test_the_test_settings_refuse_a_managed_database_themselves(self):
        """The guard that replaced the compose override.

        `DIRECT_DATABASE_URL` is no longer pinned to a local host in
        `docker-compose.override.yml` — it points at Supabase, because
        `migrate_safe` needs the session-mode connection there. So the thing
        standing between `pytest` and a CREATE/DROP on a managed database is
        `config/settings/test.py`, and it must not be possible to reach that
        code path without tripping it.

        Asserted against the SOURCE rather than by importing the module: this
        suite is already running under those settings, so importing it proves
        only that the current URL is acceptable, not that the check exists.
        """
        source = (
            Path(__file__).resolve().parents[2] / "config" / "settings" / "test.py"
        ).read_text(encoding="utf-8")
        assert "ALLOW_REMOTE_TEST_DATABASE" in source, (
            "config/settings/test.py no longer has its non-local-host refusal, "
            "and nothing else stands between pytest and dropping a managed database."
        )

    def test_development_does_not_move_real_money_by_default(self, development):
        """Same shape as the email switch below, and for the same reason.

        This asserted a hard-coded `fake` on the grounds that "`.env` holds
        LIVE Razorpay keys". It does not — the key there is `rzp_test_`, which
        is Razorpay's sandbox and the credential you are SUPPOSED to develop
        against — so the hard-code blocked exercising the real gateway before
        production did. `PAYMENTS_BACKEND` became
        `${DEV_PAYMENTS_BACKEND:-fake}` and this test was not updated with it.

        What must hold is the DEFAULT: a fresh checkout with nothing set
        reaches no payment provider. The live-key danger is still guarded, by
        the thing that can actually check it — `check_development_settings`
        REFUSES to boot dev with an `rzp_live_` key whatever this says.
        """
        configured = development["services"]["web"]["environment"]["PAYMENTS_BACKEND"]

        assert configured in {"fake", "${DEV_PAYMENTS_BACKEND:-fake}"}, (
            f"development PAYMENTS_BACKEND is {configured!r}: it must be fake, or a "
            f"substitution whose DEFAULT is fake."
        )

    def test_development_does_not_send_real_email_by_default(self, development):
        """It is a switch now (DEV_EMAIL_PROVIDER=smtp sends for real, which is
        the only way to see what an email looks like in a client), so what
        must hold is the DEFAULT. A development container that mails real
        people the moment somebody runs a seed script is how a test fixture
        ends up in a customer's inbox."""
        configured = development["services"]["web"]["environment"]["EMAIL_PROVIDER"]

        assert configured in {"console", "${DEV_EMAIL_PROVIDER:-console}"}, (
            f"development EMAIL_PROVIDER is {configured!r}: it must be console, or a "
            f"substitution whose DEFAULT is console."
        )


class TestProductionRuntime:
    def test_the_web_process_is_gunicorn_not_runserver(self, production):
        command = " ".join(production["services"]["web"]["command"])
        assert "gunicorn" in command
        # `runserver` is single-threaded, auto-reloading and has no request
        # timeout. Django's own docs call it unsuitable for production.
        assert "runserver" not in command

    def test_nothing_migrates_on_boot(self, production):
        """Auto-migrate on start applied unreviewed schema changes on every
        deploy and raced itself across replicas."""
        for name, service in production["services"].items():
            if name == "migrate":
                continue
            command = " ".join(service.get("command") or [])
            assert "migrate" not in command, f"{name} runs a migration at startup"

    def test_migrations_are_behind_a_profile_so_they_never_run_automatically(self, production):
        migrate = production["services"]["migrate"]
        assert migrate.get("profiles") == ["migrate"]
        assert migrate.get("restart") == "no"
        # `migrate_safe`, not `migrate`: it uses the session-mode connection,
        # shows the plan, requires confirmation and takes an advisory lock.
        assert "migrate_safe" in " ".join(migrate["command"])

    def test_graceful_shutdown_outlives_gunicorns_graceful_timeout(self, production):
        """A SIGTERM mid-request during a deploy can land between recording a
        payment and issuing the ticket. The stop grace period must exceed
        gunicorn's own graceful timeout or Docker kills the worker first."""
        grace = production["services"]["web"].get("stop_grace_period", "")
        seconds = int(re.sub(r"\D", "", str(grace)) or 0)

        gunicorn_conf = (REPO_ROOT / "backend" / "docker" / "gunicorn.conf.py").read_text(
            encoding="utf-8"
        )
        match = re.search(r'WEB_GRACEFUL_TIMEOUT", (\d+)', gunicorn_conf)
        assert match, "graceful_timeout not found in gunicorn.conf.py"
        assert seconds > int(match.group(1))

    def test_the_web_service_has_a_healthcheck(self, production):
        assert production["services"]["web"].get("healthcheck")

    def test_production_mounts_no_source_code(self, production):
        """A bind mount ships host source into the container, so the image is
        not what actually runs."""
        for name, service in production["services"].items():
            assert not service.get("volumes"), f"{name} bind-mounts a volume in production"


class TestWorkerCount:
    """The worker count is bounded by the connection POOLER, not by the CPU.

    Every worker holds its own database connections and the scheduler and
    outbox worker draw from the same Supabase client limit, so `(2*cores)+1` on
    a large host exhausts the pooler — and the failure presents as a database
    outage rather than as too many workers.
    """

    @staticmethod
    def _resolve(environment: dict[str, str]) -> dict:
        """Execute the real config file, which is the only thing that decides
        this — a regex over it would pass on a file that no longer works."""
        import os
        from unittest import mock

        namespace: dict = {}
        source = (REPO_ROOT / "backend" / "docker" / "gunicorn.conf.py").read_text(encoding="utf-8")
        with mock.patch.dict(os.environ, environment, clear=False):
            exec(compile(source, "gunicorn.conf.py", "exec"), namespace)
        return namespace

    def test_the_computed_default_is_capped(self):
        from unittest import mock

        # A 32-core host would otherwise ask for 65 workers.
        with mock.patch("multiprocessing.cpu_count", return_value=32):
            namespace = self._resolve({"WEB_CONCURRENCY": ""})
        assert namespace["workers"] == namespace["POOLER_SAFE_WORKERS"]

    def test_a_small_host_is_not_padded_up_to_the_cap(self):
        from unittest import mock

        with mock.patch("multiprocessing.cpu_count", return_value=2):
            namespace = self._resolve({"WEB_CONCURRENCY": ""})
        assert namespace["workers"] == 5

    def test_an_explicit_value_is_honoured_not_silently_clamped(self, capsys):
        """Silently discarding a value an operator set is the same failure mode
        as compose's `environment:` outranking `env_file:` — which is the bug
        this whole configuration exists to make impossible. It is honoured, and
        the risk is printed."""
        namespace = self._resolve({"WEB_CONCURRENCY": "32"})
        assert namespace["workers"] == 32
        assert "exceeds the pooler-safe ceiling" in capsys.readouterr().err

    def test_an_explicit_safe_value_is_silent(self, capsys):
        namespace = self._resolve({"WEB_CONCURRENCY": "4"})
        assert namespace["workers"] == 4
        assert capsys.readouterr().err == ""

    def test_the_health_endpoint_is_filtered_only_when_it_succeeds(self):
        """A 503 from /health/ means the database or cache is down, which is
        exactly the line somebody will be looking for."""
        namespace = self._resolve({})
        # NOT `docker.gunicorn_logging`: gunicorn resolves this by importing the
        # dotted path, and `docker` is also a widely installed PyPI package —
        # which of the two wins would depend on sys.path order.
        assert namespace["logger_class"] == "core.gunicorn_logging.QuietHealthLogger"

        source = (REPO_ROOT / "backend" / "core" / "gunicorn_logging.py").read_text(
            encoding="utf-8"
        )
        assert 'startswith("2")' in source

    def test_forwarded_headers_are_not_trusted_from_everywhere(self):
        """`*` lets a client that can reach the container assert
        `X-Forwarded-Proto: https` and defeat SECURE_SSL_REDIRECT, and forge its
        own source IP past every IP-keyed rate limit."""
        namespace = self._resolve({})
        assert namespace["forwarded_allow_ips"] != "*"

    def test_the_app_is_not_preloaded_before_forking(self):
        """`config/di.py` builds a Redis client at import. Forking after that
        gives every worker a copy of one socket, and concurrent use of it from
        several processes corrupts the protocol."""
        assert self._resolve({})["preload_app"] is False


class TestWorkerTopology:
    """WITHOUT THESE PROCESSES held inventory is never released and
    ORGANIZERS ARE NEVER PAID. Neither existed in the compose file."""

    def test_the_scheduler_is_deployed(self, production):
        command = " ".join(production["services"]["scheduler"]["command"])
        assert "run_scheduled_jobs" in command

    def test_the_outbox_worker_is_deployed(self, production):
        command = " ".join(production["services"]["worker"]["command"])
        assert "config.worker" in command

    def test_the_scheduler_runs_exactly_one_replica(self, production):
        # Two schedulers double-fire every job. The tasks are idempotent so it
        # would be survivable, not correct.
        assert production["services"]["scheduler"]["deploy"]["replicas"] == 1

    def test_long_running_processes_restart_on_failure(self, production):
        for name in ("web", "scheduler", "worker"):
            assert production["services"][name].get("restart") == "unless-stopped"

    def test_every_scheduled_job_has_a_process_that_can_run_it(self):
        """The schedule and the deployment must agree.

        A job on the schedule with nothing deployed to fire it is exactly the
        state the audit found.
        """
        from core.scheduling import SCHEDULE

        assert SCHEDULE, "no jobs scheduled"
        names = {job.task_name for job in SCHEDULE}
        assert "booking.release_expired" in names
        assert "settlements.release_due" in names


class TestImagePackaging:
    def test_the_image_installs_the_extras_its_backends_need(self):
        """`pip install -e .` installed base dependencies only, so
        `PAYMENTS_BACKEND=razorpay` had no razorpay package and the first
        checkout raised ModuleNotFoundError."""
        text = DOCKERFILE.read_text(encoding="utf-8")
        assert 'pip install -e ".[${INSTALL_EXTRAS}]"' in text

        match = re.search(r'INSTALL_EXTRAS="([^"]+)"', text)
        assert match, "INSTALL_EXTRAS build arg not found"
        extras = set(match.group(1).split(","))
        # The four this platform selects. `gcp` is deliberately absent.
        assert {"razorpay", "push", "observability", "s3"} <= extras

    def test_every_extra_named_in_the_image_exists_in_pyproject(self):
        text = DOCKERFILE.read_text(encoding="utf-8")
        match = re.search(r'INSTALL_EXTRAS="([^"]+)"', text)
        assert match, "INSTALL_EXTRAS build arg not found"
        extras = set(match.group(1).split(","))

        pyproject = (REPO_ROOT / "backend" / "pyproject.toml").read_text(encoding="utf-8")
        declared = set(re.findall(r"^(\w[\w-]*) = \[", pyproject, re.MULTILINE))
        missing = extras - declared
        assert not missing, f"Dockerfile installs extras pyproject does not declare: {missing}"

    def test_ci_installs_every_extra_the_production_image_does(self):
        """Otherwise a vendor SDK's tests SKIP in CI, and a skip is
        indistinguishable from a pass in a green run.

        `core/tests/test_s3_storage_adapter.py` was 14 silent skips until CI
        installed the `s3` extra — the same "green because nobody looked"
        shape as the image that shipped without razorpay.
        """
        workflow = REPO_ROOT / ".github" / "workflows" / "ci.yml"
        if not workflow.exists():
            pytest.skip("no CI workflow in this checkout")

        dockerfile = DOCKERFILE.read_text(encoding="utf-8")
        match = re.search(r'INSTALL_EXTRAS="([^"]+)"', dockerfile)
        assert match, "INSTALL_EXTRAS build arg not found"
        image_extras = set(match.group(1).split(","))

        text = workflow.read_text(encoding="utf-8")
        installed: set[str] = set()
        for group in re.findall(r'pip install -e "\.\[([^\]]+)\]"', text):
            installed |= {extra.strip() for extra in group.split(",")}

        missing = image_extras - installed
        assert not missing, (
            f"CI does not install {sorted(missing)}, so any test needing those "
            f"SDKs skips silently. Update the install step in .github/workflows/ci.yml."
        )

    def test_the_container_does_not_run_as_root(self):
        assert re.search(r"^USER\s+appuser", DOCKERFILE.read_text(encoding="utf-8"), re.MULTILINE)

    def test_the_image_declares_a_healthcheck(self):
        assert "HEALTHCHECK" in DOCKERFILE.read_text(encoding="utf-8")


# ══════════════════════════════════════════════════════════════════════════
# THE EC2 TOPOLOGY
#
# `docker-compose.ec2.yml` is an OVERLAY on the production file above. These
# assert the things about it that no other test can see and that a reviewer
# would otherwise have to hold in their head — every one of them a way the
# site goes down or leaks with nothing in the application failing.
#
# They parse YAML rather than shelling out to `docker compose config`, so they
# run in CI with no Docker daemon. `docker compose config` IS also run in CI
# (.github/workflows/ci.yml), which is what catches a merge-key or
# interpolation error these cannot.
# ══════════════════════════════════════════════════════════════════════════

EC2 = REPO_ROOT / "docker-compose.ec2.yml"


def _code_only(text: str) -> str:
    """Strip whole-line `#` comments.

    Every "this must NOT appear" assertion below has to run against what
    EXECUTES, not against the prose explaining why it is absent. Otherwise a
    comment saying "the runner holds no .pem" fails a test asserting there is
    no `.pem` — and the tempting fix is deleting the explanation.
    """
    return "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))


def _compose_loader():
    """A SafeLoader that tolerates Compose's own tags.

    `ports: !reset []` is Compose 2.24+ syntax for "clear the inherited
    value". `yaml.safe_load` raises on the unknown tag, so without this the
    test file would fail to parse the very file it exists to protect.

    Built with `type()` rather than a `class` statement because `yaml` here is
    `pytest.importorskip`'s return value — mypy sees `Any`, and cannot resolve
    a base class it cannot name.
    """
    loader: Any = type("_ComposeLoader", (yaml.SafeLoader,), {})
    for tag in ("!reset", "!override"):
        loader.add_constructor(tag, lambda ldr, node: ldr.construct_sequence(node))
    return loader


@pytest.fixture(scope="module")
def ec2() -> dict:
    return yaml.load(EC2.read_text(encoding="utf-8"), Loader=_compose_loader()) or {}


@pytest.mark.skipif(not EC2.exists(), reason="no EC2 overlay in this checkout")
class TestEc2Topology:
    def test_caddy_is_the_only_service_with_host_ports(self, ec2):
        """Everything reaches the internet through TLS, or not at all.

        The base file publishes web on 8000, which is right for a host with
        nothing in front of it. Behind Caddy it puts Django on the public
        internet unencrypted, bypassing the forwarded-header contract and the
        single-origin routing — and a browser that reached it would send a JWT
        in clear text.
        """
        for name, svc in ec2["services"].items():
            if name == "caddy":
                continue
            assert not svc.get("ports"), (
                f"'{name}' publishes host ports {svc.get('ports')} in the EC2 "
                f"overlay. Only caddy may. Use `expose:` for internal reachability."
            )

    def test_the_inherited_web_port_is_actually_cleared(self, ec2):
        """`ports: !reset []`, not `ports: []`.

        Compose MERGES `ports` lists across files: an override that restates
        the key APPENDS to the inherited value rather than replacing it, so
        `ports: []` here would leave 8000 published and the check above would
        still pass by reading only this file. `!reset` is the one tag that
        clears it.
        """
        assert (
            "ports" in ec2["services"]["web"]
        ), "web must explicitly clear the port published by docker-compose.yml"
        raw = EC2.read_text(encoding="utf-8")
        assert re.search(r"^\s*ports:\s*!reset\s*\[\]", raw, re.MULTILINE), (
            "web's inherited `8000:8000` is cleared with `ports: !reset []`. "
            "A plain `ports: []` MERGES and leaves 8000 public."
        )

    def test_the_backend_is_still_reachable_internally(self, ec2):
        """Clearing the publish must not also make Caddy unable to route."""
        assert "8000" in [str(p) for p in ec2["services"]["web"].get("expose", [])]

    def test_no_database_and_no_cache_run_on_the_box(self, ec2):
        """Supabase and Upstash are the database and the cache.

        A local Postgres on a 3.7 GiB box competes with the application for
        memory and — worse — invites somebody to point DATABASE_URL at it,
        after which bookings are written to a database with no backups that
        vanishes with the instance.
        """
        forbidden = {"db", "postgres", "postgresql", "redis", "pgbouncer", "valkey"}
        present = forbidden & set(ec2["services"])
        assert not present, (
            f"{sorted(present)} must not run on the EC2 host — the database is "
            f"Supabase and the cache is Upstash. docker-compose.oci.yml is the "
            f"single-box topology; that is a different deployment."
        )
        volumes = set(ec2.get("volumes") or {})
        assert not volumes & {"eventful-pgdata", "pgdata", "redis-data"}

    def test_every_long_running_process_is_present(self, ec2, production):
        """web, worker, scheduler, frontend, caddy — all five.

        Losing `scheduler` is the expensive one and the quietest: held ticket
        inventory is never released and organisers are never paid, with no
        error anywhere, because the jobs stay registered and simply never
        fire. Losing `worker` means no email, SMS or push is ever delivered.
        """
        defined = set(ec2["services"]) | set(production["services"])
        for required in ("web", "worker", "scheduler", "frontend", "caddy"):
            assert required in defined, (
                f"'{required}' is gone from the EC2 topology. "
                f"docker-compose.ec2.yml records what each one carries."
            )

    def test_every_service_rotates_its_logs(self, ec2):
        """The single most likely way this box falls over.

        Docker's default json-file driver has NO size limit. Five always-on
        containers on a 30 GB disk fill it, and the failure presents as every
        service dying at once for no visible reason.
        """
        raw = EC2.read_text(encoding="utf-8")
        assert "max-size" in raw and "max-file" in raw, "log rotation limits removed"
        for name, svc in ec2["services"].items():
            options = (svc.get("logging") or {}).get("options") or {}
            assert options.get("max-size"), f"'{name}' has no log size limit"
            assert options.get("max-file"), f"'{name}' has no log file count limit"

    def test_caddy_certificates_survive_a_redeploy(self, ec2):
        """Let's Encrypt allows 5 certificates per domain per week.

        Without a persistent /data, every `up` re-issues. The fifth deploy in
        a week leaves the site without HTTPS for days, with nothing broken in
        the application to explain it.
        """
        mounts = [m for m in ec2["services"]["caddy"]["volumes"] if isinstance(m, str)]
        targets = {m.split(":")[1] for m in mounts if ":" in m}
        assert "/data" in targets, "caddy's /data volume is what stores issued certificates"
        assert "/config" in targets
        declared = set(ec2.get("volumes") or {})
        assert {"caddy-data", "caddy-config"} <= declared, (
            "the certificate volumes must be NAMED volumes; a bind mount into "
            "the checkout would be wiped by a fresh clone"
        )

    def test_the_caddyfile_is_mounted_read_only(self, ec2):
        assert any(
            m.endswith(":ro") and "Caddyfile" in m
            for m in ec2["services"]["caddy"]["volumes"]
            if isinstance(m, str)
        )

    def test_caddy_is_health_checked_through_its_admin_api(self, ec2):
        """A process check would report healthy while Caddy sat refusing a bad
        Caddyfile — which is exactly the failure that takes the whole site
        down, because every route lives in that file. The admin API answers
        only once a config has been parsed AND loaded."""
        test = str(ec2["services"]["caddy"].get("healthcheck", {}).get("test", ""))
        assert "2019" in test, "caddy's healthcheck must prove a config is loaded"

    def test_the_images_are_not_pinned_to_latest(self, ec2):
        """A rollback needs something to roll back TO.

        `latest` is a moving pointer: two deploys of it can ship different
        code, and `deploy/deploy.sh` refuses any tag that is not a 40-char
        commit SHA. The overlay must therefore take the ref from the
        environment rather than hard-coding one.
        """
        # `migrate` belongs in this list and is the one that was missed. Left
        # on the base file's `eventful-backend:latest` it names an image that
        # does not exist on the host, so Compose either pulls
        # `docker.io/library/eventful-backend` — an UNCLAIMED public name, i.e.
        # a stranger's image run with the production .env attached — or builds
        # from source on the box. Either way the SCHEMA would be migrated by
        # code that is not the reviewed, scanned artefact about to serve.
        for name in ("web", "worker", "scheduler", "migrate"):
            assert "${BACKEND_IMAGE" in str(
                ec2["services"][name].get("image", "")
            ), f"'{name}' must run the SHA-tagged image deploy.sh exports"
        assert "${FRONTEND_IMAGE" in str(ec2["services"]["frontend"].get("image", ""))

    def test_nothing_migrates_on_boot(self, ec2):
        """Same rule as the base file, restated for the overlay.

        Auto-migrate applies unreviewed schema changes on every deploy and
        races itself across replicas. `deploy/deploy.sh` runs `migrate_safe`
        as an explicit, ordered step instead.
        """
        for name, svc in ec2["services"].items():
            command = str(svc.get("command", "")) + str(svc.get("entrypoint", ""))
            assert "migrate" not in command, f"'{name}' migrates on boot"

    def test_no_source_is_mounted_over_the_images(self, ec2):
        """The image is the artefact. A bind mount means what runs in
        production is whatever happens to be in the checkout, and a rollback
        to a previous image changes nothing."""
        for name, svc in ec2["services"].items():
            if name == "caddy":
                continue  # the Caddyfile, read-only, asserted above
            for mount in svc.get("volumes") or []:
                assert not str(mount).startswith(
                    ("./backend", "./frontend", "./config")
                ), f"'{name}' mounts source over the image: {mount}"

    def test_the_frontend_public_urls_are_build_args(self, ec2):
        """`NEXT_PUBLIC_*` is inlined into the client bundle by the compiler.

        Setting one in `.env` and restarting does nothing — the single most
        common source of "I changed the API URL and it still calls the old
        one". The two that cannot be wrong use `:?`, so a build without them
        fails at build time rather than in a visitor's browser.
        """
        args = ec2["services"]["frontend"]["build"]["args"]
        assert ":?" in str(args["NEXT_PUBLIC_API_BASE_URL"])
        assert ":?" in str(args["NEXT_PUBLIC_SITE_URL"])

    def test_no_secret_is_written_into_the_compose_file(self, ec2):
        """Everything secret arrives via `env_file: .env`, which is rendered
        from Secrets Manager on the instance. A value inline here would be in
        git, in every clone, and in the workflow that checks it out."""
        raw = EC2.read_text(encoding="utf-8")
        for marker in ("rzp_live_", "rzp_test_", "SECRET_KEY:", "postgres://", "postgresql://"):
            assert marker not in raw, f"'{marker}' looks like a secret in the compose file"


@pytest.mark.skipif(not EC2.exists(), reason="no EC2 overlay in this checkout")
class TestDeployScripts:
    """`deploy/deploy.sh` runs on the instance, so its guards are the last
    ones standing when somebody deploys by hand."""

    deploy = REPO_ROOT / "deploy" / "deploy.sh"
    render = REPO_ROOT / "deploy" / "render-env.sh"

    def test_it_refuses_a_mutable_tag(self):
        body = self.deploy.read_text(encoding="utf-8")
        assert 'tag" = "latest"' in body and "-ne 40" in body, (
            "deploy.sh must refuse `latest` and any tag that is not a 40-char "
            "commit SHA — a hand-run deploy must not bypass the rule the "
            "workflow enforces."
        )

    def test_it_refuses_a_world_readable_env_file(self):
        body = self.deploy.read_text(encoding="utf-8")
        assert "600" in body and ".env is missing" in body

    def test_it_migrates_before_starting_new_containers(self):
        """New code requires the new schema: 0004 adds `BookingRequest.kind`
        and every `kind` query 500s without it. The reverse order means every
        request between `up` and `migrate` fails."""
        body = self.deploy.read_text(encoding="utf-8")
        assert body.index("migrate_safe") < body.index("up -d --no-deps")

    def test_it_pulls_before_it_stops_anything(self):
        """A registry outage or a bad tag then fails while the current version
        is still serving."""
        body = self.deploy.read_text(encoding="utf-8")
        assert body.index("docker pull") < body.index("up -d --no-deps")

    def test_the_secret_renderer_never_prints_a_value(self):
        """A rendered secret in an SSM or workflow log is a leaked secret —
        those logs are retained, searchable, and readable by more people than
        the secret itself is."""
        body = self.render.read_text(encoding="utf-8")
        assert "umask 077" in body, "the file must be 600 from the instant it exists"
        assert "cat " not in body
        assert "set -x" not in body

    def test_the_renderer_keeps_a_working_env_when_the_secret_is_wrong(self):
        """Overwriting a good `.env` with a truncated one takes the site down
        with no way back that does not involve AWS."""
        body = self.render.read_text(encoding="utf-8")
        assert "left untouched" in body

    def test_it_authenticates_to_ecr_before_pulling(self):
        """THE INSTANCE ROLE IS NOT ENOUGH ON ITS OWN.

        IAM authorises the ECR *API*; `docker pull` speaks the *registry*
        protocol and needs a registry credential. Without a login every pull
        fails with `no basic auth credentials` — which reads like a missing IAM
        permission and is not one, so the fix people reach for is widening the
        role, which does nothing.
        """
        body = _code_only(self.deploy.read_text(encoding="utf-8"))
        assert "get-login-password" in body, "deploy.sh never authenticates to ECR"
        assert body.index("get-login-password") < body.index(
            "docker pull"
        ), "the ECR login must come before the first pull"
        assert "--password-stdin" in body, (
            "the token must not reach argv, where `ps` shows it to every user " "on the machine"
        )

    def test_it_refuses_a_mismatched_backend_and_frontend(self):
        """A backend from one commit and a frontend from another is a
        combination nothing ever tested; the symptom is a UI calling an API
        contract that no longer exists."""
        body = self.deploy.read_text(encoding="utf-8")
        assert 'BACKEND_IMAGE##*:}" != "${FRONTEND_IMAGE##*:}' in body

    def test_it_records_the_rollback_target_only_after_health_checks(self):
        """`.deployed` is what the rollback job reads to find the last version
        that ACTUALLY WORKED. Written before the checks, it would record a
        broken release as the recovery target."""
        body = _code_only(self.deploy.read_text(encoding="utf-8"))
        # The exact record write, not a prefix — `> .deployed` also matches
        # `> .deployed-sha`, which is only a convenience file for humans and
        # would let the real one be deleted with this test still passing.
        assert "> .deployed <<RECORD" in body, "deploy.sh records no rollback target"
        assert ".deployed.prev" in body, "the previous record must be kept to roll back to"
        record = body.index("> .deployed <<RECORD")
        for check, label in (
            ("never became healthy", "the health poll"),
            ("is '${state:-MISSING}', not running", "the per-service running check"),
            ("crash loop", "the crash-loop check"),
        ):
            assert body.index(check) < record, (
                f"the deployment record is written before {label} — a broken "
                f"release would be recorded as the rollback target"
            )

    def test_it_removes_orphaned_containers(self):
        """A container from a service that used to be in the compose file and
        no longer is keeps running forever, holding ports and memory, with
        nothing referencing it."""
        assert "--remove-orphans" in self.deploy.read_text(encoding="utf-8")

    def test_the_renderer_encodes_values_literally(self):
        """A `$` in a secret must survive.

        In a Compose env-file a DOUBLE-quoted value is expanded and unescaped
        like a shell string — verified against a real container, not assumed:

            "ab$cd"  ->  ab          ($cd expands to an undefined variable)
            "a\\\\b"    ->  a<BS>       (\\b is read as the backspace escape)

        `django.core.management.utils.get_random_secret_key()` draws from a
        charset that INCLUDES `$`, so an ordinary SECRET_KEY would be silently
        truncated at the first one: every session invalidated, every signed
        token rejected, and no parse error anywhere. This test exists because
        the first version of the renderer double-quoted everything.

        Single quotes are literal in that grammar and carry real newlines, so
        they are the default; the double-quoted fallback (for a value
        containing a single quote) must escape `$`.
        """
        body = self.render.read_text(encoding="utf-8")
        assert (
            '"\'" not in text' in body
        ), "values must be single-quoted unless they contain a single quote"
        assert (
            '.replace("$", "\\\\$")' in body
        ), "the double-quoted fallback must escape `$`, or Compose expands it"
        # Backslash must be escaped BEFORE the others, or the escaping itself
        # forms a `\\b`/`\\t` sequence that Compose then interprets.
        fallback = body[body.index("def quote(") : body.index("out = []")]
        assert fallback.index('replace("\\\\", "\\\\\\\\")') < fallback.index('replace("$"')

    def test_the_renderer_does_not_need_jq(self):
        """Amazon Linux 2023 ships python3 and does NOT ship jq.

        Depending on jq means this script fails on a fresh instance with a
        message about a JSON tool — a confusing way to discover a packaging
        assumption, at the moment somebody is trying to configure production.
        """
        body = _code_only(self.render.read_text(encoding="utf-8"))
        assert "jq" not in body, "render-env.sh still depends on jq"
        assert "python3" in body


@pytest.mark.skipif(
    not (REPO_ROOT / ".github" / "workflows" / "release.yml").exists(),
    reason="no release workflow in this checkout",
)
class TestReleaseWorkflow:
    """The deployment pipeline's own guards, asserted from the file.

    These are cheap string checks rather than a simulated run — but each one
    encodes a defect that was actually present and would have shipped.
    """

    body = _code_only(
        (REPO_ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
    )

    def test_no_long_lived_aws_credentials(self):
        """A stored access key is standing AWS access that outlives any leak.
        OIDC mints a token per run that expires with it."""
        for forbidden in ("aws-access-key-id", "aws-secret-access-key", "AWS_SESSION_TOKEN"):
            assert forbidden not in self.body, f"{forbidden} must never appear"
        assert "id-token: write" in self.body
        assert "role-to-assume" in self.body

    def test_no_ssh_key_reaches_the_runner(self):
        """SSM needs no inbound port and no key. A `.pem` in CI is a
        credential that can be exfiltrated from a build log."""
        for forbidden in ("ssh-private-key", ".pem", "webfactory/ssh-agent"):
            assert forbidden not in self.body, f"{forbidden} must never appear"

    def test_deploy_transitively_requires_every_validation_workflow(self):
        """Nothing reaches production without CI, frontend and security having
        passed FOR THIS COMMIT.

        This used to assert the string `conclusion ci.yml` — the release job
        polled the GitHub API for its sibling workflows' results. That design
        is gone, and it is worth recording why, because the string check
        happily passed while the pipeline was incapable of deploying:

          - The poll was a race. It waited 60 x 10s per workflow; frontend E2E
            ran ~34 minutes, so release failed on a 600s timeout rather than on
            a result.
          - It could not have succeeded even when everything was green. The
            helper returned its answer on stdout AND logged to stdout, so
            `C_CI=$(conclusion ci.yml)` captured the whole transcript and was
            never equal to `success`.

        Both classes of bug are unreachable now: the validation workflows are
        `uses:` stages and the dependency is GitHub's own `needs:` graph. So
        this asserts the GRAPH, transitively — a direct-edge check would pass
        if someone inserted a job between `resolve` and `deploy`.
        """
        workflow = _load(REPO_ROOT / ".github" / "workflows" / "release.yml")
        jobs = workflow["jobs"]

        def requires(name: str) -> set[str]:
            needs = jobs[name].get("needs") or []
            needs = [needs] if isinstance(needs, str) else list(needs)
            return set(needs).union(*(requires(n) for n in needs)) if needs else set()

        for stage in ("ci", "frontend", "security"):
            assert stage in requires("deploy"), (
                f"deploy does not depend on '{stage}' — production can ship a "
                f"commit that stage never validated"
            )
            assert jobs[stage].get("uses", "").endswith(f"{stage}.yml"), (
                f"'{stage}' must CALL the real workflow; a stub job named after "
                f"it would satisfy the graph while validating nothing"
            )

        # A called workflow always runs on the caller's commit, so exact-SHA
        # safety is structural — but only while dispatch cannot name a
        # different one. An arbitrary SHA input would validate one commit and
        # deploy another, which is the stale-result hazard this design removes.
        triggers = workflow.get("on") or workflow.get(True) or {}
        dispatch = (triggers or {}).get("workflow_dispatch") or {}
        assert not (dispatch or {}).get("inputs"), (
            "workflow_dispatch takes no inputs: a SHA typed in by hand would be "
            "deployed while the validation stages ran against a different commit"
        )

        # No stage may be conditional. A gate that can be skipped is not a gate,
        # and a manual dispatch under pressure is exactly when it would be.
        for stage in ("ci", "frontend", "security", "deploy"):
            assert "if" not in jobs[stage], f"'{stage}' is conditional — it can be bypassed"

    # The frontend E2E suite is deliberately outside the deploy gate. This is
    # the date that decision expires; see the test below.
    E2E_EXCEPTION_EXPIRES = date(2026, 10, 31)

    def test_the_e2e_exception_is_real_visible_and_expiring(self):
        """E2E runs and reports, but does not gate — and cannot do so quietly.

        The suite has never passed (33 runs, 0 successes) because it is STALE,
        not flaky: 38 of 92 specs assert a home page replaced in c983c09,
        including `<HomeHero>`, a component now imported nowhere. Blocking
        every deploy on tests that describe a UI which was intentionally
        changed would mean the pipeline could never ship anything.

        What this asserts is that the exception stays HONEST:

          - the suite still RUNS in the pipeline (it is a real `uses:` stage,
            not deleted and not commented out),
          - it is NOT dressed up as passing — no `continue-on-error`, which
            would turn a red suite into a green tick,
          - and it is genuinely outside `deploy`'s dependency graph rather than
            being quietly satisfied by something else.

        The date is the part that matters most. "Temporary" with no deadline is
        how a skipped test suite becomes permanent, so this fails once the date
        passes, putting the decision back in front of a person.
        """
        release = _load(REPO_ROOT / ".github" / "workflows" / "release.yml")
        e2e_path = REPO_ROOT / ".github" / "workflows" / "frontend-e2e.yml"
        jobs = release["jobs"]

        # It must still RUN. If it is not worth running it should be deleted
        # deliberately, not left to rot as a workflow nothing triggers.
        assert e2e_path.exists(), "the E2E suite must still exist"
        e2e = _load(e2e_path)
        triggers = e2e.get("on") or e2e.get(True) or {}
        assert "push" in triggers, (
            "frontend-e2e must run on push. A suite that gates nothing AND runs "
            "nowhere is a deleted suite with extra steps."
        )
        assert "continue-on-error" not in _code_only(
            e2e_path.read_text(encoding="utf-8")
        ), "the suite must be allowed to go RED; continue-on-error hides the state"

        # ── AND IT MUST NOT BE ABLE TO DELAY A DEPLOY ──────────────────────
        #
        # It was a `uses:` stage of release.yml. A workflow run does not finish
        # until every job in it finishes, so this ~20-minute suite held the
        # `production-deploy` concurrency lock long after the deploy decision
        # was made, and the next push queued behind it. A non-blocking suite
        # that delays every deployment by twenty minutes is not non-blocking.
        assert "frontend-e2e" not in jobs, (
            "frontend-e2e is a job in release.yml again. Even excluded from "
            "`needs:`, its runtime holds this workflow's concurrency group and "
            "stalls the next deploy. It belongs in its own workflow."
        )
        for name, job in jobs.items():
            assert not str(job.get("uses", "")).endswith(
                "frontend-e2e.yml"
            ), f"job '{name}' calls frontend-e2e.yml — see above"

        assert date.today() <= self.E2E_EXCEPTION_EXPIRES, (
            f"The frontend E2E deploy-gate exception expired on "
            f"{self.E2E_EXCEPTION_EXPIRES}. Re-sync tests/e2e/*.spec.ts to the "
            f"shipped UI and put `frontend-e2e` back in `resolve`'s needs — or "
            f"make a fresh, dated decision to extend it. Do not just move the "
            f"date: see frontend/BACKLOG.md."
        )

    def test_publish_is_idempotent_against_immutable_tags(self):
        """ECR repositories are IMMUTABLE-tagged, so re-pushing an existing tag
        errors. Re-running a release for the same SHA is NORMAL — it is the
        recovery from an approval timeout, and how a rollback is triggered by
        hand — so publish must skip rather than fail.

        Parsed rather than string-matched: EVERY pushing build step needs the
        guard, and a substring check passes while one of the two is missing.
        """
        workflow = _load(REPO_ROOT / ".github" / "workflows" / "release.yml")
        pushing = [
            step
            for step in workflow["jobs"]["publish"]["steps"]
            if str(step.get("with", {}).get("push", "")).lower() == "true"
        ]
        assert len(pushing) == 2, f"expected a backend and a frontend push, found {len(pushing)}"
        for step in pushing:
            assert "skip != 'true'" in str(step.get("if", "")), (
                f"'{step.get('name')}' pushes unconditionally — a re-run of an "
                f"already-published SHA will fail on the immutable tag"
            )

    def test_the_rollback_target_is_read_from_the_instance(self):
        """Parsed from the step that actually resolves it, so a leftover
        mention elsewhere in the file cannot satisfy this."""
        workflow = _load(REPO_ROOT / ".github" / "workflows" / "release.yml")
        steps = workflow["jobs"]["rollback"]["steps"]
        resolver = next(s for s in steps if s.get("id") == "prev")
        run = _code_only(resolver["run"])
        assert ".deployed" in run, "the rollback target must come from the instance's record"
        assert "rev-parse" not in run, (
            "'the parent commit' is only the last-known-good release when every "
            "commit deploys; after two failed deploys it is something that was "
            "never in production"
        )

    def test_every_poll_outlasts_the_command_it_waits_on(self):
        """If a poll gave up first, the workflow would report failure and
        rollback would send a SECOND SSM command while the first was still
        running `docker compose up` — two deployments racing on one host.

        Compared as NUMBERS, for every step that dispatches one: a substring
        check passes while one of the two loops is still too short.
        """
        workflow = _load(REPO_ROOT / ".github" / "workflows" / "release.yml")
        checked = 0
        for job in workflow["jobs"].values():
            for step in job.get("steps", []):
                run = step.get("run") or ""
                if "executionTimeout" not in run:
                    continue
                found = [
                    re.search(pattern, run)
                    for pattern in (
                        r'executionTimeout: \["(\d+)"\]',
                        r"seq 1 (\d+)",
                        r"sleep (\d+)",
                    )
                ]
                assert all(found), (
                    f"{step.get('name')!r} dispatches an SSM command but its poll "
                    f"loop could not be read — it may not wait for the result at all"
                )
                limit, iterations, sleep_s = (int(m.group(1)) for m in found if m)
                assert iterations * sleep_s > limit, (
                    f"{step.get('name')!r} polls for {iterations * sleep_s}s but the "
                    f"command may run for {limit}s — it would abandon a live deploy"
                )
                checked += 1
        assert checked == 2, f"expected the deploy and rollback polls, checked {checked}"

    def test_ssm_parameters_are_json_not_the_comma_splitting_shorthand(self):
        """`--parameters commands=...` splits its value on commas into separate
        list elements. The base64 config bundle is exactly the kind of value
        that would be torn into fragments — silently."""
        assert "--parameters commands=" not in self.body
        assert "file:///tmp/ssm-" in self.body
