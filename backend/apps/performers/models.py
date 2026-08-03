"""Performers — the Hire a Band marketplace.

This is the platform's SECOND product surface, and it is deliberately shaped
like the first rather than like a new application:

- A `Performer` is owned by an **Organization**, not by a User. That reuses the
  existing ownership, verification and payout wiring wholesale — an organizer
  who already runs events can list a band without a second account, and the
  operator who verifies organizations verifies performers by the same act.
- Publishing goes through the SAME moderation gate as events: draft ->
  pending_review -> live | rejected. A marketplace where anyone can list
  anything in front of buyers is one bad listing away from a refund wave, and
  the check cannot live on the seller's side of the fence.
- `search_vector` is a Postgres tsvector kept current by a DB trigger with a
  GIN index (see the migration), exactly as `events` does it. Browsing
  performers is a public read path and will be hot; `ILIKE '%...%'` over stage
  names and bios is the thing this exists to avoid.

WHAT THE MARKETPLACE IS, IN TWO OBJECTS
---------------------------------------

A customer posts a `BookingRequest` — "a jazz band, in Mumbai, on 14 March,
around ₹80,000". Performers answer with a `Quote`. The customer accepts one.
That is the whole marketplace, and it is deliberately small: the alternative
shape (instant booking with held inventory) is what `ticketing` already does,
and a live performance has no inventory to hold — it has a negotiation.

WHAT IS DELIBERATELY NOT MODELLED HERE
--------------------------------------

- **Ratings and reviews.** There is no review model anywhere on this platform,
  so a rating would be a number with nothing behind it. The marketplace filters
  therefore have no "minimum rating", and profiles show experience and past
  work rather than stars. BACKLOG "Performer reviews and ratings".
- **A real availability calendar.** `BookingRequest.event_date` and a
  performer's own declining of a quote is the honest signal today. A calendar
  needs its own model with blocked dates and recurring unavailability.
- **Payments through the platform.** A quote is an agreement, not a charge.
  Taking money for it needs the escrow/milestone shape `payments` does not
  have. Both are BACKLOG items rather than half-built columns.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVectorField
from django.db import models


class PerformerType(models.TextChoices):
    BAND = "band", "Band"
    SINGER = "singer", "Singer"
    DJ = "dj", "DJ"
    INSTRUMENTALIST = "instrumentalist", "Instrumentalist"
    ANCHOR = "anchor", "Anchor / MC"
    COMEDIAN = "comedian", "Stand-up comedian"
    DANCE_CREW = "dance_crew", "Dance crew"
    MAGICIAN = "magician", "Magician"
    OTHER = "other", "Other"


class PerformerStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    #: Submitted and awaiting an operator. NOT public — every public queryset
    #: filters on LIVE, so this is invisible by construction rather than by a
    #: filter somebody has to remember to add.
    PENDING_REVIEW = "pending_review", "Pending review"
    REJECTED = "rejected", "Rejected"
    LIVE = "live", "Live"
    #: The performer has taken themselves off the market temporarily. Distinct
    #: from archived: a pause is expected to end.
    PAUSED = "paused", "Paused"
    ARCHIVED = "archived", "Archived"


class Occasion(models.TextChoices):
    """What the customer is throwing. Drives nothing but discovery — a band
    that lists weddings appears for a wedding brief."""

    WEDDING = "wedding", "Wedding"
    BIRTHDAY = "birthday", "Birthday"
    CORPORATE = "corporate", "Corporate event"
    COLLEGE_FEST = "college_fest", "College fest"
    PRIVATE_PARTY = "private_party", "Private party"
    FESTIVAL = "festival", "Festival"
    OTHER = "other", "Other"


class Performer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # PROTECT, and owned by the ORGANIZATION rather than the user — see the
    # module docstring. An organization may list several acts.
    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.PROTECT, related_name="performers"
    )
    stage_name = models.CharField(max_length=120)
    performer_type = models.CharField(max_length=20, choices=PerformerType.choices)
    tagline = models.CharField(max_length=160, blank=True, default="")
    bio = models.TextField(blank=True, default="")

    #: Where they are based. The same plain-string city the rest of the
    #: platform uses, so a city filter means the same thing everywhere.
    city = models.CharField(max_length=120)
    #: How far they will travel from `city`, in kilometres. 0 means "this city
    #: only" and is rendered as such rather than as a radius of nothing.
    travel_radius_km = models.PositiveIntegerField(default=0)

    #: Their own starting price, in minor units. The customer's budget is
    #: matched against this so a brief never surfaces acts it cannot afford.
    #: Null means "ask" — some acts genuinely price per event, and inventing a
    #: number for them would be worse than showing none.
    base_price_minor = models.PositiveIntegerField(null=True, blank=True)

    #: Free-form lists rather than FK tables. They are used for DISPLAY and for
    #: an `overlap` filter, never joined or aggregated, so a table would buy
    #: nothing and cost two migrations plus a join on the hottest read.
    genres = models.JSONField(default=list, blank=True)
    languages = models.JSONField(default=list, blank=True)
    occasions = models.JSONField(default=list, blank=True)

    experience_years = models.PositiveIntegerField(default=0)
    #: Typical set length. Null rather than 0 — "0 minutes" is a claim.
    typical_set_minutes = models.PositiveIntegerField(null=True, blank=True)

    website_url = models.CharField(max_length=500, blank=True, default="")
    instagram_url = models.CharField(max_length=500, blank=True, default="")
    youtube_url = models.CharField(max_length=500, blank=True, default="")

    status = models.CharField(
        max_length=20, choices=PerformerStatus.choices, default=PerformerStatus.DRAFT
    )
    #: An operator's editorial pick. Drives the marketplace's featured rail and
    #: the landing page's Hire a Band section.
    is_featured = models.BooleanField(default=False)

    # Moderation, mirroring `events` exactly so an operator learns one flow.
    submitted_at = models.DateTimeField(null=True, blank=True)
    moderated_at = models.DateTimeField(null=True, blank=True)
    moderated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="moderated_performers",
    )
    moderation_note = models.CharField(max_length=1000, blank=True, default="")

    #: Optimistic lock, same scheme as `Event` — concurrent edits cannot
    #: silently clobber each other.
    version = models.PositiveIntegerField(default=1)
    search_vector = SearchVectorField(null=True, editable=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        app_label = "performers"
        db_table = "performers_performer"
        indexes = [
            # The public browse: live performers in a city, newest first. The
            # partial condition keeps deleted rows out of the index entirely.
            models.Index(
                fields=["status", "city", "-created_at"],
                condition=models.Q(deleted_at__isnull=True),
                name="performer_status_city_idx",
            ),
            # The type-first browse ("show me DJs"), which is how the landing
            # page's cards enter the marketplace.
            models.Index(
                fields=["status", "performer_type", "-created_at"],
                condition=models.Q(deleted_at__isnull=True),
                name="performer_status_type_idx",
            ),
            models.Index(
                fields=["organization", "-created_at"],
                condition=models.Q(deleted_at__isnull=True),
                name="performer_org_created_idx",
            ),
            GinIndex(fields=["search_vector"], name="performer_search_gin"),
        ]

    def __str__(self) -> str:
        return f"{self.stage_name} ({self.performer_type})"


class PerformerMedia(models.Model):
    """Photos. Same shape as `EventMedia`, and for the same reason: an act
    nobody can see is an act nobody hires.

    `alt_text` is permissive at the column and REQUIRED at the API, exactly as
    event media is — the column is lenient so a backfill survives, the API is
    strict so no new row can be created without it.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    performer = models.ForeignKey(Performer, on_delete=models.CASCADE, related_name="media")
    url = models.CharField(max_length=500)
    alt_text = models.CharField(max_length=200, blank=True, default="")
    caption = models.CharField(max_length=200, blank=True, default="")
    position = models.PositiveIntegerField(default=0)
    is_visible = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        app_label = "performers"
        db_table = "performers_media"
        indexes = [
            models.Index(
                fields=["performer", "position"],
                condition=models.Q(deleted_at__isnull=True),
                name="performer_media_pos_idx",
            )
        ]

    def __str__(self) -> str:
        return f"Media {self.id} for {self.performer_id}"


