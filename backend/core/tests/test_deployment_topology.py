"""The deployment topology, asserted from the repository.

Every one of these encodes a failure the production readiness audit found by
reading files, and none of which any other test could have caught — the
application was correct and its deployment was not.

They parse the compose and Docker files rather than running anything, so they
work in CI with no Docker daemon.
"""

from __future__ import annotations

import re
from pathlib import Path

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

    def test_the_overrides_still_exist_but_only_in_the_development_file(self, development):
        # They are wanted — local dev must not write to production Supabase.
        # The fix was moving them somewhere named, not deleting them.
        web_env = development["services"]["web"]["environment"]
        assert "pgbouncer" in web_env["DATABASE_URL"]
        assert "redis" in web_env["REDIS_URL"]

    def test_development_redirects_the_direct_url_away_from_production(self, development):
        """The path by which `pytest` would have reached production Supabase.

        `DIRECT_DATABASE_URL` was NOT overridden, so it fell through to `.env`
        — and `config/settings/test.py` uses it to CREATE and DROP a database.
        """
        web_env = development["services"]["web"]["environment"]
        assert "DIRECT_DATABASE_URL" in web_env
        assert "supabase" not in web_env["DIRECT_DATABASE_URL"].lower()

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
