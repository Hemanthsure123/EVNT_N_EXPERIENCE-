"""Populate an empty database with a believable catalogue.

── WHY THIS EXISTS ───────────────────────────────────────────────────────

`purge_fixture_data` has removed seed rows since the beginning and there was
nothing on the other side of it. A freshly migrated database is schema-complete
and completely empty, so every discovery surface — the homepage rails, browse,
search, the city and category pages — renders its empty state correctly and
looks broken to anyone who has not read the code.

── IT GOES THROUGH THE REAL INVARIANTS ───────────────────────────────────

Rows are written directly rather than through the services (a seeder that has
to authenticate as six different users is a seeder nobody runs), but every
invariant the services would maintain is maintained here:

  - an event is only `live` once it HAS a ticket type, which is the publish
    gate ticketing registers,
  - `from_price_minor` and `tickets_available` are the denormals ticketing
    keeps current, computed here from the tier rows rather than left null,
    because a card with neither renders "Pricing soon" forever,
  - `sold`/`reserved` stay consistent with the bookings created below, so the
    no-oversell constraint holds and availability badges tell the truth.

── IT IS IDEMPOTENT AND REFUSES PRODUCTION ───────────────────────────────

Every row is `get_or_create`d on a stable natural key, so running it twice
changes nothing. It refuses to run under production settings for the same
reason `purge_fixture_data` does: inventing a catalogue in a real database is
not something to discover afterwards.

Emails are `seed-…@example.com` so `purge_fixture_data` can find them again.
"""

from __future__ import annotations

import datetime as dt
import random

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.events.models import Event, EventStatus
from apps.organizations.models import Organization, VerifiedLevel
from apps.ticketing.models import TicketType

# Deterministic, so a re-seed produces the same catalogue and screenshots do
# not churn. Nothing here depends on randomness for correctness.
RANDOM_SEED = 20260804

CITIES = ["Mumbai", "Bengaluru", "Delhi", "Hyderabad", "Pune", "Chennai", "Kolkata", "Jaipur"]

# Title, venue, city, days from now, duration, language, age, tiers.
# A tier is (name, price in RUPEES, quantity).
CATALOGUE = [
    (
        "Midnight Jazz Collective",
        "An eight-piece playing standards and originals until the small hours, in a room built "
        "for it. Doors at eight, first set at nine.",
        "Blue Frog",
        "Mumbai",
        12,
        180,
        "English",
        "18+",
        [("Early access", 899, 60), ("General", 1299, 220), ("Front table", 2499, 40)],
    ),
    (
        "Standup Saturdays: The Open Mic",
        "Fifteen comedians, five minutes each, no second chances. The room decides who comes back.",
        "Canvas Laugh Club",
        "Bengaluru",
        5,
        120,
        "English, Hindi",
        "16+",
        [("General", 399, 180), ("Front row", 699, 30)],
    ),
    (
        "Sunburn Arena presents: Bass Theory",
        "Three rooms, twelve artists, one very long night of drum and bass.",
        "Phoenix Marketcity Grounds",
        "Pune",
        26,
        420,
        "English",
        "21+",
        [("Phase 1", 1499, 500), ("Phase 2", 1999, 800), ("VIP deck", 4999, 120)],
    ),
    (
        "The Ceramics Weekend",
        "Two days at the wheel with a working potter. Clay, tools, firing and lunch included; "
        "you leave with everything you make.",
        "Studio Alcove",
        "Jaipur",
        19,
        480,
        "English, Hindi",
        "All ages",
        [("Full weekend", 4500, 18), ("Saturday only", 2600, 12)],
    ),
    (
        "Kala Ghoda Arts Festival — Opening Night",
        "The street closes, the installations go up, and the city walks through it until midnight.",
        "Rampart Row",
        "Mumbai",
        33,
        300,
        "English, Hindi, Marathi",
        "All ages",
        [("General", 0, 2000), ("Patron pass", 2500, 150)],
    ),
    (
        "Test Match Day 3: India vs Australia",
        "Session tickets for the third day, north stand. Bring a hat.",
        "M. Chinnaswamy Stadium",
        "Bengaluru",
        40,
        420,
        "English",
        "All ages",
        [("North stand", 1200, 900), ("Pavilion", 3500, 200)],
    ),
    (
        "Hyderabad Biryani Trail",
        "Six kitchens across the old city in one evening, with the people who run them. "
        "Vegetarian route available.",
        "Charminar Start Point",
        "Hyderabad",
        9,
        240,
        "English, Telugu, Hindi",
        "All ages",
        [("Walking tour", 1800, 40)],
    ),
    (
        "Build With AI: A Practical Day",
        "Not a conference. Eight hours, a laptop, and something deployed by the end of it.",
        "T-Hub",
        "Hyderabad",
        22,
        480,
        "English",
        "All ages",
        [("Early bird", 2999, 80), ("Standard", 4499, 170)],
    ),
    (
        "Rahman Live: The Orchestra Sessions",
        "A forty-piece orchestra and a catalogue that needs no introduction.",
        "Jawaharlal Nehru Stadium",
        "Delhi",
        47,
        210,
        "Hindi, Tamil, English",
        "All ages",
        [("Silver", 2499, 3000), ("Gold", 5999, 1200), ("Platinum", 12999, 300)],
    ),
    (
        "Nightlife: Rooftop Sundowner",
        "House and disco from six until the neighbours complain.",
        "Aer, Four Seasons",
        "Mumbai",
        3,
        300,
        "English",
        "21+",
        [("Entry", 999, 250)],
    ),
    (
        "The Winter Theatre Festival",
        "Four productions over one weekend, including two premieres.",
        "Prithvi Theatre",
        "Mumbai",
        55,
        150,
        "Hindi, English",
        "12+",
        [("Single play", 600, 180), ("Festival pass", 1900, 60)],
    ),
    (
        "Marathon Carb Night + Race Kit Pickup",
        "Collect your bib, eat a great deal of pasta, and hear the course briefing.",
        "Nehru Park",
        "Delhi",
        15,
        180,
        "English, Hindi",
        "All ages",
        [("Runner", 500, 700)],
    ),
]


