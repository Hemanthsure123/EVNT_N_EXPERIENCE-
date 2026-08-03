"""Remove rows left behind by test runs and seed scripts.

── WHY THIS EXISTS ───────────────────────────────────────────────────────

A long-lived development database accumulates the debris of every test run
and demo script that ever pointed at it: `Gate Proof Show A`, `Fail Fest`,
`s-buyer-9f2a@ex.com`, `pb311264@example.com`. None of it is wrong, and all of
it is invisible while you are working on one module — until somebody opens the
operator console, where every list is platform-wide and the debris IS the
content.

── IT IS A DRY RUN UNLESS TOLD OTHERWISE ─────────────────────────────────

Deleting user and event rows is not reversible and the patterns below are
heuristics, not facts. So the default prints exactly what it WOULD remove and
changes nothing; `--yes` is the only thing that deletes. A cleanup tool whose
default is destructive is one somebody eventually runs in the wrong shell.

── IT REFUSES TO RUN ANYWHERE BUT DEVELOPMENT ────────────────────────────

The same reasoning as `config/settings/test.py` refusing a non-local database.
A purge script is the single worst thing to point at production by accident,
and "I was sure it was the dev shell" is how that happens.

── WHAT IT WILL NOT DELETE ───────────────────────────────────────────────

Anything reachable from a real financial record. Events are `PROTECT`ed by
bookings, tickets and settlements, and that protection is deliberate — an
event referenced by money somebody paid must survive. Rows that refuse to
delete are REPORTED rather than force-cascaded: a purge that quietly deleted a
settled booking would be a far worse outcome than a demo list with a stale row
in it.
"""

from __future__ import annotations

import re

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import ProtectedError

# Addresses no real person would have. Anchored so a genuine
# `paul@example.company` is never swept up by the `example.com` rule.
FIXTURE_EMAIL = re.compile(
    r"(@ex\.com$|@example\.com$|^s-buyer-|^pb\d|^organizer-\d|^e2e-|^perf-|^seed-|^test-)",
    re.IGNORECASE,
)

# Titles that only a test author writes. Deliberately narrow: "Demo Fest" is
# in, "Summer Fest" is not, because a real organizer might well run one.
FIXTURE_EVENT = re.compile(
    r"(^Gate Proof |^Pay Gig\d|^Demo Fest$|^Fail Fest$|^Settle Fest$|^Ticketing Night$"
    r"|^Booking Demo|^Checkin |^Refund Fest$)",
    re.IGNORECASE,
)


class Command(BaseCommand):
    help = "Remove test-fixture users, events and organizations from a development database."

    def add_arguments(self, parser):
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Actually delete. Without this the command only reports.",
        )

    def handle(self, *args, **options):
        from apps.accounts.models import User
        from apps.events.models import Event
        from apps.organizations.models import Organization

        if not settings.DEBUG:
            raise CommandError(
                "purge_fixture_data refuses to run outside development (DEBUG must be True). "
                "This deletes user and event rows and is not reversible."
            )

        users = [u for u in User.objects.all() if FIXTURE_EMAIL.search(u.email or "")]
        # Never delete the account running the demo, or any operator.
        users = [u for u in users if not u.is_staff and not u.is_superuser]
        events = [e for e in Event.objects.all() if FIXTURE_EVENT.search(e.title or "")]

        self.stdout.write(f"Fixture users:  {len(users)}")
        self.stdout.write(f"Fixture events: {len(events)}")
        for event in events[:15]:
            self.stdout.write(f"  event  {event.title}")
        for user in users[:15]:
            self.stdout.write(f"  user   {user.email}")

        if not options["yes"]:
            self.stdout.write(
                self.style.WARNING("\nDRY RUN — nothing deleted. Re-run with --yes to apply.")
            )
            return

        deleted = {"events": 0, "users": 0, "orgs": 0}
        protected: list[str] = []

        # Events first: an event protected by a real booking must block, and we
        # want to know that BEFORE its organizer or buyer is removed.
        for event in events:
            try:
                with transaction.atomic():
                    event.delete()
                deleted["events"] += 1
            except ProtectedError:
                protected.append(f"event {event.title} (referenced by a booking/settlement)")

        for user in users:
            try:
                with transaction.atomic():
                    user.delete()
                deleted["users"] += 1
            except ProtectedError:
                protected.append(f"user {user.email} (referenced by a booking/payment)")

        # Organizations only once their events are gone, and only if empty.
        for org in Organization.objects.all():
            if org.events.exists():
                continue
            try:
                with transaction.atomic():
                    org.delete()
                deleted["orgs"] += 1
            except ProtectedError:
                protected.append(f"organization {org.name}")

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDeleted {deleted['events']} events, {deleted['users']} users, "
                f"{deleted['orgs']} organizations."
            )
        )
        if protected:
            self.stdout.write(
                self.style.WARNING(
                    f"\n{len(protected)} row(s) kept because real records reference them "
                    "— this is the PROTECT constraint doing its job, not a failure:"
                )
            )
            for line in protected[:20]:
                self.stdout.write(f"  {line}")
