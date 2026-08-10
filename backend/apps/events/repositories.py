"""ORM access for events — the only place event queries live.

Every read is lean and index-aware (see CLAUDE.md's Performance checklist):
- `.only(...)` fetches exactly the columns each caller serializes — and never
  the fat `search_vector` tsvector.
- `select_related("organization")` on every read that renders the organizer
  name, so an event card / detail never triggers an N+1 for it.
- The public reads filter to `status=live` + `deleted_at IS NULL` so drafts
  and deleted rows are invisible to the public path at the query level, not
  in a view.
"""

from __future__ import annotations

import uuid

from django.contrib.postgres.search import SearchQuery
from django.db.models import F, Q, QuerySet, Value
from django.db.models.functions import Greatest
from django.utils import timezone

from core.base_repository import BaseRepository

from .models import (
    Event,
    EventFaq,
    EventMedia,
    EventSlot,
    EventStatus,
    EventTimelineEntry,
    MediaKind,
    SavedEvent,
)

# Columns a public event *card* (list item) needs — plus the org name via the
# select_related join. Deliberately tiny: this is the highest-volume payload.
_CARD_FIELDS = (
    "id",
    "title",
    "venue",
    "city",
    "starts_at",
    "poster_url",
    "from_price_minor",
    "tickets_available",
    "organization_id",
    "organization__name",
    # Read by the card and detail serializers. Absent from this set it would
    # be a DEFERRED field, so every row would re-fetch it — one extra query
    # per card, which is precisely the N+1 the query budgets guard.
    "category",
    # The rating denormals, in BOTH field sets for the reason stated above:
    # absent, they are deferred and every card re-fetches them, which is one
    # extra query per card. Two small integers on a row already being read.
    "rating_sum",
    "rating_count",
)

# Columns the fuller event *detail* needs.
_DETAIL_FIELDS = (
    "id",
    "organization_id",
    "organization__name",
    # Whether an operator has verified the organizer. Rides on the SAME
    # select_related join the org name already needs, so the "is this organizer
    # verified" question the event page asks costs no extra query — and it has
    # to be in this field set for the same deferred-load reason as everything
    # below.
    "organization__verified_level",
    "title",
    "description",
    "venue",
    "city",
    # The venue's resolved location. Same rule as the content fields below:
    # `EventDetailSerializer` returns them, so omitting them here is a
    # deferred load per field — which is exactly how adding these three
    # columns turned a 1-query detail read into a 4-query one, caught by the
    # budget test rather than in production.
    "place_id",
    "latitude",
    "longitude",
    "starts_at",
    "ends_at",
    "status",
    "poster_url",
    "from_price_minor",
    "tickets_available",
    "version",
    "created_at",
    # Content fields MUST be listed here. `EventDetailSerializer` returns
    # them, and a field the serializer touches but `.only()` omits is a
    # DEFERRED LOAD — one extra query per field, per row, silently. That is
    # exactly the N+1 the lean field sets exist to prevent, and it is why the
    # detail query budget is asserted in a test.
    "short_description",
    "duration_minutes",
    "language",
    "age_restriction",
    "accessibility_notes",
    # Read by `EventDetailSerializer`, so it has to be here — a field the
    # serializer touches but `.only()` omits is a DEFERRED load, one extra
    # query per row.
    "policies",
    "seo_title",
    "seo_description",
    # Read by the card and detail serializers. Absent from this set it would
    # be a DEFERRED field, so every row would re-fetch it — one extra query
    # per card, which is precisely the N+1 the query budgets guard.
    "category",
    # The rating denormals, in BOTH field sets for the reason stated above:
    # absent, they are deferred and every card re-fetches them, which is one
    # extra query per card. Two small integers on a row already being read.
    "rating_sum",
    "rating_count",
)

# Columns the organizer dashboard list needs (includes status, since drafts
# show there).
_ORGANIZER_CARD_FIELDS = (
    "id",
    "title",
    "city",
    "starts_at",
    "status",
    "poster_url",
    "from_price_minor",
    "organization_id",
    "organization__name",
    # Read by the card and detail serializers. Absent from this set it would
    # be a DEFERRED field, so every row would re-fetch it — one extra query
    # per card, which is precisely the N+1 the query budgets guard.
    "category",
)

# Columns the publish/edit path loads: enough to run the publish checks, the
# ownership check and the organization-verified gate, without the fat
# text/tsvector columns.
_WRITE_LOAD_FIELDS = (
    "id",
    "organization_id",
    "organization__owner_id",
    # The approval gate reads this on every publish (see
    # EventService.publish_event). Omitting it would make the check a DEFERRED
    # LOAD — one extra query per publish — which is exactly the trap the
    # detail field set's comment above describes.
    "organization__verified_level",
    "title",
    "venue",
    "starts_at",
    "status",
    "version",
)


