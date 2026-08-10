"""Create or promote a platform operator account, idempotently.

── WHY A COMMAND AND NOT A SETTING ──────────────────────────────────────────

`PLATFORM_ADMIN_EMAILS` already exists and is deliberately NOT used for this.
That setting is the list of addresses operational ALERTS are mailed to, and
wiring it to grant `is_staff` would mean adding somebody to a notification list
silently hands them the operator console — privilege escalation as a side
effect of a config change nobody reviewed as one. Granting access is an
explicit, audited act, so it is an explicit, audited command.

── WHY IDEMPOTENT ───────────────────────────────────────────────────────────

It is run from a deploy runbook and re-run whenever somebody is unsure whether
it was run. Re-running must be a no-op that reports what it found, never an
error and never a second audit row claiming a second promotion.

── WHY IT MARKS THE ADDRESS VERIFIED ────────────────────────────────────────

Registration withholds a session until the address is proven, so a freshly
seeded operator who has never received the code could not sign in at all. The
address here is asserted by whoever runs the command against the database —
which is a stronger proof than an email round trip, not a weaker one.

── WHY THE PASSWORD IS OPTIONAL ─────────────────────────────────────────────

An operator signing in with Google never needs one. Omitting it sets an
UNUSABLE random password rather than a blank or a default: the account cannot
be password-signed-into until somebody sets one deliberately, which is the same
thing `GoogleSignInService._find_or_create` does for the accounts it creates.
A default password on an admin account is worse than no password on one.

Usage:

    python manage.py ensure_admin --email you@example.com
    python manage.py ensure_admin --email you@example.com --password 's3cret' --name 'Your Name'
    python manage.py ensure_admin --email you@example.com --superuser
"""

from __future__ import annotations

import secrets

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import User
from core.audit import record_audit


class Command(BaseCommand):
    help = "Create or promote a platform operator (is_staff), idempotently."

    def add_arguments(self, parser) -> None:
        parser.add_argument("--email", required=True, help="The account's email address.")
        parser.add_argument(
            "--password",
            default="",
            help=(
                "Optional. Omit for a Google-only operator — an unusable random password "
                "is set instead of a guessable default."
            ),
        )
        parser.add_argument("--name", default="", help="Display name, for a new account.")
        parser.add_argument(
            "--superuser",
            action="store_true",
            help=(
                "Also grant Django-admin superuser. Separate from --email's operator "
                "access on purpose: the console needs is_staff, and /admin/ superuser is a "
                "much broader grant that should be asked for rather than assumed."
            ),
        )
        parser.add_argument(
            "--organizer",
            action="store_true",
            help="Also mark as an organizer, so the same account can list events.",
        )

    def handle(self, *args, **options) -> None:
        email = str(options["email"]).strip().lower()
        if "@" not in email:
            raise CommandError(f"{email!r} does not look like an email address.")

        password = str(options["password"])
        name = str(options["name"]).strip()
        want_superuser = bool(options["superuser"])
        want_organizer = bool(options["organizer"])

        with transaction.atomic():
            # `select_for_update` so two concurrent runs — a deploy hook and a
            # human — cannot both decide they are creating the account.
            user = User.objects.select_for_update().filter(email__iexact=email).first()
            created = user is None

            if user is None:
                user = User.objects.create_user(
                    email=email,
                    # An unusable secret rather than a blank or a default. See
                    # the module docstring.
                    password=password or secrets.token_urlsafe(48),
                    full_name=name,
                )

            # Record what actually CHANGED, so a re-run can report "already an
            # operator" instead of implying it did something.
            changes: list[str] = []

            def grant(field: str, value: bool) -> None:
                if getattr(user, field) != value:
                    setattr(user, field, value)
                    changes.append(field)

            grant("is_staff", True)
            grant("is_active", True)
            grant("email_verified", True)
            if want_superuser:
                grant("is_superuser", True)
            if want_organizer:
                grant("is_organizer", True)
            if name and user.full_name != name:
                user.full_name = name
                changes.append("full_name")
            if password:
                user.set_password(password)
                changes.append("password")

            if changes:
                user.save()
                record_audit(
                    actor_id="system:ensure_admin",
                    action="user.admin_granted" if not created else "user.admin_created",
                    target_type="user",
                    target_id=str(user.id),
                    metadata={"email": email, "changed": sorted(changes)},
                )

        if created:
            self.stdout.write(self.style.SUCCESS(f"Created operator account {email}"))
        elif changes:
            self.stdout.write(
                self.style.SUCCESS(f"Promoted existing account {email} ({', '.join(changes)})")
            )
        else:
            self.stdout.write(f"{email} is already an operator — nothing to do.")

        self.stdout.write(
            f"  is_staff={user.is_staff}  is_superuser={user.is_superuser}  "
            f"is_organizer={user.is_organizer}  email_verified={user.email_verified}"
        )
        if not password and created:
            self.stdout.write(
                "  No password set. Sign in with Google, or run this again with "
                "--password to set one."
            )
        # The one thing somebody running this needs to know next, said here
        # rather than left to be discovered: Google sign-in matches on EMAIL,
        # so this account is what a Google sign-in with that address resolves
        # to — the operator flag is preserved rather than overwritten.
        self.stdout.write(
            "  Google sign-in matches on email, so signing in with this address "
            "lands in THIS account."
        )
