"""Events — the public discovery surface and the hottest read path on the
platform, so the model is shaped for fast, index-backed reads first.

Three performance-shaping decisions live in this file (see CLAUDE.md's
Performance checklist for the reasoning):

1. `search_vector` is a Postgres `tsvector`, kept in sync by a DB trigger
   (see the migration), with a GIN index — so free-text search is an index
   lookup, never an `ILIKE '%...%'` sequential scan.
2. The composite btree indexes match the exact WHERE/ORDER BY of the public
   browse queries (upcoming-by-date, and city-filtered upcoming-by-date).
3. `from_price_minor` / `tickets_available` are denormalized columns owned
   by the (later) `ticketing` module — null until it exists. Denormalizing
   the cheapest ticket price onto the event row means an event card never
   has to join or aggregate ticket rows to show "from ₹X".

`version` is an optimistic-lock counter (see repositories.update_if_version_
matches): concurrent edits can't silently overwrite each other.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVectorField
from django.db import models


class EventStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    # Submitted by the organizer and awaiting a platform operator's decision.
    # NOT public: every public queryset filters on LIVE, so an event in this
    # state is invisible to attendees by construction rather than by a filter
    # somebody has to remember to add.
    PENDING_REVIEW = "pending_review", "Pending review"
    # Refused by an operator, with a reason. The organizer can edit and
    # resubmit; a rejection is a state to recover from, not a dead end.
    REJECTED = "rejected", "Rejected"
    LIVE = "live", "Live"
    PAUSED = "paused", "Paused"
    FINISHED = "finished", "Finished"
    ARCHIVED = "archived", "Archived"


class Event(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # PROTECT: an organization with events can't be deleted out from under
    # them. related_name lets the (later) organizer dashboard reach events.
    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.PROTECT, related_name="events"
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")

    # ---- Content fields (added in 0003) ---------------------------------
    #
    # Each one exists because a specific question a buyer asks had no answer.
    # None is inferred or derived: an organizer types it, or it stays blank and
    # the UI omits the row rather than guessing.

    #: One line for cards and link previews. `description` is the long form.
    short_description = models.CharField(max_length=200, blank=True, default="")
    #: Minutes. Nullable because "we do not know yet" is a real answer, and a
    #: zero would render as "0 minutes" on the event page.
    duration_minutes = models.PositiveIntegerField(null=True, blank=True)
    #: Free text, not a choice list: "Hindi, English" and "Instrumental" are
    #: both real answers, and a fixed enum would force organizers to lie.
    language = models.CharField(max_length=120, blank=True, default="")
    #: "18+", "All ages", "Under 16 with a guardian". Same reasoning.
    age_restriction = models.CharField(max_length=60, blank=True, default="")
    accessibility_notes = models.TextField(blank=True, default="")

    #: SEO. Blank means "derive from the title/description", which is what the
    #: frontend already does — these only exist to OVERRIDE that.
    seo_title = models.CharField(max_length=70, blank=True, default="")
    seo_description = models.CharField(max_length=160, blank=True, default="")

    venue = models.CharField(max_length=255)
    city = models.CharField(max_length=120)

    # --- Where the venue actually is -------------------------------------
    # `venue`/`city` are what the organizer TYPED; these three are where that
    # resolves to. All nullable, and that is load-bearing: an event whose
    # organizer never picked a suggestion has no coordinates, and the event
    # page then renders the address and a directions link rather than a map
    # with a marker in the middle of the city. A default of (0, 0) would put
    # every such event in the Gulf of Guinea.
    #
    # `place_id` is the durable identifier. Google's terms allow caching a
    # place id INDEFINITELY while place CONTENT may be held at most 30 days,
    # which is exactly why this is the one Places value stored in a column and
    # the rest is cache-only (see apps/maps/selectors.py).
    place_id = models.CharField(max_length=255, blank=True, default="")
    # Decimal, not float: 7 decimal places is ~1cm, and float arithmetic on
    # coordinates drifts in ways that show up as a marker that moves.
    latitude = models.DecimalField(max_digits=9, decimal_places=7, null=True, blank=True)
    longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)

    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=EventStatus.choices, default=EventStatus.DRAFT)
    poster_url = models.CharField(max_length=500, blank=True, default="")

    # Denormalized, owned by the `ticketing` module (not built yet): the
    # cheapest active ticket price and remaining availability, so an event
    # card renders without touching ticket rows. Null until ticketing
    # maintains them — see CLAUDE.md ("cross-module denormalization").
    from_price_minor = models.PositiveIntegerField(null=True, blank=True)
    tickets_available = models.PositiveIntegerField(null=True, blank=True)

    # Optimistic-lock counter; bumped on every content edit. Clients send the
    # version they last read; a mismatch means someone else edited in between.
    version = models.PositiveIntegerField(default=1)

    # Moderation. The note is what the organizer is shown after a rejection or
    # a send-back, so it is written by an operator and read by an organizer —
    # never a free-text field the organizer can edit.
    moderation_note = models.TextField(blank=True, default="")
    moderated_at = models.DateTimeField(null=True, blank=True)
    moderated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="moderated_events",
    )
    submitted_at = models.DateTimeField(null=True, blank=True)

    # Kept in sync by a Postgres trigger (see the initial migration), never
    # written from Python — editable=False keeps it out of forms/serializers.
    search_vector = SearchVectorField(null=True, editable=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "events_event"
        indexes = [
            # Public browse: "upcoming published events, soonest first"
            # (WHERE status=? AND starts_at>=? ORDER BY starts_at) as a single
            # index range scan. Partial on the soft-delete flag so dead rows
            # never enter the index.
            models.Index(
                fields=["status", "starts_at"],
                name="event_status_starts_idx",
                condition=models.Q(deleted_at__isnull=True),
            ),
            # Public browse filtered by city — same shape with city pinned
            # between the status and the date range.
            models.Index(
                fields=["status", "city", "starts_at"],
                name="event_status_city_starts_idx",
                condition=models.Q(deleted_at__isnull=True),
            ),
            # Organizer dashboard + the FK join from an owner's organizations
            # to their events, newest first.
            models.Index(
                fields=["organization", "created_at"],
                name="event_org_created_idx",
                condition=models.Q(deleted_at__isnull=True),
            ),
            # The moderation queue's exact query: everything awaiting a
            # decision, oldest first (a review queue is FIFO — the organizer
            # who has waited longest is served first). Partial on the status
            # so the index only ever holds the handful of rows in review.
            models.Index(
                fields=["submitted_at"],
                name="event_pending_review_idx",
                condition=models.Q(status="pending_review", deleted_at__isnull=True),
            ),
            # Free-text search over the maintained tsvector.
            GinIndex(fields=["search_vector"], name="event_search_vector_gin"),
        ]

    def __str__(self) -> str:
        return self.title


class MediaKind(models.TextChoices):
    HERO = "hero", "Hero banner"
    GALLERY = "gallery", "Gallery image"
    THUMBNAIL = "thumbnail", "Thumbnail"
    MOBILE = "mobile", "Mobile banner"
    VIDEO = "video", "Hero video"


class EventMedia(models.Model):
    """Images and video attached to an event.

    ── WHY A TABLE RATHER THAN MORE COLUMNS ─────────────────────────────────

    `Event.poster_url` is one image and stays as the denormalised fast path —
    every card on the platform reads it without a join, which is the whole
    reason it exists. This table is the ORDERED, CAPTIONED set the event page
    needs, and it is a separate concern: a gallery is a list, and a list in
    columns is `image_1_url`, `image_2_url`, and a migration every time
    editorial wants one more.

    ── THE CAPS ARE ENFORCED IN THE SERVICE, NOT THE DATABASE ───────────────

    One hero, ten gallery, one video. A partial unique index could enforce the
    singletons, but not "at most ten", and splitting the rule across two places
    is how the two drift. `EventMediaService.add` owns all three, checks them
    under one transaction, and raises a `DomainError` naming the limit — which
    is also the only version an organizer can act on.

    ── ALT TEXT IS NOT OPTIONAL IN THE UI, ONLY IN THE COLUMN ───────────────

    Blank is allowed because backfilling historical rows must not fail, but the
    create serializer requires it. An image without alt text is invisible to a
    screen reader, and this is the single most-viewed image on the platform.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="media")
    kind = models.CharField(max_length=20, choices=MediaKind.choices, default=MediaKind.GALLERY)
    url = models.CharField(max_length=500)
    alt_text = models.CharField(max_length=200, blank=True, default="")
    caption = models.CharField(max_length=200, blank=True, default="")
    position = models.PositiveIntegerField(default=0)
    #: Hidden without deleting — an organizer pulling an image mid-sale should
    #: not lose the asset, and a hard delete would orphan a CDN object.
    is_visible = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "events_event_media"
        indexes = [
            # The read path's exact query: one event's visible media, in order.
            models.Index(
                fields=["event", "kind", "position"],
                name="event_media_ordered_idx",
                condition=models.Q(deleted_at__isnull=True, is_visible=True),
            ),
        ]

    def __str__(self) -> str:
        return f"{self.kind}:{self.event_id}"