class EventRepository(BaseRepository[Event]):
    model = Event

    # --- reads: public -----------------------------------------------------

    def get_published_by_id(self, event_id: uuid.UUID | str) -> Event | None:
        return (
            self.get_queryset()
            .select_related("organization")
            .filter(pk=event_id, status=EventStatus.LIVE, deleted_at__isnull=True)
            .only(*_DETAIL_FIELDS)
            .first()
        )

    def get_active_by_id(self, event_id: uuid.UUID | str) -> Event | None:
        """Detail-shaped load for ANY non-deleted status — used to render the
        response to an owner's own write (create/edit/publish), where a draft
        must come back too (the public get_published_by_id would hide it)."""
        return (
            self.get_queryset()
            .select_related("organization")
            .filter(pk=event_id, deleted_at__isnull=True)
            .only(*_DETAIL_FIELDS)
            .first()
        )

    def list_published(
        self,
        *,
        search: str | None = None,
        city: str | None = None,
        category: str | None = None,
        starts_after=None,
        starts_before=None,
    ) -> QuerySet[Event]:
        """Upcoming, published events (soonest first) for the public browse /
        search surface. All filters are index-backed:
        - status + starts_at range -> event_status_starts_idx (or the
          city-pinned event_status_city_starts_idx when `city` is given, or
          event_status_category_idx when `category` is);
        - `search` -> the GIN index on search_vector via `@@`.
        Ordered by starts_at so results stay index-ordered and cursor-paginate
        cleanly (relevance ranking would defeat both — a deliberate tradeoff).
        """
        lower_bound = starts_after or timezone.now()
        qs = (
            self.get_queryset()
            .select_related("organization")
            .filter(
                status=EventStatus.LIVE,
                deleted_at__isnull=True,
                starts_at__gte=lower_bound,
            )
        )
        if city:
            qs = qs.filter(city=city)
        if category:
            # An EXACT column match, not a keyword pushed through the tsquery.
            # The old behaviour searched for the stem ("comedy"), so it matched
            # an event whose description merely mentioned a comedian and missed
            # a stand-up night that never used the word. This also leaves `q`
            # free to mean what the user typed, instead of the two competing
            # for the same tsquery.
            qs = qs.filter(category=category)
        if starts_before:
            qs = qs.filter(starts_at__lte=starts_before)
        if search:
            # websearch parsing never raises on arbitrary user input (unlike
            # the default plainto/tsquery), so no query-string sanitising needed.
            qs = qs.filter(
                search_vector=SearchQuery(search, config="english", search_type="websearch")
            )
        return qs.only(*_CARD_FIELDS).order_by("starts_at", "id")

    # --- reads: organizer --------------------------------------------------

    def list_by_owner(self, owner_id: uuid.UUID | str) -> QuerySet[Event]:
        """Every event across the organizations this user owns, newest first
        (drafts included). One join to organizations; no N+1."""
        return (
            self.get_queryset()
            .select_related("organization")
            .filter(organization__owner_id=owner_id, deleted_at__isnull=True)  # type: ignore[misc]
            .only(*_ORGANIZER_CARD_FIELDS)
            .order_by("-created_at", "id")
        )

    def get_active_for_write(self, event_id: uuid.UUID | str) -> Event | None:
        """Load an event (any status) plus its organization's owner id, for the
        ownership + publish checks on the write path."""
        return (
            self.get_queryset()
            .select_related("organization")
            .filter(pk=event_id, deleted_at__isnull=True)
            .only(*_WRITE_LOAD_FIELDS)
            .first()
        )

    # --- writes ------------------------------------------------------------

    def create(
        self,
        *,
        organization_id: uuid.UUID | str,
        title: str,
        venue: str,
        city: str,
        starts_at,
        description: str = "",
        ends_at=None,
        poster_url: str = "",
        place_id: str = "",
        latitude=None,
        longitude=None,
    ) -> Event:
        return Event.objects.create(
            organization_id=organization_id,
            title=title,
            venue=venue,
            city=city,
            starts_at=starts_at,
            description=description,
            ends_at=ends_at,
            poster_url=poster_url,
            # Null unless the organizer picked a real Places suggestion.
            place_id=place_id,
            latitude=latitude,
            longitude=longitude,
        )

    def update_if_version_matches(
        self, *, event_id: uuid.UUID | str, expected_version: int, changes: dict
    ) -> bool:
        """Race-free optimistic lock: a single conditional UPDATE that only
        matches when the row is still at `expected_version`. Returns True if it
        applied (and bumped the version), False if the version had moved on —
        no read-then-write window for a concurrent edit to slip through.

        The tsvector trigger recomputes search_vector automatically whenever
        this UPDATE touches title/venue/city/description (see the migration),
        so search stays consistent without any extra work here.
        """
        updated = (
            self.get_queryset()
            .filter(pk=event_id, version=expected_version, deleted_at__isnull=True)
            .update(version=expected_version + 1, updated_at=timezone.now(), **changes)
        )
        return updated == 1

    def set_poster_url(self, *, event_id: uuid.UUID | str, poster_url: str) -> bool:
        """Targeted poster-URL update for the async processing task. Not part
        of the optimistic-lock/version scheme — it's a system-generated
        derivative of the organizer's own upload, not a competing user edit,
        and doesn't touch the tsvector source columns."""
        updated = (
            self.get_queryset()
            .filter(pk=event_id, deleted_at__isnull=True)
            .update(poster_url=poster_url, updated_at=timezone.now())
        )
        return updated == 1

    def get_for_settlement(self, event_id: uuid.UUID | str) -> Event | None:
        """The minimal event context `settlements` needs to release a payout:
        the start/end times (the event-finished + refund-window guard), and the
        organizer's owner id + email + linked payout account (for the payout and
        the PayoutReleased notification). One query, org + owner joined."""
        return (
            self.get_queryset()
            .select_related("organization", "organization__owner")
            .filter(pk=event_id)
            .only(
                "id",
                "title",
                "starts_at",
                "ends_at",
                "status",
                "organization_id",
                "organization__owner_id",
                "organization__payout_account_id",
                "organization__owner__email",
            )
            .first()
        )

    def get_for_checkin(self, event_id: uuid.UUID | str) -> Event | None:
        """Load the minimal event context the check-in gate needs: the
        organizer owner id (for the per-event authorization check) and the
        start/end times (for the scan window). One query, org joined, fat text
        columns excluded. Soft-deleted events are invisible — you can't check in
        to a deleted event."""
        return (
            self.get_queryset()
            .select_related("organization")
            .filter(pk=event_id, deleted_at__isnull=True)
            .only(
                "id",
                "organization_id",
                "organization__owner_id",
                "starts_at",
                "ends_at",
                "status",
            )
            .first()
        )

    def get_organizer_payout_account(self, event_id: uuid.UUID | str) -> str:
        """The event organization's Razorpay linked-account id (or "" if none
        linked yet). One scalar query joining event -> organization — used by
        booking to build the Route split when creating a payment order."""
        account = (
            self.get_queryset()
            .filter(pk=event_id)
            .values_list("organization__payout_account_id", flat=True)
            .first()
        )
        return account or ""

    def set_window(self, event_id: uuid.UUID | str, **window) -> bool:
        """Move the event's own start/end to match its sessions.

        Same class of write as `set_ticketing_fields` below and for the same
        reason: a DERIVED column, recomputed from authoritative rows (here the
        slots) rather than typed by a person. So it deliberately does not bump
        `version`, touch `updated_at` or re-run the tsvector trigger — a
        schedule sync must not invalidate the optimistic-lock token an
        organiser is holding while they edit the description.
        """
        if not window:
            return False
        updated = self.get_queryset().filter(pk=event_id, deleted_at__isnull=True).update(**window)
        return updated == 1

    def cancel_if_cancellable(self, *, event_id: uuid.UUID | str, expected_version: int) -> bool:
        """live | paused -> cancelled, as ONE conditional UPDATE.

        The source-state rule lives here rather than in a read-then-write, so
        two organisers pressing Cancel at once cannot both believe they did it
        and send two rounds of cancellation emails. `draft`/`rejected` are
        excluded because there is nobody to tell; `finished` because an event
        that already happened cannot be called off.
        """
        updated = (
            self.get_queryset()
            .filter(
                pk=event_id,
                version=expected_version,
                deleted_at__isnull=True,
                status__in=(EventStatus.LIVE, EventStatus.PAUSED),
            )
            .update(status=EventStatus.CANCELLED, version=F("version") + 1)
        )
        return updated == 1

    def get_cancelled_by_id(self, event_id: uuid.UUID | str) -> Event | None:
        """A cancelled event, for the public page that still has to resolve.

        Separate from `get_published_by_id` rather than widening it: every
        other caller of that method means "sellable", and quietly returning a
        cancelled event to them is how a ticket gets sold for an event that is
        not happening.
        """
        return (
            self.get_queryset()
            .select_related("organization")
            .filter(pk=event_id, status=EventStatus.CANCELLED, deleted_at__isnull=True)
            .only(*_DETAIL_FIELDS)
            .first()
        )

    def apply_rating_delta(
        self, *, event_id: uuid.UUID | str, sum_delta: int, count_delta: int
    ) -> None:
        """The documented write-point for `apps.reviews`' denormals.

        Atomic `F()` arithmetic, not read-modify-write: two reviews landing on
        the same event in the same millisecond would otherwise both read the
        old value and one increment would vanish. Same reasoning as
        `settlements`' running totals, and it needs no row lock.

        Deltas rather than absolutes so every lifecycle event is one call:
        create `(+rating, +1)`, delete or hide `(-rating, -1)`, edit
        `(new - old, 0)`.

        `Greatest(..., 0)` is a floor, not a correctness mechanism. The
        counters cannot legitimately go negative — the service only ever
        subtracts what it previously added — but the columns are
        `PositiveIntegerField`, so a bug that drove one below zero would raise
        an IntegrityError on an unrelated write and be attributed to whatever
        touched the row next. Clamping keeps the failure where it belongs.
        """
        self.get_queryset().filter(id=event_id).update(
            rating_sum=Greatest(F("rating_sum") + sum_delta, Value(0)),
            rating_count=Greatest(F("rating_count") + count_delta, Value(0)),
        )

    def set_ticketing_fields(
        self,
        *,
        event_id: uuid.UUID | str,
        from_price_minor: int | None,
        tickets_available: int | None,
    ) -> bool:
        """The documented write-point for the `ticketing` module's denormals
        (from_price_minor = cheapest active tier; tickets_available = total
        remaining). Not part of the version/optimistic-lock scheme and doesn't
        touch updated_at or the tsvector — these are system-maintained display
        columns, recomputed from the authoritative ticket rows by ticketing,
        not user edits."""
        updated = (
            self.get_queryset()
            .filter(pk=event_id, deleted_at__isnull=True)
            .update(from_price_minor=from_price_minor, tickets_available=tickets_available)
        )
        return updated == 1

    def submit_for_review_if_draft(
        self, *, event_id: uuid.UUID | str, expected_version: int
    ) -> bool:
        """draft | rejected -> pending_review, under the optimistic-lock guard.

        A REJECTED event may be resubmitted — that is the whole point of
        recording a reason rather than deleting the event. Both source states
        are in one conditional `UPDATE`, so a concurrent edit or a double
        submit still moves the row exactly once.

        `moderation_note` is cleared on resubmission: the note describes the
        LAST decision, and leaving a stale rejection reason attached to an
        event now awaiting a fresh review is how an operator rejects it twice
        for a problem that was already fixed.
        """
        updated = (
            self.get_queryset()
            .filter(
                pk=event_id,
                version=expected_version,
                status__in=(EventStatus.DRAFT, EventStatus.REJECTED),
                deleted_at__isnull=True,
            )
            .update(
                status=EventStatus.PENDING_REVIEW,
                submitted_at=timezone.now(),
                moderation_note="",
                version=expected_version + 1,
                updated_at=timezone.now(),
            )
        )
        return updated == 1

    def archive_if_archivable(self, *, event_id: uuid.UUID | str, expected_version: int) -> bool:
        """draft | rejected | finished -> archived, under the optimistic lock.

        The source states are the ones an organizer can safely retire, and the
        omissions are the point:

        - **`live` is not here.** Archiving an event that is on sale would hide
          it from buyers while tickets already issued for it stay valid. Take
          it off sale first (an operator's unpublish), then archive.
        - **`pending_review` is not here.** An event in an operator's queue is
          not the organizer's to withdraw silently — the operator would decide
          on a row that had vanished.

        Archiving is reversible in principle (the row is untouched apart from
        `status`), which is exactly why this is archive and NOT delete: an
        event is referenced by bookings, tickets and a settlement, so deleting
        one would orphan real money.
        """
        updated = (
            self.get_queryset()
            .filter(
                pk=event_id,
                version=expected_version,
                status__in=(EventStatus.DRAFT, EventStatus.REJECTED, EventStatus.FINISHED),
                deleted_at__isnull=True,
            )
            .update(
                status=EventStatus.ARCHIVED,
                version=expected_version + 1,
                updated_at=timezone.now(),
            )
        )
        return updated == 1

    def soft_delete(self, *, event_id, actor_id, reason: str) -> bool:
        """Remove an event from every surface, whatever state it is in.

        ── WHY SOFT AND NOT A REAL DELETE ─────────────────────────────────

        `Booking`, `ScanLog` and `TicketType` all reference `Event` with
        `on_delete=PROTECT`, so `Event.objects.delete()` raises `ProtectedError`
        for any event that has a ticket tier — which is EVERY published event,
        because publishing requires at least one. A literal delete would
        therefore fail on precisely the events an operator wants to remove and
        succeed only on empty drafts.

        Setting `deleted_at` achieves what the operator actually asked for: the
        event vanishes from browse, search, the city and category pages, the
        organizer's list and the public detail — every read in this repository
        already filters `deleted_at__isnull=True`. Issued tickets keep their
        foreign key, so the financial record stays intact and auditable, which
        is what a platform that took money for those tickets requires.

        CONDITIONAL on being un-deleted, so two operators pressing Delete
        cannot both "succeed" and send two rounds of cancellation emails to the
        same attendees.
        """
        updated = (
            self.get_queryset()
            .filter(pk=event_id, deleted_at__isnull=True)
            .update(
                deleted_at=timezone.now(),
                status=EventStatus.ARCHIVED,
                moderation_note=reason,
                moderated_by_id=actor_id,
                moderated_at=timezone.now(),
                updated_at=timezone.now(),
            )
        )
        return updated == 1

    def moderate_if_pending(
        self,
        *,
        event_id: uuid.UUID | str,
        approve: bool,
        actor_id: uuid.UUID | str,
        note: str,
    ) -> bool:
        """pending_review -> live | rejected. The operator's decision.

        Conditional on the CURRENT status rather than on a version, and that
        difference is deliberate: an operator is not editing content they read
        a moment ago, they are answering a question about a queue entry. What
        must not happen is two operators deciding the same event — and the
        `status=PENDING_REVIEW` predicate is exactly that guard. The second
        UPDATE matches zero rows and the caller is told the decision was
        already made.
        """
        updated = (
            self.get_queryset()
            .filter(pk=event_id, status=EventStatus.PENDING_REVIEW, deleted_at__isnull=True)
            .update(
                status=EventStatus.LIVE if approve else EventStatus.REJECTED,
                moderation_note=note,
                moderated_at=timezone.now(),
                moderated_by_id=actor_id,
                version=F("version") + 1,
                updated_at=timezone.now(),
            )
        )
        return updated == 1

    def unpublish(self, *, event_id: uuid.UUID | str, actor_id: uuid.UUID | str, note: str) -> bool:
        """live -> rejected. Taking a published event back off sale.

        Reuses `rejected` rather than inventing a `hidden` state: from the
        organizer's side the situation is identical — it is not public, there
        is a reason attached, and fixing it means editing and resubmitting.
        A parallel state would double every queue and filter for no new
        meaning.
        """
        updated = (
            self.get_queryset()
            .filter(pk=event_id, status=EventStatus.LIVE, deleted_at__isnull=True)
            .update(
                status=EventStatus.REJECTED,
                moderation_note=note,
                moderated_at=timezone.now(),
                moderated_by_id=actor_id,
                version=F("version") + 1,
                updated_at=timezone.now(),
            )
        )
        return updated == 1

    #: Statuses the moderation console may ask for. Deliberately NOT every
    #: `EventStatus`: `draft` is an organizer's private workspace and no
    #: operator has business browsing it, and `paused`/`finished` are lifecycle
    #: facts rather than moderation outcomes. An unknown value falls back to
    #: the pending queue rather than widening to everything.
    MODERATABLE_STATUSES = (
        EventStatus.PENDING_REVIEW,
        EventStatus.LIVE,
        EventStatus.REJECTED,
        EventStatus.ARCHIVED,
    )

    def list_for_moderation(
        self,
        *,
        status: str | None = None,
        search: str | None = None,
        starts_after=None,
        starts_before=None,
    ):
        """The moderation queue, or the record of past decisions.

        Ordering differs by what is being asked, and that is the point:

        - **Pending** is a QUEUE, so it is oldest-submission-first (FIFO). An
          operator working top-down should be clearing the longest wait, not
          the newest arrival.
        - **Everything else** is a RECORD, so it is newest-first — "what did
          we just do" is the question being asked of it.

        ── WHY THE SEARCH IS `icontains` AND NOT THE FULL-TEXT INDEX ───────

        `search_vector` is tuned for DISCOVERY: it is weighted, stemmed and
        `websearch`-parsed, so "Arij" matches nothing and "shows" matches
        "show". An operator is not discovering — they have been handed a name
        and are looking for that row, usually a fragment of it. A substring
        match is the right tool for that question even though it is the wrong
        one for browse.

        The window is on `starts_at`, not `created_at`: an operator filtering
        this list is asking "what is running that weekend", which is a fact
        about the event, not about when its draft was typed.
        """
        chosen = status if status in set(self.MODERATABLE_STATUSES) else None
        queryset = (
            self.get_queryset()
            .filter(status=chosen or EventStatus.PENDING_REVIEW, deleted_at__isnull=True)
            .select_related("organization")
            .only(
                "id",
                "title",
                "description",
                "venue",
                "city",
                "starts_at",
                "ends_at",
                "poster_url",
                "status",
                "submitted_at",
                "moderated_at",
                "moderation_note",
                "version",
                "created_at",
                "organization__id",
                "organization__name",
                "organization__verified_level",
                "organization__owner_id",
            )
        )
        if search:
            queryset = queryset.filter(
                Q(title__icontains=search)
                | Q(venue__icontains=search)
                | Q(city__icontains=search)
                # The organiser's name, because half of what an operator is
                # asked about arrives as "that promoter's show", not as a
                # title they can quote.
                | Q(organization__name__icontains=search)
            )
        if starts_after is not None:
            queryset = queryset.filter(starts_at__gte=starts_after)
        if starts_before is not None:
            queryset = queryset.filter(starts_at__lte=starts_before)

        if chosen is None or chosen == EventStatus.PENDING_REVIEW:
            return queryset.order_by("submitted_at")
        # `-created_at` and NOT `-moderated_at`: the console cursor-paginates
        # this, and a cursor needs a non-null monotonic column. An event can
        # reach `archived` without ever being moderated, so ordering on
        # `moderated_at` would put nulls in the middle of the keyset and make
        # paging skip rows. The decision time is still on every row for
        # display.
        return queryset.order_by("-created_at")

    def list_pending_review(self):
        """The pending queue. Kept as its own name because three call sites
        mean exactly this and reading `list_for_moderation()` at them would be
        less clear, not more."""
        return self.list_for_moderation(status=EventStatus.PENDING_REVIEW)

    def has_committed_bookings(self, event_id: uuid.UUID | str) -> bool:
        """Whether anybody holds, or held, a real place at this event.

        An EXPIRED or CANCELLED hold does not count: nothing was ever issued
        and nobody is owed anything, so an event whose only bookings lapsed is
        still a clean delete. Everything else does — including a live
        `reserved` hold, because somebody is in checkout right now.
        """
        from apps.booking.models import Booking, BookingStatus

        return (
            Booking.objects.filter(event_id=event_id)
            .exclude(status__in=(BookingStatus.EXPIRED, BookingStatus.CANCELLED))
            .exists()
        )

    def soft_delete_event(self, event_id: uuid.UUID | str) -> bool:
        """Remove an event from every read path, conditionally.

        A soft delete and not a real one: `Booking.event` and
        `Settlement.event` are both `PROTECT`, so a hard delete of an event
        anybody ever bought a ticket to would either raise or orphan a
        financial record. Every read path already filters
        `deleted_at__isnull=True`, so this is what "gone" means here.

        Conditional on `deleted_at__isnull=True` so a double delete writes
        nothing and reports False, rather than moving the timestamp and
        rewriting when it happened.
        """
        return (
            self.get_queryset()
            .filter(id=event_id, deleted_at__isnull=True)
            .update(deleted_at=timezone.now())
            > 0
        )


