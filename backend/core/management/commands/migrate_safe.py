"""Apply migrations deliberately, through the connection that can do DDL.

Replaces `manage.py migrate --noinput` in the container start command, which
was doing three unsafe things at once:

1. Applying unreviewed schema changes to production on every container start.
2. Racing itself — with more than one replica, several processes ran `migrate`
   against the same database simultaneously.
3. Running DDL through `DATABASE_URL`, which in production is Supavisor in
   TRANSACTION mode. A transaction pooler hands each statement to whichever
   backend is free, so a multi-statement migration can be split across
   connections; `CREATE INDEX CONCURRENTLY` and advisory locks in particular
   do not survive it.

This command is invoked explicitly:

    docker compose -f docker-compose.yml --profile migrate run --rm migrate

── WHAT IT DOES DIFFERENTLY ─────────────────────────────────────────────

- **Uses `DIRECT_DATABASE_URL`** (Supavisor SESSION mode, port 5432), because
  DDL needs one backend for the duration of a statement.
- **Shows the plan and requires confirmation** in production, unless
  `--yes` is passed by a deployment pipeline that has already reviewed it.
  "It ran on boot and nobody looked" is precisely what this replaces.
- **Takes a Postgres advisory lock**, so two concurrent invocations serialise
  instead of both trying to apply the same migration.
"""

from __future__ import annotations

import sys
from typing import Any

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import connections

# Arbitrary but fixed. Any other process taking the same key waits.
_ADVISORY_LOCK_KEY = 8_101_1972


class Command(BaseCommand):
    help = "Apply database migrations through the direct (session-mode) connection."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Skip the confirmation prompt. For a pipeline that has reviewed the plan.",
        )
        parser.add_argument(
            "--plan-only",
            action="store_true",
            help="Print what WOULD be applied and exit without applying it.",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        alias = self._direct_alias()
        connection = connections[alias]

        self.stdout.write(
            self.style.WARNING(
                f"Target: {connection.settings_dict.get('HOST')}:"
                f"{connection.settings_dict.get('PORT')}"
                f"/{connection.settings_dict.get('NAME')}"
            )
        )

        # The plan first, always. An operator who cannot see what is about to
        # change has no basis for saying yes.
        self.stdout.write("")
        self.stdout.write("Pending migrations:")
        call_command("showmigrations", "--plan", database=alias, verbosity=1)
        self.stdout.write("")

        if options["plan_only"]:
            return

        if not options["yes"] and not settings.DEBUG:
            if not sys.stdin.isatty():
                raise SystemExit(
                    "Refusing to migrate a production database non-interactively.\n"
                    "Pass --yes from a pipeline that has reviewed the plan above."
                )
            answer = input("Apply these migrations? Type 'yes' to continue: ")
            if answer.strip().lower() != "yes":
                self.stdout.write(self.style.WARNING("Aborted. Nothing was applied."))
                return

        with connection.cursor() as cursor:
            # Blocking, not `try_advisory_lock`: a second deploy should WAIT
            # for the first rather than skipping migrations and starting an
            # application against a schema it does not match.
            cursor.execute("SELECT pg_advisory_lock(%s)", [_ADVISORY_LOCK_KEY])
            try:
                call_command("migrate", "--noinput", database=alias, verbosity=2)
            finally:
                cursor.execute("SELECT pg_advisory_unlock(%s)", [_ADVISORY_LOCK_KEY])

        self.stdout.write(self.style.SUCCESS("Migrations applied."))

    @staticmethod
    def _direct_alias() -> str:
        """The alias whose connection can run DDL.

        `settings.DATABASES["direct"]` is configured in base.py alongside
        `default`, pointing at DIRECT_DATABASE_URL. When that variable is
        unset (CI against a plain Postgres with no pooler in front) the two
        are identical and `default` is correct.
        """
        return "direct" if "direct" in settings.DATABASES else "default"
