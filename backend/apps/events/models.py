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
from django.db.models import Q

from .taxonomy import EVENT_TYPE_MAX_LENGTH, EventType


class EventCategory(models.TextChoices):
    """The browse taxonomy, as a COLUMN rather than a guess.

    ── WHY THIS EXISTS ────────────────────────────────────────────────────

    Category filtering was a keyword search pushed through the full-text
    index: the "Comedy" tile searched for the stem `comedy`, so it matched an
    event whose *description* happened to mention a comedian and missed a
    stand-up night whose copy never used the word. The frontend inferred a
    card's chip from its title by keyword and rendered nothing when nothing
    matched, because a wrong chip is worse than none.

    A column makes it exact, indexable, and combinable with `q` without the two
    competing for the same tsquery.

    ── THE VALUES MATCH THE FRONTEND'S SLUGS EXACTLY ──────────────────────

    `frontend/lib/discovery/categories.ts` already ships these eight slugs, and
    the illustration set draws a scene per slug. Choosing different strings
    here would mean a translation table nobody maintains — and the first thing
    to break would be the artwork, silently, because an unknown slug falls back
    to the generic ticket.

    ── AND WHY THERE IS AN EXPLICIT "OTHER" ───────────────────────────────

    Not blank. An organiser whose event is genuinely none of these has made a
    real choice, and it is different from one who has not chosen yet — blank
    means "not categorised", which is what an unmigrated row and a brand new
    draft both are. Keeping them distinguishable is what lets a backfill be
    reviewed rather than assumed.
    """

    CONCERTS = "concerts", "Concerts"
    COMEDY = "comedy", "Comedy"
    WORKSHOPS = "workshops", "Workshops"
    SPORTS = "sports", "Sports"
    FESTIVALS = "festivals", "Festivals"
    NIGHTLIFE = "nightlife", "Nightlife"
    FOOD_DRINK = "food-drink", "Food & Drink"
    TECH = "tech", "Tech"
    OTHER = "other", "Other"


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
    # Called off. PUBLIC and terminal, and deliberately NOT the same as
    # `archived` (which hides the listing) or a soft delete (which removes it):
    # people are holding tickets to this and WILL open the link they were sent,
    # so the page has to resolve and say what happened. A 404 there reads as
    # "the platform lost my booking".
    #
    # It never appears in a browse listing — the public list filters on `live`
    # — so this costs discovery nothing.
    CANCELLED = "cancelled", "Cancelled"
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
    #: The browse taxonomy. BLANK is a real state — "not categorised yet" — and
    #: is deliberately distinct from `OTHER`, which is an organiser choosing
    #: none of the eight. An unmigrated row and a fresh draft are both blank;
    #: only one of them is a decision.
    #:
    #: Not a ForeignKey to `cms.Category`: that table is an operator's
    #: MERCHANDISING list (what to promote on the front page), it archives
    #: rather than deletes, and its rows can come and go. A browse taxonomy has
    #: to be stable enough to index on and to draw artwork from, so it is a
    #: closed set in code.
    category = models.CharField(
        max_length=20, choices=EventCategory.choices, blank=True, default=""
    )
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

    #: The ORGANISER's own rules for this event — entry conditions, prohibited
    #: items, their refund terms, what happens if it rains.
    #:
    #: A JSON list of `{"title": ..., "body": ...}`, not columns and not a
    #: related table:
    #:
    #: - Not COLUMNS, because the set is genuinely open. "No outside food",
    #:   "Carry a photo ID", "Umbrellas allowed, tripods are not" — every venue
    #:   has a different list and any fixed schema would either force an
    #:   organiser to leave a rule out or leave most events with empty fields.
    #: - Not a TABLE, unlike `EventFaq` alongside it. An FAQ is edited one row
    #:   at a time from a studio screen with its own endpoints; the policy list
    #:   is written whole, read whole, and never queried across events. A table
    #:   would buy per-row endpoints nobody would call and cost a join on the
    #:   detail read, which is the hottest public query in the system.
    #:
    #: The DEFAULT IS A CALLABLE (`list`), not `[]`. A mutable default is
    #: shared by every instance that does not set it, so one event appending a
    #: policy would append it to the next.
    #:
    #: This is deliberately SEPARATE from the platform policies the event page
    #: also renders (tickets are signed QR codes, no card data is stored).
    #: Those are true of every event and are not an organiser's to edit.
    policies = models.JSONField(default=list, blank=True)

    #: The three bullet lists an organiser writes for a reader: what the ticket
    #: covers, what it does not, and how to turn up.
    #:
    #: Lists of SHORT STRINGS, unlike `policies` above, which is a list of
    #: `{title, body}`. The shape follows the content: a policy is a named rule
    #: with a paragraph under it ("Refunds — up to 48 hours before…"), where
    #: these are single points somebody scans ("Two rounds of chai"). Giving
    #: them a title each would force an organiser to invent headings for
    #: one-line facts.
    #:
    #: `highlights_excluded` earns its place separately from `guidelines`
    #: because "not included" and "the rules" are answers to different
    #: questions and a reader looks for them at different moments — one before
    #: buying, one before arriving. Folding them together is how a refund
    #: dispute starts with "it was in the guidelines".
    #:
    #: DEFAULT IS THE CALLABLE `list`, for the reason stated above `policies`.
    highlights_included = models.JSONField(default=list, blank=True)
    highlights_excluded = models.JSONField(default=list, blank=True)
    guidelines = models.JSONField(default=list, blank=True)

    #: The sub-classification beneath `category` — see `taxonomy.EventType`.
    #:
    #: BLANK is a legal, distinct state meaning "not said", exactly as it is
    #: for `category`. Nothing refuses a draft for it, and the public browse
    #: treats an unknown value as no filter rather than a 400.
    event_type = models.CharField(
        max_length=EVENT_TYPE_MAX_LENGTH,
        choices=EventType.choices,
        blank=True,
        default="",
    )

    #: What the event is LIKE — a closed vocabulary across seven dimensions
    #: (`taxonomy.TAG_DIMENSIONS`), capped at `MAX_TAGS` and validated at the
    #: API boundary so an unfilterable string can never reach the column.
    #:
    #: NO INDEX, deliberately, and this is the checklist's rule rather than an
    #: omission: a B-tree index on a JSONField is useless for containment, and
    #: the index containment WOULD need is a GIN one — which would be the first
    #: on a JSONB column in this codebase. It ships in the same migration as
    #: the query that needs it (see 0015), not before.
    tags = models.JSONField(default=list, blank=True)

    #: SEO. Blank means "derive from the title/description", which is what the
    #: frontend already does — these only exist to OVERRIDE that.
    seo_title = models.CharField(max_length=70, blank=True, default="")
    seo_description = models.CharField(max_length=160, blank=True, default="")

    #: The human-readable half of the public URL `/events/{slug}-{id}`.
    #:
    #: DERIVED from the title (see `slugs.event_slug`), never organizer-supplied
    #: — it is deliberately absent from `services._EDITABLE_FIELDS`, so a PATCH
    #: carrying `{"slug": ...}` is ignored.
    #:
    #: Deliberately NOT unique and NOT indexed. Nothing ever queries by it: the
    #: UUID in the same path segment carries identity, so two events with the
    #: same title are still distinguishable and a rename can never orphan a
    #: link. Blank is a real, working state — a title that ASCII-slugifies to
    #: nothing (Devanagari, Tamil, emoji) serves the bare `/events/{id}` URL
    #: the platform served before this column existed, which is also what every
    #: row looks like between the schema migration and the backfill.
    slug = models.CharField(max_length=80, blank=True, default="")

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

    # ── RATING DENORMALS, OWNED BY `apps.reviews` ──────────────────────────
    #
    # Sum and count rather than a stored average: an average cannot be
    # maintained incrementally without also storing the count, and keeping the
    # sum means create/update/delete/hide are each one atomic `F()` expression
    # with no read-modify-write and no lock. The average is derived on read.
    #
    # Denormalised for the same reason `from_price_minor` is: an event CARD
    # shows "4.6 (128)" and must not join or aggregate review rows to do it.
    # `reviews` is the only writer — see `EventRepository.apply_rating_delta`.
    rating_sum = models.PositiveIntegerField(default=0)
    rating_count = models.PositiveIntegerField(default=0)

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
            # Public browse filtered by CATEGORY — the same shape as the city
            # index above, with category pinned between the status and the
            # date range. Added with the column rather than after it: the
            # performance checklist's rule is that the index the query needs
            # ships in the same migration as the query.
            models.Index(
                fields=["status", "category", "starts_at"],
                name="event_status_category_idx",
                condition=models.Q(deleted_at__isnull=True),
            ),
            # Public browse filtered by EVENT TYPE — the sub-classification
            # beneath category. Same shape again, and shipped with the filter
            # in `list_published` rather than ahead of it.
            models.Index(
                fields=["status", "event_type", "starts_at"],
                name="event_status_type_idx",
                condition=models.Q(deleted_at__isnull=True),
            ),
            # Public browse filtered by TAG, which is a CONTAINMENT query
            # (`tags @> '["outdoor"]'`) and therefore needs a GIN index — a
            # B-tree on a JSONField would be accepted and useless.
            #
            # This is the FIRST GIN index on a JSONB column here; the two
            # existing ones are on tsvectors. `jsonb_path_ops` is deliberately
            # not used: it is smaller and faster for `@>` alone, but it cannot
            # answer key-existence queries, and a faceted "which tags do these
            # results have" count is the obvious next thing this column is
            # asked for. The default operator class keeps that open.
            GinIndex(fields=["tags"], name="event_tags_gin"),
            # Public browse filtered by ORGANISER — "More from {organiser}" in
            # the event widget. Same shape as the city and category indexes,
            # with the organization pinned between the status and the date
            # range. Shipped in the same migration as the filter, per the
            # performance checklist: the index the query needs is not a
            # follow-up.
            #
            # Distinct from `event_org_created_idx` below, which is the
            # ORGANIZER's own dashboard: that one sorts by `created_at` over
            # every status, this one is public, upcoming-only and sorts by
            # `starts_at`. Neither serves the other's query.
            models.Index(
                fields=["status", "organization", "starts_at"],
                name="event_status_org_starts_idx",
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
    #: A VIDEO embed that is taller than it is wide — a YouTube Short.
    #:
    #: A column rather than something derived at render time, because it is
    #: unrecoverable after the write: a Short's stored `embed_url` is
    #: byte-for-byte what a normal video gets, and `core.video_embeds` refuses
    #: to keep the pasted link or a query parameter (that is the whole security
    #: posture of the embed — the URL in the iframe is BUILT, never echoed). So
    #: the shape is knowable exactly once, while the path is still in hand.
    #:
    #: Meaningless for the image kinds, which get their shape from
    #: `MEDIA_SPECS` at upload and are drawn in a fixed frame. It stays `False`
    #: for them rather than nullable: "not a vertical video" is true of an
    #: image, and a null would invite a three-state check nobody needs.
    is_vertical = models.BooleanField(default=False)
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


class QuestionKind(models.TextChoices):
    """How an attendee answers.

    Four, and no more, because every one has to render as a real control and
    be answerable on a phone at a checkout. A date picker, a file upload and a
    number spinner were each considered and left out: none has a question an
    organiser actually asked for, and an unused control is a control nobody
    tests.
    """

    SHORT_TEXT = "short_text", "Short answer"
    LONG_TEXT = "long_text", "Long answer"
    CHOICE = "choice", "Choose one"
    BOOLEAN = "boolean", "Yes or no"


class EventQuestion(models.Model):
    """Something the organiser needs to know before somebody turns up.

    Dietary requirements, a T-shirt size, whether they have played before. The
    answers are the organiser's operational data — they are not used for
    anything on the money path and never gate a payment.

    ── WHY A TABLE AND NOT A JSON COLUMN ─────────────────────────────────────

    Unlike `Event.policies` (a list written whole, read whole, never queried
    across rows), a question is JOINED to answers: an organiser exports "every
    dietary answer for this event", and an answer needs a stable id to point
    at. A JSON list has no ids, so re-ordering the questions would silently
    re-point every answer already collected.

    ── FIVE, ENFORCED IN THE SERVICE ─────────────────────────────────────────

    A checkout that asks six questions is a checkout people leave. The cap is
    the brief's and it lives beside the other content caps rather than in the
    database, for the same reason `MEDIA_LIMITS` does: it is a product policy,
    not an invariant the data would be corrupt without.

    ── SOFT DELETE, AND THAT IS LOAD-BEARING ─────────────────────────────────

    `BookingAnswer.question` is `PROTECT`ed, so a question somebody has already
    answered cannot be removed — the answer would be a value with no prompt,
    which is worse than no answer at all. Retiring one hides it from new
    checkouts and keeps every answer already given readable.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="questions")
    prompt = models.CharField(max_length=200)
    #: One line under the prompt. "So we can cater for you", not a second
    #: question — a help text that asks something is a question with no answer
    #: field.
    help_text = models.CharField(max_length=200, blank=True, default="")
    kind = models.CharField(
        max_length=20, choices=QuestionKind.choices, default=QuestionKind.SHORT_TEXT
    )
    #: The options, for `CHOICE` only. A list of short strings; empty for every
    #: other kind. Same shape as `TicketType.perks`, and validated the same way
    #: at the boundary — trimmed, blanks dropped, duplicates collapsed.
    choices = models.JSONField(default=list, blank=True)
    #: A REQUIRED question must be answered before the booking is made.
    #:
    #: Optional is the default deliberately: an organiser adding a question
    #: mid-sale would otherwise make every existing checkout invalid, and the
    #: commonest question ("anything we should know?") is one nobody should be
    #: forced to answer.
    is_required = models.BooleanField(default=False)
    position = models.PositiveIntegerField(default=0)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "events_event_question"
        indexes = [
            models.Index(
                fields=["event", "position"],
                name="event_question_ordered_idx",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]

    def __str__(self) -> str:
        return self.prompt


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


class CrewMember(models.Model):
    """Somebody an organizer puts on stage: a DJ, a compere, a support act.

    ── IT IS OWNED BY THE ORGANIZATION, NOT BY AN EVENT ────────────────────

    The whole point is REUSE. A promoter who runs the same night monthly adds
    their resident once and picks them for every event, which is why this is a
    roster with a FK to `Organization` and a join table below, rather than a
    per-event row like `EventFaq`.

    ── AND IT IS NOT A `performers.Performer`. NO `performer` FK HERE, EVER ─

    The temptation is obvious — a Performer is also owned by an Organization
    and also has photographs — and it is wrong twice over.

    1. `performers` is DOWNSTREAM of `events` in the build order, and
       `Event`'s only foreign keys are to `organizations` and `accounts`. A
       reference the other way inverts the rule that keeps the modules
       separable, the same rule that stops `duplicate_event` reaching into
       ticketing to clone tiers.
    2. It would not work anyway. A `Performer` is a SELLABLE LISTING in the
       Hire-a-Band marketplace and is invisible on every public read path
       until a platform operator approves it. A club night's own compere would
       not appear on the event page until somebody at the platform cleared a
       moderation queue for a person who is not for hire. The lineup would
       render empty and nothing would say why.

    A crew member is EVENT CONTENT, which is exactly what this module already
    owns for media, FAQs, the running order and sessions.

    ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────

    No moderation and no publish check: most events have no crew, and a gate
    that demanded one would refuse to publish a club night. No `search_vector`:
    a lighting tech has no business surfacing in `/performers`-shaped results.
    No `user` FK and no permissions — a crew member is a LABEL, not an access
    decision, and delegated gate staff is the deferred `teams` module.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.PROTECT, related_name="crew_members"
    )
    name = models.CharField(max_length=120)
    #: FREE TEXT, not a choice set. The module uses enums where the set is
    #: knowable (`MediaKind`, `TimelineKind`) and a plain string where it is
    #: open (`Event.city`). Stage roles are long-tail — "DJ", "producer",
    #: "compere", "sound", "aerialist" — and a fixed list would be wrong within
    #: a week and unfixable without a migration.
    role = models.CharField(max_length=80, blank=True, default="")
    details = models.TextField(blank=True, default="")
    photo_url = models.CharField(max_length=500, blank=True, default="")
    #: Blank at the column so a backfill survives; REQUIRED by the write API.
    #: Exactly the `EventMedia.alt_text` rule, for exactly the same reason.
    photo_alt_text = models.CharField(max_length=200, blank=True, default="")
    #: Retire somebody without erasing them. A `PROTECT` on the join means a
    #: person on a past event's lineup cannot be deleted, so "they no longer
    #: work with us" needs an answer that is not a delete.
    is_active = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "events"
        db_table = "crew_member"
        ordering = ("name", "id")
        indexes = [
            # The roster read and the wizard's picker are the same query —
            # one organization's live crew, by name. Partial, because a
            # soft-deleted row is never wanted by either.
            models.Index(
                fields=["organization", "name", "id"],
                name="crew_member_org_name_idx",
                condition=Q(deleted_at__isnull=True),
            ),
        ]

    def __str__(self) -> str:
        return self.name