class EventContentRepository:
    """Media, FAQs and timeline for one event.

    Separate from `EventRepository` because these are child collections with
    their own lifecycle, and folding them in would give the events repository
    three more reasons to change.
    """

    # -------------------------------------------------------------- media

    def media_for(self, event_id: uuid.UUID | str) -> list[EventMedia]:
        """Visible media, ordered. One query, no N+1 from the caller."""
        return list(
            EventMedia.objects.filter(event_id=event_id, deleted_at__isnull=True, is_visible=True)
            .only("id", "kind", "url", "alt_text", "caption", "position", "event_id")
            .order_by("kind", "position", "created_at")
        )

    def count_media(self, event_id: uuid.UUID | str, kind: str) -> int:
        """Live rows of one kind — the number the caps are checked against."""
        return EventMedia.objects.filter(
            event_id=event_id, kind=kind, deleted_at__isnull=True
        ).count()

    def get_media(
        self, *, event_id: uuid.UUID | str, media_id: uuid.UUID | str
    ) -> EventMedia | None:
        """One media row, SCOPED TO ITS EVENT.

        The event id is part of the lookup rather than just of the URL: a row
        hanging off somebody else's event must MISS here, so an organizer who
        owns event A cannot reach into event B by pasting a media id they found.
        Every by-id method below scopes the same way.
        """
        return (
            EventMedia.objects.filter(pk=media_id, event_id=event_id, deleted_at__isnull=True)
            .only("id", "kind", "url", "alt_text", "caption", "position", "event_id")
            .first()
        )

    def add_media(self, **fields) -> EventMedia:
        return EventMedia.objects.create(**fields)

    def update_media(
        self, *, event_id: uuid.UUID | str, media_id: uuid.UUID | str, changes: dict
    ) -> EventMedia | None:
        """In-place edit of one row. Returns the fresh row, or None when nothing
        matched — a foreign, deleted or unknown id.

        `updated_at` is set explicitly because a queryset `UPDATE` bypasses
        `auto_now` (the same reason `EventRepository.update_if_version_matches`
        does it).
        """
        updated = EventMedia.objects.filter(
            pk=media_id, event_id=event_id, deleted_at__isnull=True
        ).update(updated_at=timezone.now(), **changes)
        if updated != 1:
            return None
        return self.get_media(event_id=event_id, media_id=media_id)

    def soft_delete_media(self, media_id: uuid.UUID | str) -> bool:
        """Soft: an organizer pulling an image mid-sale should not lose the
        asset, and a hard delete would orphan the stored object."""
        return (
            EventMedia.objects.filter(pk=media_id, deleted_at__isnull=True).update(
                deleted_at=timezone.now()
            )
            == 1
        )

    def reorder_media(self, *, event_id: uuid.UUID | str, positions: dict[str, int]) -> int:
        """Renumber one event's media. Returns how many rows moved.

        SCOPED BY EVENT, and that scope is a fix rather than a nicety: this
        filtered on the primary key alone, so any authenticated organizer could
        renumber the gallery of an event they do not own by pasting its media
        ids. An id outside this event now simply does not match — a no-op and
        not an error, because the caller is describing the order of THEIR
        gallery and an id that is not in it is not part of that order.

        One `bulk_update` (a single CASE-based `UPDATE`) rather than a loop of
        N statements: the list is bounded by the serializer, but a drag-and-drop
        should not cost fourteen round trips.
        """
        rows = list(
            EventMedia.objects.filter(
                pk__in=list(positions), event_id=event_id, deleted_at__isnull=True
            ).only("id", "position", "updated_at")
        )
        if not rows:
            return 0
        now = timezone.now()
        for row in rows:
            row.position = positions[str(row.pk)]
            row.updated_at = now
        EventMedia.objects.bulk_update(rows, ["position", "updated_at"])
        return len(rows)

    # ---------------------------------------------------------------- faq

    def faqs_for(self, event_id: uuid.UUID | str) -> list[EventFaq]:
        return list(
            EventFaq.objects.filter(event_id=event_id, deleted_at__isnull=True, is_published=True)
            .only("id", "question", "answer", "position", "event_id")
            .order_by("position", "created_at")
        )

    def add_faq(self, **fields) -> EventFaq:
        return EventFaq.objects.create(**fields)

    def update_faq(
        self, *, event_id: uuid.UUID | str, faq_id: uuid.UUID | str, changes: dict
    ) -> EventFaq | None:
        """In-place edit, scoped by event. None when nothing matched."""
        updated = EventFaq.objects.filter(
            pk=faq_id, event_id=event_id, deleted_at__isnull=True
        ).update(updated_at=timezone.now(), **changes)
        if updated != 1:
            return None
        return (
            EventFaq.objects.filter(pk=faq_id, event_id=event_id)
            .only("id", "question", "answer", "position", "event_id")
            .first()
        )

    def soft_delete_faq(self, faq_id: uuid.UUID | str) -> bool:
        return (
            EventFaq.objects.filter(pk=faq_id, deleted_at__isnull=True).update(
                deleted_at=timezone.now()
            )
            == 1
        )

    # ----------------------------------------------------------- timeline

    def timeline_for(self, event_id: uuid.UUID | str) -> list[EventTimelineEntry]:
        """Ordered by explicit position, then by time.

        Entries without a time sort LAST within their position — an organizer
        may know the running order before the clock times, and a null should
        not float to the top of the list.
        """
        return list(
            EventTimelineEntry.objects.filter(event_id=event_id, deleted_at__isnull=True)
            .only("id", "kind", "label", "description", "starts_at", "position", "event_id")
            .order_by("position", F("starts_at").asc(nulls_last=True), "created_at")
        )

    def add_timeline_entry(self, **fields) -> EventTimelineEntry:
        return EventTimelineEntry.objects.create(**fields)

    def update_timeline_entry(
        self, *, event_id: uuid.UUID | str, entry_id: uuid.UUID | str, changes: dict
    ) -> EventTimelineEntry | None:
        """In-place edit, scoped by event. None when nothing matched.

        No `updated_at` here — this table does not have one (a running-order
        entry is small enough that the row's history has never been asked for),
        and inventing a column to keep three methods symmetrical is a migration
        for nothing.
        """
        updated = EventTimelineEntry.objects.filter(
            pk=entry_id, event_id=event_id, deleted_at__isnull=True
        ).update(**changes)
        if updated != 1:
            return None
        return (
            EventTimelineEntry.objects.filter(pk=entry_id, event_id=event_id)
            .only("id", "kind", "label", "description", "starts_at", "position", "event_id")
            .first()
        )

    def soft_delete_timeline_entry(self, entry_id: uuid.UUID | str) -> bool:
        return (
            EventTimelineEntry.objects.filter(pk=entry_id, deleted_at__isnull=True).update(
                deleted_at=timezone.now()
            )
            == 1
        )