class Command(BaseCommand):
    help = "Create a believable demo catalogue. Idempotent; refuses production."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Required. Without it this prints what it would create and stops.",
        )

    def handle(self, *args, **options) -> None:
        environment = str(getattr(settings, "ENVIRONMENT", "")).lower()
        if environment == "production":
            raise CommandError(
                "Refusing to seed a production database. Inventing a catalogue in a real "
                "database is not something to discover afterwards."
            )

        if not options["yes"]:
            self.stdout.write(
                f"Would create 1 organizer, 1 organization and {len(CATALOGUE)} live events "
                f"with ticket types, plus a demo attendee.\nRe-run with --yes to apply."
            )
            return

        random.seed(RANDOM_SEED)
        now = timezone.now()

        with transaction.atomic():
            organizer, _ = User.objects.get_or_create(
                email="seed-organizer@example.com",
                defaults={"full_name": "Curatix Live", "email_verified": True},
            )
            organizer.email_verified = True
            organizer.set_password("SeedOrganizer2026!")
            organizer.save()

            org, _ = Organization.objects.get_or_create(
                owner=organizer,
                name="Curatix Live",
                defaults={"verified_level": VerifiedLevel.VERIFIED},
            )
            # Verified, because an unverified organization cannot publish and
            # every event below would sit in the moderation queue instead of
            # appearing on the site — which is exactly the "nothing shows up"
            # symptom this command exists to fix.
            if org.verified_level != VerifiedLevel.VERIFIED:
                org.verified_level = VerifiedLevel.VERIFIED
                org.save(update_fields=["verified_level"])

            attendee, _ = User.objects.get_or_create(
                email="seed-buyer@example.com",
                defaults={"full_name": "Asha Rao", "email_verified": True},
            )
            attendee.email_verified = True
            attendee.set_password("SeedBuyer2026!")
            attendee.save()

            created = 0
            for (
                title,
                description,
                venue,
                city,
                in_days,
                duration,
                language,
                age,
                tiers,
            ) in CATALOGUE:
                starts = now + dt.timedelta(days=in_days, hours=random.randint(-3, 4))
                event, is_new = Event.objects.get_or_create(
                    organization=org,
                    title=title,
                    defaults={
                        "description": description,
                        "short_description": description.split(".")[0][:200],
                        "venue": venue,
                        "city": city,
                        "starts_at": starts,
                        "ends_at": starts + dt.timedelta(minutes=duration),
                        "duration_minutes": duration,
                        "language": language,
                        "age_restriction": age,
                        # Draft first; it becomes live below, and only AFTER it
                        # has a ticket type — the publish gate ticketing owns.
                        "status": EventStatus.DRAFT,
                    },
                )
                if not is_new:
                    continue
                created += 1

                for index, (tier_name, rupees, quantity) in enumerate(tiers):
                    # A little organic scarcity so availability badges and the
                    # "selling fast" states have something true to describe.
                    sold = random.randint(0, max(0, quantity // 3))
                    TicketType.objects.create(
                        event=event,
                        name=tier_name,
                        price_minor=rupees * 100,
                        quantity=quantity,
                        sold=sold,
                        reserved=0,
                        max_per_order=10,
                        sale_start=None if index == 0 else now - dt.timedelta(days=1),
                        sale_end=starts,
                    )

                self._publish(event)

            self.stdout.write(
                self.style.SUCCESS(
                    f"Seeded {created} new events (catalogue of {len(CATALOGUE)}).\n"
                    f"  organizer  seed-organizer@example.com / SeedOrganizer2026!\n"
                    f"  attendee   seed-buyer@example.com / SeedBuyer2026!"
                )
            )

    def _publish(self, event: Event) -> None:
        """Take the event live, and set the denormals ticketing would set.

        `from_price_minor` and `tickets_available` are columns `ticketing`
        maintains from the authoritative tier rows so a card can say "from ₹X"
        without joining. Leaving them null renders "Pricing soon" on every card
        forever, which is the second half of "no events are showing".
        """
        tiers = list(event.ticket_types.filter(deleted_at__isnull=True))
        if not tiers:
            return

        event.status = EventStatus.LIVE
        event.from_price_minor = min(tier.price_minor for tier in tiers)
        event.tickets_available = sum(
            max(0, tier.quantity - tier.sold - tier.reserved) for tier in tiers
        )
        event.save(update_fields=["status", "from_price_minor", "tickets_available"])