class EventCrew(models.Model):
    """One crew member on one event's lineup, in order.

    An explicit join model rather than a `ManyToManyField`, and that is the
    house style rather than a preference: there is not one M2M on any model in
    this codebase. A descriptor would put `event.crew.all()` — an unscoped ORM
    query — within reach of any serializer, which is a `Model.objects` call in
    costume and exactly what the repository layer exists to prevent. It also
    gives the row somewhere to keep `position` and `billed_as`.

    `CASCADE` on the event and `PROTECT` on the member: the lineup is worthless
    without its event, and deleting a person out from under a live event's page
    would silently empty a section somebody is reading.

    NO `deleted_at`. It carries no content of its own, so a hard delete is
    honest — the same reasoning that gives `EventTimelineEntry` no `updated_at`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="crew")
    member = models.ForeignKey(CrewMember, on_delete=models.PROTECT, related_name="appearances")
    #: A per-event override of the roster's `role` — the same person is "DJ" on
    #: one night and "host" on another. Blank falls back to `member.role`,
    #: resolved in the selector so the fallback lives in one place.
    billed_as = models.CharField(max_length=80, blank=True, default="")
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "events"
        db_table = "event_crew"
        ordering = ("position", "id")
        constraints = [
            # A multi-select toggle double-fires on a slow connection, and the
            # same face twice in one carousel is the visible symptom.
            models.UniqueConstraint(fields=["event", "member"], name="event_crew_unique_member"),
        ]
        indexes = [
            models.Index(fields=["event", "position", "id"], name="event_crew_event_pos_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.member_id} on {self.event_id}"


class EventSlot(models.Model):
    """One session of an event — the "Evening slot, 4:30-9:30" a customer picks.

    ── THE INVENTORY DECISION, WHICH IS THE WHOLE DESIGN ──────────────────

    A slot must have its OWN inventory. Selling "100 tickets" across an evening
    and a night session means 100 EACH, not 100 shared — get this wrong and the
    night show oversells the moment the evening one is popular, which is the
    single most expensive bug this feature could carry.

    The way that is achieved here is deliberately boring: `TicketType` gains a
    nullable `slot` FK, and a slot-scoped tier is simply another `TicketType`
    row with its own `quantity`/`sold`/`reserved`. So the existing protection
    applies UNCHANGED —

      * `SELECT ... FOR UPDATE` already locks ONE tier row, and a per-slot tier
        is one tier row;
      * the `ticket_type_no_oversell` CHECK constraint is already per row;
      * `reserve`/`release`/`confirm_sold` need no argument they did not have.

    Nothing in the money path changes. That is the point: a feature that
    touches inventory should add rows, not add a second way to count them.

    ── AN EVENT WITHOUT SLOTS IS UNCHANGED ────────────────────────────────

    Slots are OPTIONAL. `TicketType.slot` is null for every existing tier and
    for every simple event, and the whole platform behaves exactly as before.
    This is additive, not a migration of the booking model.

    ── TIMES ARE ABSOLUTE, NOT TIMES-OF-DAY ───────────────────────────────

    `starts_at`/`ends_at` are full datetimes rather than a date on the event
    plus a time here. A run that crosses midnight, a festival spanning three
    days, and a slot on a different date from `Event.starts_at` are all
    ordinary; a time-of-day column would need a date resolved from somewhere,
    and "somewhere" is where timezone bugs live.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="slots")
    #: What the customer reads — "Evening slot", "Matinee", "Day 2". Optional:
    #: an unlabelled slot renders as its time range, which is what a customer
    #: is really choosing between.
    label = models.CharField(max_length=80, blank=True, default="")
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True)
    #: Display order. Chronological is the sane default, but an organiser may
    #: want to lead with the session they are pushing.
    position = models.PositiveIntegerField(default=0)
    #: Taken off sale WITHOUT deleting it. A slot with tickets sold cannot be
    #: removed — its tiers are referenced by issued tickets — so "cancel this
    #: session" has to be a flag, exactly as `TicketType` needs an archive
    #: rather than a delete.
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "events_event_slot"
        indexes = [
            # The only query this table serves: "this event's slots, in order".
            models.Index(fields=["event", "position", "starts_at"], name="event_slot_order_idx"),
        ]
        constraints = [
            # Two slots on one event cannot start at the same instant with the
            # same label — that is a duplicate an organiser made by
            # double-submitting, and it is indistinguishable to a customer.
            models.UniqueConstraint(
                fields=["event", "starts_at", "label"], name="event_slot_unique_start_label"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.label or 'Slot'} @ {self.starts_at:%Y-%m-%d %H:%M}"