#: The caps, declared once. `EventContentService` is the only enforcer — see
#: the note on `EventMedia` for why this is not a database constraint.
MEDIA_LIMITS = {
    MediaKind.HERO: 1,
    MediaKind.GALLERY: 10,
    MediaKind.VIDEO: 1,
    MediaKind.THUMBNAIL: 1,
    MediaKind.MOBILE: 1,
}


class SavedEventRepository:
    """A user's saved events."""

    def save(self, *, user_id: uuid.UUID | str, event_id: uuid.UUID | str) -> bool:
        """Idempotent. Returns True when a row was created, False when it was
        already saved — so a double-tap on a slow connection is a no-op rather
        than an error the UI has to explain."""
        _, created = SavedEvent.objects.get_or_create(user_id=user_id, event_id=event_id)
        return created

    def unsave(self, *, user_id: uuid.UUID | str, event_id: uuid.UUID | str) -> bool:
        deleted, _ = SavedEvent.objects.filter(user_id=user_id, event_id=event_id).delete()
        return bool(deleted)

    def saved_ids(self, *, user_id: uuid.UUID | str) -> list[str]:
        """Just the ids — what the discovery cards need to draw a filled heart
        without loading an event the page already has."""
        return [
            str(row)
            for row in SavedEvent.objects.filter(user_id=user_id).values_list("event_id", flat=True)
        ]

    def list_cards(self, *, user_id: uuid.UUID | str) -> QuerySet[SavedEvent]:
        """The saved-events page: the same lean card fields the browse grid
        uses, joined in ONE query so a list of twenty is not twenty-one."""
        return (
            SavedEvent.objects.filter(user_id=user_id)
            .select_related("event", "event__organization")
            .only(
                "id",
                "created_at",
                "event__id",
                "event__title",
                "event__venue",
                "event__city",
                "event__starts_at",
                "event__poster_url",
                "event__status",
                "event__deleted_at",
                "event__from_price_minor",
                "event__tickets_available",
                "event__organization__id",
                "event__organization__name",
            )
            .order_by("-created_at")
        )


