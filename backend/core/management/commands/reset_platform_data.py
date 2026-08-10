"""Empty the platform of content and accounts, keeping one operator.

── HOW THIS DIFFERS FROM `purge_fixture_data`, AND WHY BOTH EXIST ────────

`purge_fixture_data` is a broom: it matches known test-shaped rows by pattern,
skips anything a real financial record protects, and REPORTS what it could not
remove. It is the safe thing to run on a database you intend to keep using.

This is a demolition. It removes EVERY event and EVERY account except one, and
it deletes the bookings, payments, tickets and settlements standing in the way
rather than refusing on them. That is not a safer version of the broom — it is
a different tool for a different moment: the point before real data exists,
when the seed and test debris is all there is and the operator wants a clean
platform to start entering the real thing into.

Because it deletes financial records, three things guard it:

  1. **It is a dry run unless told otherwise.** The default prints what it
     would remove and changes nothing. A destructive default is a tool
     somebody eventually runs in the wrong shell.
  2. **It refuses production settings outright.** `--yes` does not unlock
     that; nothing does. The gate is the settings module, so there is no
     flag combination that reaches a production database from here.
  3. **It requires the keeper to exist and to be staff, BEFORE deleting
     anything.** A reset that removed every account and then failed to find
     the one it was meant to keep would leave a platform nobody can sign in
     to — and no way back except a shell on the database.

── WHY THE ORDER IS WHAT IT IS ───────────────────────────────────────────

The FK graph is deliberately full of `PROTECT`: an event referenced by money
somebody paid must not vanish under it. So this walks the graph from the
leaves inward, and every step is a fact about a real invariant:

    scans → tickets → payments/refunds → settlements → bookings
    → ticket tiers + slots + content → events → organisations → users

Reversing any two of those pairs raises `ProtectedError`, which is the
database doing its job. The order is the whole implementation.
"""

from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = "Delete every event and every account except one operator. Destructive."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--keep",
            required=True,
            help="Email of the ONE account to keep. It must already exist and be staff.",
        )
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Actually delete. Without it this is a dry run.",
        )

    def handle(self, *args, **options):
        from apps.accounts.models import EmailVerification, User
        from apps.booking.models import Booking, BookingItem, Ticket
        from apps.checkin.models import ScanLog
        from apps.events.models import (
            Event,
            EventFaq,
            EventMedia,
            EventSlot,
            EventTimelineEntry,
            SavedEvent,
        )
        from apps.organizations.models import Organization
        from apps.payments.models import Payment, ProcessedWebhook, Refund, RefundRequest
        from apps.performers.models import BookingRequest, Performer, PerformerMedia, Quote
        from apps.settlements.models import PayoutAttempt, Settlement
        from apps.ticketing.models import SalePhase, TicketType

        if not settings.DEBUG:
            raise CommandError(
                "reset_platform_data refuses to run outside development (DEBUG must be True). "
                "It deletes bookings, payments and tickets, and there is no flag that "
                "unlocks it against a production database."
            )

        keep_email = options["keep"].strip()
        keeper = User.objects.filter(email__iexact=keep_email).first()
        if keeper is None:
            raise CommandError(
                f"No account with the address '{keep_email}'. "
                "Create it first (manage.py ensure_admin) — a reset that deleted every "
                "account and then could not find the one to keep would leave a platform "
                "nobody can sign in to."
            )
        if not keeper.is_staff:
            raise CommandError(
                f"'{keeper.email}' is not an operator. Refusing, for the same reason: the "
                "surviving account has to be able to reach the console."
            )

        doomed_users = User.objects.exclude(pk=keeper.pk)

        counts = {
            "events": Event.objects.count(),
            "bookings": Booking.objects.count(),
            "tickets": Ticket.objects.count(),
            "payments": Payment.objects.count(),
            "settlements": Settlement.objects.count(),
            "organisations": Organization.objects.count(),
            "performers": Performer.objects.count(),
            "enquiries": BookingRequest.objects.count(),
            "users (deleted)": doomed_users.count(),
        }

        self.stdout.write(self.style.MIGRATE_HEADING("This will remove:"))
        for label, total in counts.items():
            self.stdout.write(f"  {total:>6}  {label}")
        self.stdout.write(f"\nKeeping: {keeper.email} (operator)")

        if not options["yes"]:
            self.stdout.write(
                self.style.WARNING("\nDRY RUN — nothing deleted. Re-run with --yes to apply.")
            )
            return

        # ONE transaction. A half-reset is worse than either outcome: an event
        # whose bookings are gone reports zero sales and a settlement that will
        # never reconcile, and nothing on this platform expects that shape.
        with transaction.atomic():
            # --- leaves first ------------------------------------------------
            ScanLog.objects.all().delete()
            Ticket.objects.all().delete()

            Refund.objects.all().delete()
            RefundRequest.objects.all().delete()
            ProcessedWebhook.objects.all().delete()
            Payment.objects.all().delete()

            PayoutAttempt.objects.all().delete()
            Settlement.objects.all().delete()

            BookingItem.objects.all().delete()
            Booking.objects.all().delete()

            # --- what an event is made of ------------------------------------
            SalePhase.objects.all().delete()
            # Tiers before slots: `TicketType.slot` is PROTECT, so a slot with
            # tiers on it will not go first.
            TicketType.objects.all().delete()
            EventSlot.objects.all().delete()
            EventMedia.objects.all().delete()
            EventFaq.objects.all().delete()
            EventTimelineEntry.objects.all().delete()
            SavedEvent.objects.all().delete()

            # --- the marketplace ---------------------------------------------
            Quote.objects.all().delete()
            BookingRequest.objects.all().delete()
            PerformerMedia.objects.all().delete()
            Performer.objects.all().delete()

            # --- and finally the things everything pointed at -----------------
            Event.objects.all().delete()
            Organization.objects.all().delete()

            # `EmailVerification` cascades from the user, but its rows are
            # cheap to clear explicitly and doing so keeps the keeper's own
            # spent codes from surviving a reset as live-looking rows.
            EmailVerification.objects.all().delete()
            deleted_users = doomed_users.count()
            doomed_users.delete()

        self.stdout.write(self.style.SUCCESS("\nDone."))
        self.stdout.write(f"  {deleted_users} accounts removed, 1 kept ({keeper.email}).")
        self.stdout.write(
            "  Every event, booking, ticket, payment and settlement is gone. "
            "The platform is empty and ready for real data."
        )