class EventFaq(models.Model):
    """An organizer-authored question and answer.

    Ordered explicitly rather than by creation date: the most-asked question is
    rarely the first one written, and an FAQ list whose order nobody controls
    is one people stop reading.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="faqs")
    question = models.CharField(max_length=200)
    answer = models.TextField()
    position = models.PositiveIntegerField(default=0)
    is_published = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "events_event_faq"
        indexes = [
            models.Index(
                fields=["event", "position"],
                name="event_faq_ordered_idx",
                condition=models.Q(deleted_at__isnull=True, is_published=True),
            ),
        ]

    def __str__(self) -> str:
        return self.question


class TimelineKind(models.TextChoices):
    DOORS = "doors", "Doors open"
    OPENING = "opening", "Opening act"
    SESSION = "session", "Session"
    INTERMISSION = "intermission", "Intermission"
    MAIN = "main", "Main show"
    AFTER_PARTY = "after_party", "After party"
    CLOSING = "closing", "Closing"


class EventTimelineEntry(models.Model):
    """One point in the running order.

    ── `starts_at` IS AN INSTANT, NOT A TIME-OF-DAY ─────────────────────────

    A festival crosses midnight, and "23:30" then sorts before "00:30" of the
    following morning — putting the after-party before the doors. Storing a
    full instant makes ordering correct by construction, and the UI renders
    only the clock portion.

    It is nullable because an organizer may know the running order before the
    exact times; entries without one sort last, by `position`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="timeline")
    kind = models.CharField(max_length=20, choices=TimelineKind.choices, default=TimelineKind.MAIN)
    label = models.CharField(max_length=120)
    description = models.CharField(max_length=300, blank=True, default="")
    starts_at = models.DateTimeField(null=True, blank=True)
    position = models.PositiveIntegerField(default=0)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "events_event_timeline"
        indexes = [
            models.Index(
                fields=["event", "position"],
                name="event_timeline_ordered_idx",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]

    def __str__(self) -> str:
        return f"{self.label} ({self.event_id})"


class SavedEvent(models.Model):
    """A signed-in user's saved event.

    ── WHY IT LIVES IN `events` AND NOT `accounts` ──────────────────────

    It is a relationship to an EVENT, and `events` already owns that
    aggregate. Putting it in `accounts` would make the module that owns
    identity import the module that owns the catalogue, which is the wrong
    direction — `accounts` is depended ON by everything and depends on
    nothing. Dependencies point one way here, the same reason ticketing knows
    about events and never the reverse.

    ── WHY THERE IS NO COUNT ON `Event` ─────────────────────────────────

    No `saved_count` denormal, deliberately. A "1,247 people saved this" badge
    is exactly the kind of number this platform refuses to invent — and a real
    one would need maintaining on every save and unsave for a figure nobody has
    asked to display. If it is ever wanted, it is a denormal like
    `tickets_available`, written from the authoritative rows.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="saved_events"
    )
    # PROTECT would strand a delete behind somebody's bookmark; CASCADE is
    # right here because a saved row means nothing without its event, and
    # unlike a booking it is not a financial record anyone must keep.
    event = models.ForeignKey("events.Event", on_delete=models.CASCADE, related_name="saved_by")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "events_saved_event"
        constraints = [
            # Saving twice is the same fact, and the UI's toggle can double-fire
            # on a slow connection. The constraint makes the second one a no-op
            # rather than a duplicate row.
            models.UniqueConstraint(fields=["user", "event"], name="saved_event_user_event_uniq"),
        ]
        indexes = [
            # The only query on the read path: one user's saves, newest first.
            models.Index(fields=["user", "-created_at"], name="saved_event_user_recent"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} saved {self.event_id}"