class RequestStatus(models.TextChoices):
    OPEN = "open", "Open for quotes"
    #: The customer accepted a quote. Other quotes are declined in the same
    #: transaction, so a request cannot have two winners.
    BOOKED = "booked", "Booked"
    CANCELLED = "cancelled", "Cancelled"
    #: The event date passed with nobody hired. Set by a sweep, not by a user.
    EXPIRED = "expired", "Expired"


class BookingRequest(models.Model):
    """A customer's brief. "A jazz band, in Mumbai, on 14 March, ~₹80,000."

    Deliberately NOT tied to an `Event`. Most people hiring a band for a
    wedding are not running a ticketed event on this platform, and requiring
    one would exclude the entire audience this marketplace exists for.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    customer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="booking_requests"
    )
    performer_type = models.CharField(max_length=20, choices=PerformerType.choices)
    occasion = models.CharField(max_length=20, choices=Occasion.choices, default=Occasion.OTHER)
    city = models.CharField(max_length=120)
    event_date = models.DateField()
    #: A RANGE, because that is how people actually think about a budget, and
    #: a single number invites every quote to be exactly it.
    budget_min_minor = models.PositiveIntegerField()
    budget_max_minor = models.PositiveIntegerField()
    guests = models.PositiveIntegerField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")

    status = models.CharField(
        max_length=20, choices=RequestStatus.choices, default=RequestStatus.OPEN
    )
    #: Set when a quote is accepted. Denormalized so the customer's list can
    #: show "booked with X" without joining quotes.
    booked_performer = models.ForeignKey(
        Performer,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="won_requests",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "performers"
        db_table = "performers_booking_request"
        indexes = [
            # The performer's own feed: open briefs of my type, in my city.
            models.Index(
                fields=["status", "performer_type", "city", "-created_at"],
                name="request_open_match_idx",
            ),
            models.Index(fields=["customer", "-created_at"], name="request_customer_idx"),
        ]
        constraints = [
            # A max below a min is not a budget, and it silently matches
            # nothing — so the database refuses it rather than the UI hoping.
            models.CheckConstraint(
                check=models.Q(budget_max_minor__gte=models.F("budget_min_minor")),
                name="request_budget_range_valid",
            )
        ]

    def __str__(self) -> str:
        return f"{self.performer_type} in {self.city} on {self.event_date}"


class QuoteStatus(models.TextChoices):
    PENDING = "pending", "Awaiting the customer"
    ACCEPTED = "accepted", "Accepted"
    DECLINED = "declined", "Declined"
    #: The performer pulled out before a decision.
    WITHDRAWN = "withdrawn", "Withdrawn"


class Quote(models.Model):
    """A performer's answer to a brief.

    One quote per performer per request, enforced by a unique constraint — a
    performer who wants to change their number edits it rather than sending a
    second, which is what stops a customer's inbox filling with one act.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request = models.ForeignKey(BookingRequest, on_delete=models.CASCADE, related_name="quotes")
    performer = models.ForeignKey(Performer, on_delete=models.PROTECT, related_name="quotes")
    amount_minor = models.PositiveIntegerField()
    message = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=20, choices=QuoteStatus.choices, default=QuoteStatus.PENDING
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "performers"
        db_table = "performers_quote"
        constraints = [
            models.UniqueConstraint(
                fields=["request", "performer"], name="quote_one_per_performer_per_request"
            )
        ]
        indexes = [
            models.Index(fields=["request", "-created_at"], name="quote_request_idx"),
            models.Index(fields=["performer", "-created_at"], name="quote_performer_idx"),
        ]

    def __str__(self) -> str:
        return f"Quote {self.id} ({self.status})"