class EventSlotRepository(BaseRepository[EventSlot]):
    """ORM access for an event's sessions."""

    model = EventSlot

    def list_for_event(self, event_id, *, active_only: bool = True):
        """An event's slots, in the order the organiser arranged them.

        `position` first and `starts_at` second, matching `event_slot_order_idx`
        exactly — an organiser may want to lead with the session they are
        pushing, and chronological is only the default rather than the rule.
        """
        qs = self.get_queryset().filter(event_id=event_id)
        if active_only:
            qs = qs.filter(is_active=True)
        return qs.order_by("position", "starts_at")

    def get_for_event(self, event_id, slot_id) -> EventSlot | None:
        """Scoped by EVENT as well as id, so a slot id from another event
        cannot be attached to this one's tiers."""
        return self.get_queryset().filter(pk=slot_id, event_id=event_id).first()

    def create(self, *, event_id, label: str, starts_at, ends_at=None, position: int = 0):
        return EventSlot.objects.create(
            event_id=event_id,
            label=label,
            starts_at=starts_at,
            ends_at=ends_at,
            position=position,
        )

    def update_fields(self, slot: EventSlot, **fields) -> None:
        for key, value in fields.items():
            setattr(slot, key, value)
        slot.save(update_fields=[*fields, "updated_at"])

    def count_ticket_types(self, slot_id) -> int:
        """How many live tiers sell this session.

        Drives whether a slot may be DELETED at all. `TicketType.slot` is
        PROTECT, so a delete with tiers attached raises `ProtectedError` from
        deep inside the ORM — this turns that into a sentence an organiser can
        act on, checked before the delete rather than caught after it.
        """
        from apps.ticketing.models import TicketType

        return TicketType.objects.filter(slot_id=slot_id, deleted_at__isnull=True).count()

    def delete_slot(self, slot: EventSlot) -> None:
        slot.delete()
