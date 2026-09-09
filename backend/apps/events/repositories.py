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
from django.db.models import Count, Exists, F, OuterRef, Q, QuerySet, Value
from django.db.models.functions import Greatest
from django.utils import timezone

from core.base_repository import BaseRepository
from core.uploads import EVENT_PORTRAIT_SPEC

from .models import (
    CrewMember,
    Event,
    EventCrew,
    EventFaq,
    EventMedia,
    EventQuestion,
    EventSlot,
    EventStatus,
    EventTimelineEntry,
    EventWaitlist,
    MediaKind,
    OrganizerCategory,
    SavedEvent,
)

# Columns a public event *card* (list item) needs — plus the org name via the
# select_related join. Deliberately tiny: this is the highest-volume payload.
_CARD_FIELDS = (
    "id",
    # The human-readable half of `/events/{slug}-{id}`. In EVERY field set that
    # feeds a serializer for the same deferred-load reason as `category` below:
    # a card that has to re-fetch it is one extra query per card, on the
    # highest-volume payload on the platform.
    "slug",
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
    # The sub-classification, read by the card serializer for the same reason
    # and with the same cost as `category` above.
    "event_type",
    # The rating denormals, in BOTH field sets for the reason stated above:
    # absent, they are deferred and every card re-fetches them, which is one
    # extra query per card. Two small integers on a row already being read.
    "rating_sum",
    "rating_count",
)

# Columns the fuller event *detail* needs.
_DETAIL_FIELDS = (
    "id",
    # See the note in _CARD_FIELDS: serialized, so it must not be deferred.
    "slug",
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
    # Same rule as `policies` directly above: read by `EventDetailSerializer`,
    # so omitting them here makes each a deferred load and turns the platform's
    # hottest read from one query into six.
    "highlights_included",
    "highlights_excluded",
    "guidelines",
    "event_type",
    "tags",
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
    # See the note in _CARD_FIELDS: serialized, so it must not be deferred.
    # The organizer's own table links to the public page, and it should link to
    # the canonical URL rather than one that redirects.
    "slug",
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
    # `update_event` compares the newly-derived slug against the stored one, so
    # that a title edit which produces the SAME slug writes nothing and costs no
    # redirect. Reading it here keeps that comparison free rather than making it
    # a deferred load on every edit.
    "slug",
    "venue",
    "starts_at",
    "status",
    "version",
)

#: Hard ceiling on `/sitemap.xml` entries. The sitemap protocol caps a single
#: file at 50,000 URLs (and 50MB); this leaves room for the static routes and
#: the performer pages the same document carries. Past this the correct answer
#: is a sitemap INDEX splitting events across several files — a real piece of
#: work, deliberately not built before there are 45,000 live events to need it.
SITEMAP_MAX_URLS = 45_000


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

    def get_owned_by_id(self, event_id: uuid.UUID | str, owner_id: uuid.UUID | str):
        """One of the caller's OWN events, at ANY status, detail-shaped.

        ── WHY THIS EXISTS ────────────────────────────────────────────────

        The organizer wizard's edit route was reading the PUBLIC detail
        endpoint, which resolves only `LIVE` and `CANCELLED`. So opening the
        editor for a DRAFT — which is what every new event and every copy is —
        answered 404, and the wizard rendered "That event is not available".
        The event was there and belonged to them; nothing was allowed to say
        so.

        NO STATUS FILTER, on purpose and as the point of the method. An
        organizer may open any event they own: a finished one to clone it, a
        rejected one to fix it, a paused or archived one to look at what it
        said. `deleted_at` is still honoured, because a soft-deleted row is
        gone rather than merely hidden.

        Scoped by OWNER in the query rather than fetched-then-compared, so a
        stranger's event is never loaded at all — the same rule the crew and
        category repositories state. The caller turns a miss into a 404 for
        both "not yours" and "does not exist", so a guessed uuid cannot be
        used to test whether an id is real.
        """
        return (
            self.get_queryset()
            .select_related("organization")
            .filter(  # type: ignore[misc]
                pk=event_id,
                organization__owner_id=owner_id,
                deleted_at__isnull=True,
            )
            .only(*_DETAIL_FIELDS)
            .first()
        )

    #: What "already on the home screen" means for the publish-time title
    #: check below.
    #:
    #: `PENDING_REVIEW` is in here and that is deliberate. The rule an
    #: organizer is given is "no two ACTIVE events share a name at one venue",
    #: and an event awaiting a decision is one approval away from being active
    #: — so admitting a second identical submission would simply move the
    #: collision to the moderator, who has no way to see it.
    ACTIVE_TITLE_STATUSES = (EventStatus.LIVE, EventStatus.PENDING_REVIEW)

    def find_active_title_clash(
        self,
        *,
        title: str,
        venue: str,
        exclude_id: uuid.UUID | str,
    ):
        """Another ACTIVE event with this exact title at this exact venue.

        ── TITLE **AND** VENUE, NEVER TITLE ALONE ─────────────────────────

        A promoter running "Open Mic Night" in Bengaluru and in Pune is
        running two different events that should both be listed, and refusing
        the second would make the rule punish exactly the organizer this
        platform is for. The collision only matters where a buyer cannot tell
        them apart, which is the same name in the same place.

        Both comparisons are case- and whitespace-insensitive: "open mic
        night" and "Open Mic Night " are the same name to a reader, and a
        check a space defeats is not a check.

        NO INDEX FOR THIS, and that is a considered exception to the
        performance checklist rather than an oversight. It runs once per
        PUBLISH — a handful of times a day across the platform, on a path that
        already loads the event, verifies the organization and runs every
        readiness check — and a case-insensitive match would need an
        expression index (`Upper(title)`, `Upper(venue)`) which would be the
        first in this codebase. The status filter alone narrows the scan to
        the live and pending rows. Revisit it if publishing ever becomes a
        bulk operation.
        """
        return (
            self.get_queryset()
            .filter(
                status__in=self.ACTIVE_TITLE_STATUSES,
                deleted_at__isnull=True,
                title__iexact=title.strip(),
                venue__iexact=venue.strip(),
            )
            .exclude(pk=exclude_id)
            .only("id", "title", "venue", "city", "status")
            .first()
        )

    def list_published(
        self,
        *,
        search: str | None = None,
        city: str | None = None,
        category: str | None = None,
        event_type: str | None = None,
        tag: str | None = None,
        organization_id: str | None = None,
        starts_after=None,
        starts_before=None,
    ) -> QuerySet[Event]:
        """Upcoming, published events (soonest first) for the public browse /
        search surface. All filters are index-backed:
        - status + starts_at range -> event_status_starts_idx (or the
          city-pinned event_status_city_starts_idx when `city` is given,
          event_status_category_idx when `category` is, or
          event_status_org_starts_idx when `organization_id` is);
        - `search` -> the GIN index on search_vector via `@@`.
        Ordered by starts_at so results stay index-ordered and cursor-paginate
        cleanly (relevance ranking would defeat both — a deliberate tradeoff).
        """
        lower_bound = starts_after or timezone.now()
        qs = (
            self._publicly_visible()
            .select_related("organization")
            .filter(starts_at__gte=lower_bound)
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
        if event_type:
            # The sub-classification, an exact column match like `category`
            # above. Index-backed by `event_status_type_idx`.
            #
            # An unrecognised value is NOT rejected here — it simply matches
            # nothing, which is the correct outcome for a link carrying a
            # retired slug. The query serializer's `CharField` (not
            # `ChoiceField`) is what makes that reachable; see its docstring.
            qs = qs.filter(event_type=event_type)
        if tag:
            # A JSONB CONTAINMENT query — `tags @> '["outdoor"]'` — served by
            # `event_tags_gin`. `__contains` on a JSONField takes a LIST, not a
            # bare string: `tags__contains="outdoor"` is a different query that
            # asks whether the column contains that JSON *value* and quietly
            # matches nothing here.
            qs = qs.filter(tags__contains=[tag])
        if organization_id:
            # ── "MORE FROM THIS ORGANISER" ─────────────────────────────────
            #
            # The event widget's organiser sheet used to derive this list from
            # whatever events the DECK happened to be holding, because there was
            # no way to ask for it. So a deck opened on a single event — from a
            # shared link, from the account area, from any grid that did not
            # pass its whole list — showed no "More from" section at all, and
            # the reader had no way to tell an organiser with one event from a
            # question the API could not answer.
            #
            # Index-backed by `event_status_org_starts_idx`; the query is the
            # same shape as the city-pinned one above.
            qs = qs.filter(organization_id=organization_id)
        if starts_before:
            qs = qs.filter(starts_at__lte=starts_before)
        if search:
            # websearch parsing never raises on arbitrary user input (unlike
            # the default plainto/tsquery), so no query-string sanitising needed.
            qs = qs.filter(
                search_vector=SearchQuery(search, config="english", search_type="websearch")
            )
        return qs.only(*_CARD_FIELDS).order_by("starts_at", "id")

    def list_for_sitemap(self, *, limit: int = SITEMAP_MAX_URLS) -> QuerySet[Event]:
        """Every publicly-reachable event, for `/sitemap.xml`.

        Three columns and nothing else — a sitemap needs a URL and a date, so
        pulling a card payload here would be reading a poster URL and a price
        to throw them away.

        The visibility filter is `_publicly_visible()`, the SAME predicate
        `list_published` uses, rather than a restatement of it. A sitemap that
        drifts from the read path advertises pages that 404, which is worse for
        crawling than not listing them at all.

        Unlike the browse list this is NOT bounded to upcoming events: a past
        event's page still resolves, still carries its structured data, and is
        still what somebody searching for last month's show should land on.

        Ordered `-updated_at` so the freshest rows survive the cap. The cap
        exists because a sitemap file is limited to 50,000 URLs / 50MB by the
        protocol — past that this needs a sitemap INDEX, which is the next step
        and deliberately not built before it is needed.
        """
        return (
            self._publicly_visible()
            .only("id", "slug", "updated_at")
            .order_by("-updated_at", "id")[:limit]
        )

    def _publicly_visible(self) -> QuerySet[Event]:
        """Rows a signed-out visitor may see: live and not soft-deleted."""
        return self.get_queryset().filter(status=EventStatus.LIVE, deleted_at__isnull=True)

    #: Statuses whose PUBLIC PAGE still resolves for a visitor.
    #:
    #: Wider than `_publicly_visible` on purpose, and the two are not
    #: interchangeable: a browse LISTING shows only what is sellable, while a
    #: cancelled event keeps its page because hundreds of people hold a link in
    #: an email and a 404 there reads as "the platform lost my booking" (see
    #: `selectors.get_event_detail_payload`).
    #:
    #: This is the right predicate for anything that LINKS to an event page —
    #: a saved list, a shared collection — as opposed to anything that offers
    #: one for sale.
    PUBLICLY_RESOLVABLE_STATUSES = (EventStatus.LIVE, EventStatus.CANCELLED)

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
        slug: str = "",
        category: str = "",
        custom_category_id=None,
    ) -> Event:
        return Event.objects.create(
            organization_id=organization_id,
            title=title,
            # Named explicitly, like every other column this repository writes.
            # `category` is the closed browse facet; `custom_category_id` is the
            # organizer's own label, already proven to belong to them by the
            # service before it reaches here.
            category=category,
            custom_category_id=custom_category_id,
            # Derived from the title by the service, never client-supplied.
            slug=slug,
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

    def publish_if_draft(self, *, event_id: uuid.UUID | str, expected_version: int) -> bool:
        """draft | rejected -> LIVE, under the optimistic-lock guard.

        The self-serve twin of `submit_for_review_if_draft`, for an
        organization the platform has already verified. Same source states,
        same conditional UPDATE, same version guard — the only difference is
        where the row lands.

        `moderated_at` is stamped and `moderated_by` deliberately is NOT. The
        pair then reads exactly as what happened: a decision was recorded at
        this time, and no operator made it. Leaving `moderated_at` null instead
        would make an auto-published event indistinguishable from one that has
        never been through the gate at all, which is the thing the console's
        queue filters on.
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
                status=EventStatus.LIVE,
                submitted_at=timezone.now(),
                moderated_at=timezone.now(),
                moderation_note="",
                version=expected_version + 1,
                updated_at=timezone.now(),
            )
        )
        return updated == 1

    def create_clone(self, *, organization_id, fields: dict) -> Event:
        """Insert a copy as a fresh DRAFT.

        `status` is set HERE rather than passed in, so no caller can clone an
        event into a published state by handing over the wrong dictionary.
        """
        return Event.objects.create(
            organization_id=organization_id,
            status=EventStatus.DRAFT,
            **fields,
        )

    def copy_content_to(self, *, source_id, target_id) -> dict[str, str]:
        """Copy the collections this module OWNS onto the clone: FAQs, running order,
        media, and slots.

        Returns a mapping of {old_slot_id: new_slot_id} so ticket types can be
        re-mapped to cloned slots.
        """
        EventFaq.objects.bulk_create(
            [
                EventFaq(
                    event_id=target_id,
                    question=row.question,
                    answer=row.answer,
                    position=row.position,
                )
                for row in EventFaq.objects.filter(
                    event_id=source_id, deleted_at__isnull=True
                ).only("question", "answer", "position")
            ]
        )
        EventTimelineEntry.objects.bulk_create(
            [
                EventTimelineEntry(
                    event_id=target_id,
                    kind=row.kind,
                    label=row.label,
                    description=row.description,
                    starts_at=row.starts_at,
                    position=row.position,
                )
                for row in EventTimelineEntry.objects.filter(
                    event_id=source_id, deleted_at__isnull=True
                ).only("kind", "label", "description", "starts_at", "position")
            ]
        )
        EventMedia.objects.bulk_create(
            [
                EventMedia(
                    event_id=target_id,
                    kind=row.kind,
                    url=row.url,
                    alt_text=row.alt_text,
                    caption=row.caption,
                    position=row.position,
                    is_visible=row.is_visible,
                )
                for row in EventMedia.objects.filter(event_id=source_id, deleted_at__isnull=True)
            ]
        )
        slot_map: dict[str, str] = {}
        for slot in EventSlot.objects.filter(event_id=source_id, is_active=True):
            new_slot = EventSlot.objects.create(
                event_id=target_id,
                label=slot.label,
                starts_at=slot.starts_at,
                ends_at=slot.ends_at,
                position=slot.position,
                is_active=slot.is_active,
            )
            slot_map[str(slot.id)] = str(new_slot.id)
        return slot_map

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

        ── `all` IS AN EXPLICIT CHOICE, AND STILL NOT "EVERYTHING" ─────────

        An UNKNOWN status falls back to the pending queue, deliberately: a
        mistyped query string must not silently widen an operator's view. But
        there was then no way to ask for the moderatable set as a whole, and
        the console's event picker genuinely needs it — a booking can belong to
        an event that is live, finished, sent back or archived, so a picker
        offering only pending ones finds almost nothing. That is exactly what
        happened: it asked for "all", got the pending fallback, and reported
        "No events on the platform yet" over a table listing five of them.

        So `all` widens to `MODERATABLE_STATUSES` and NOT to every row.
        `draft` stays unreachable, because an unsubmitted draft is an
        organizer's private workspace — the rule this allow-list exists for.
        """
        wants_all = status == "all"
        # Matched against the allow-list rather than cast, so `chosen` is a real
        # `EventStatus` and the query is typed. An unrecognised string simply
        # never matches, which IS the pending fallback.
        chosen: EventStatus | None = None
        if not wants_all:
            for candidate in self.MODERATABLE_STATUSES:
                if status == candidate:
                    chosen = candidate
                    break
        statuses: list[EventStatus] = (
            list(self.MODERATABLE_STATUSES) if wants_all else [chosen or EventStatus.PENDING_REVIEW]
        )
        queryset = (
            self.get_queryset()
            .filter(status__in=statuses, deleted_at__isnull=True)
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

        if not wants_all and (chosen is None or chosen == EventStatus.PENDING_REVIEW):
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
            # `is_vertical` is read by `EventMediaSerializer`, so omitting it
            # here would make it a DEFERRED load — one extra query per media
            # row on the edge-cached content payload.
            .only(
                "id",
                "kind",
                "url",
                "alt_text",
                "caption",
                "position",
                "is_vertical",
                "event_id",
            )
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

    # ---------------------------------------------------------- questions

    def questions_for(self, event_id: uuid.UUID | str) -> list[EventQuestion]:
        """The live questions, in the organiser's order.

        `.only()` covers everything `EventQuestionSerializer` reads — a field
        the serializer touches and this omits is a deferred load, one extra
        query per question on a checkout.
        """
        return list(
            EventQuestion.objects.filter(event_id=event_id, deleted_at__isnull=True)
            .only(
                "id",
                "prompt",
                "help_text",
                "kind",
                "choices",
                "is_required",
                "position",
                "event_id",
            )
            .order_by("position", "created_at")
        )

    def required_question_ids(self, event_id: uuid.UUID | str) -> set[str]:
        """Just the ids that must be answered — the check on the write path.

        A `values_list` rather than loading rows: this runs on every booking
        creation for every event, and the answer is a set of uuids.
        """
        return {
            str(value)
            for value in EventQuestion.objects.filter(
                event_id=event_id, deleted_at__isnull=True, is_required=True
            ).values_list("id", flat=True)
        }

    def count_questions(self, event_id: uuid.UUID | str) -> int:
        return EventQuestion.objects.filter(event_id=event_id, deleted_at__isnull=True).count()

    def add_question(self, **fields) -> EventQuestion:
        return EventQuestion.objects.create(**fields)

    def update_question(
        self, *, event_id: uuid.UUID | str, question_id: uuid.UUID | str, changes: dict
    ) -> EventQuestion | None:
        """In-place edit, scoped by event. None when nothing matched."""
        updated = EventQuestion.objects.filter(
            pk=question_id, event_id=event_id, deleted_at__isnull=True
        ).update(updated_at=timezone.now(), **changes)
        if updated != 1:
            return None
        return EventQuestion.objects.filter(pk=question_id, event_id=event_id).first()

    def soft_delete_question(self, question_id: uuid.UUID | str) -> bool:
        """SOFT, and `BookingAnswer.question` is `PROTECT`ed besides.

        An answer whose prompt was hard-deleted is a value with no question —
        "Vegetarian" against nothing, which an organiser cannot act on.
        """
        return (
            EventQuestion.objects.filter(pk=question_id, deleted_at__isnull=True).update(
                deleted_at=timezone.now()
            )
            == 1
        )

    def get_question(
        self, *, event_id: uuid.UUID | str, question_id: uuid.UUID | str
    ) -> EventQuestion | None:
        return EventQuestion.objects.filter(
            pk=question_id, event_id=event_id, deleted_at__isnull=True
        ).first()

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

#: The other half of the gallery's bounds, and it is enforced somewhere
#: ELSE — at PUBLISH, never at upload.
#:
#: A minimum cannot be an upload-time rule: images arrive one request at a
#: time, so the first one would always be refused for being the first one.
#: Nor can it be a removal-time rule without trapping an organizer who wants
#: to replace both of their photographs — they would have to add before they
#: could subtract, in an order nobody would guess.
#:
#: So it is a readiness gate, next to "has a title" and "has enough tags":
#: a gallery of exactly one photograph is not a gallery, it is a picture that
#: reads on the event page as an upload that failed halfway. NONE is fine and
#: stays fine — most events have no gallery at all, and the section is absent
#: rather than empty, which is this codebase's rule everywhere else.
MIN_GALLERY_IMAGES = 2

#: What SHAPE each kind has to be, beside the table saying how many.
#:
#: Every image used to go through `EVENT_IMAGE_SPEC`, so every slot was
#: landscape — including `MOBILE`, whose entire job is to be the picture
#: somebody sees on a phone, where the card is taller than it is wide. The
#: frontend's zone table documented the absence verbatim and named this map as
#: the precondition for fixing it.
#:
#: A kind MISSING from here falls back to the landscape spec rather than being
#: unconstrained — the opposite of `MEDIA_LIMITS`, where a missing key means
#: UNLIMITED. Shape is a rendering guarantee and the safe default is the
#: existing one; a cap is a policy and the safe default there is to refuse
#: nothing silently. Both defaults are deliberate and they point different ways.
MEDIA_SPECS = {
    MediaKind.MOBILE: EVENT_PORTRAIT_SPEC,
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
        uses, joined in ONE query so a list of twenty is not twenty-one.

        ── AN EVENT NOBODY CAN SEE IS NOT SAVEABLE EITHER ──────────────────

        This had NO visibility filter at all, so it returned every saved row —
        soft-deleted events, drafts an organizer had unpublished, events pulled
        by moderation — and `is_available` merely LABELLED them. A card for a
        page that 404s is worse than no card: the reader taps it, lands on
        nothing, and the only conclusion available is that the app is broken.

        The rule is now the one the rest of the platform follows: whatever a
        visitor can reach from All Events is what can appear here, so a saved
        list can never advertise what the catalogue has withdrawn.

        CANCELLED AND PAST EVENTS ARE DELIBERATELY STILL SHOWN — they are the
        two cases where hiding would destroy real information. Somebody who
        saved a show that was later called off needs to see THAT, not an empty
        list implying they never saved it; and a past event they attended is a
        record, not clutter. Both keep a page that resolves, and both carry
        `is_available: false` so the card says so instead of offering a dead
        Book button, which is exactly what that flag is for.

        THE SAVED ROW ITSELF IS NOT DELETED, only hidden. An organizer who
        unpublishes an event for an afternoon and republishes it must not
        silently cost everybody their save — and `saved_ids`, which the client
        replaces its local set from, is deliberately left unfiltered for the
        same reason.
        """
        return (
            SavedEvent.objects.filter(
                user_id=user_id,
                event__status__in=EventRepository.PUBLICLY_RESOLVABLE_STATUSES,
                event__deleted_at__isnull=True,
            )
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


class CrewMemberRepository(BaseRepository[CrewMember]):
    """An organization's roster of people it puts on stage.

    Every lookup is scoped by ORGANIZATION as well as by primary key. That is
    the same rule `EventContentRepository` states for its own rows — a row
    belonging to somebody else must MISS rather than be found and then refused
    — and here it is the whole cross-tenant boundary: a guessed uuid must never
    be able to put a stranger's face on your public event page.
    """

    model = CrewMember

    def list_for_organization(
        self, organization_id: uuid.UUID | str, *, active_only: bool = False
    ) -> list[CrewMember]:
        """The roster, and the wizard's picker, in ONE index-backed query.

        `active_only` is the picker: a retired member stays visible on the
        management screen (so they can be brought back) and is absent from the
        list of people you can add to a new event.
        """
        rows = CrewMember.objects.filter(
            organization_id=organization_id, deleted_at__isnull=True
        ).only(
            "id",
            "name",
            "role",
            "details",
            "photo_url",
            "photo_alt_text",
            "is_active",
            "created_at",
        )
        if active_only:
            rows = rows.filter(is_active=True)
        return list(rows.order_by("name", "id"))

    def create_member(self, **fields) -> CrewMember:
        """`BaseRepository` deliberately exposes no generic `create` — every
        repository names the columns it writes, so a caller cannot invent one."""
        return CrewMember.objects.create(**fields)

    def get_owned(
        self, *, organization_id: uuid.UUID | str, member_id: uuid.UUID | str
    ) -> CrewMember | None:
        return CrewMember.objects.filter(
            pk=member_id, organization_id=organization_id, deleted_at__isnull=True
        ).first()

    def owned_ids(
        self, *, organization_id: uuid.UUID | str, member_ids: list[uuid.UUID | str]
    ) -> set[str]:
        """Which of these ids this organization actually owns — ONE query.

        The lineup write validates a whole selection at once, and doing it with
        a loop would make a 25-person lineup 25 round trips on a write path.
        """
        if not member_ids:
            return set()
        return {
            str(row)
            for row in CrewMember.objects.filter(
                organization_id=organization_id,
                deleted_at__isnull=True,
                is_active=True,
                pk__in=member_ids,
            ).values_list("id", flat=True)
        }

    def count_for_organization(self, organization_id: uuid.UUID | str) -> int:
        return CrewMember.objects.filter(
            organization_id=organization_id, deleted_at__isnull=True
        ).count()

    def update_owned(
        self, *, organization_id: uuid.UUID | str, member_id: uuid.UUID | str, **changes
    ) -> CrewMember | None:
        """One conditional UPDATE scoped by owner, so a row belonging to
        somebody else changes nothing and reports nothing."""
        updated = CrewMember.objects.filter(
            pk=member_id, organization_id=organization_id, deleted_at__isnull=True
        ).update(updated_at=timezone.now(), **changes)
        if updated != 1:
            return None
        return self.get_owned(organization_id=organization_id, member_id=member_id)

    def soft_delete_owned(
        self, *, organization_id: uuid.UUID | str, member_id: uuid.UUID | str
    ) -> bool:
        return (
            CrewMember.objects.filter(
                pk=member_id, organization_id=organization_id, deleted_at__isnull=True
            ).update(deleted_at=timezone.now())
            == 1
        )

    def is_on_any_lineup(self, member_id: uuid.UUID | str) -> bool:
        """Whether removing this person would empty a section on a real event.

        `EventCrew.member` is `PROTECT`, so a hard delete would raise anyway;
        this is what lets the service answer with a 409 that names the fix
        (deactivate) instead of surfacing a database integrity error.
        """
        # django-stubs types the `member_id=` lookup as CrewMember | UUID |
        # None, which is a stub limitation rather than a real constraint — the
        # column is a uuid and a string form of one is exactly what a URL
        # segment produces.
        return EventCrew.objects.filter(member_id=member_id).exists()  # type: ignore[misc]


class OrganizerCategoryRepository(BaseRepository[OrganizerCategory]):
    """One organization's own category labels.

    Modelled on `CrewMemberRepository` line for line, because it is the same
    shape of thing: a small, organizer-owned list picked from while building
    an event. Every lookup is scoped by ORGANIZATION as well as by primary
    key, which is what makes "restricted to their specific organizer account"
    a property of the query rather than a rule somebody has to remember —
    a row belonging to somebody else MISSES rather than being found and then
    refused.
    """

    model = OrganizerCategory

    _LEAN_FIELDS = (
        "id",
        "label",
        "slug",
        "image_url",
        "image_alt_text",
        "is_active",
        "created_at",
    )

    def list_for_organization(
        self, organization_id: uuid.UUID | str, *, active_only: bool = False
    ) -> list[OrganizerCategory]:
        """The management list, and the wizard's picker, in ONE index-backed
        query — `organizer_category_org_idx` is exactly this filter and order.

        `active_only` is the picker: a retired category stays on the
        management screen so it can be brought back, and is absent from the
        list an organizer can put on a NEW event.
        """
        rows = OrganizerCategory.objects.filter(
            organization_id=organization_id, deleted_at__isnull=True
        ).only(*self._LEAN_FIELDS)
        if active_only:
            rows = rows.filter(is_active=True)
        return list(rows.order_by("label", "id"))

    def create_category(self, **fields) -> OrganizerCategory:
        """`BaseRepository` deliberately exposes no generic `create` — every
        repository names the columns it writes, so a caller cannot invent one."""
        return OrganizerCategory.objects.create(**fields)

    def get_owned(
        self, *, organization_id: uuid.UUID | str, category_id: uuid.UUID | str
    ) -> OrganizerCategory | None:
        return OrganizerCategory.objects.filter(
            pk=category_id, organization_id=organization_id, deleted_at__isnull=True
        ).first()

    def get_owned_by_slug(
        self, *, organization_id: uuid.UUID | str, slug: str
    ) -> OrganizerCategory | None:
        """Used to answer "you already have one of these" with the existing row.

        The unique constraint is the real guard against a duplicate; this is
        what lets the service return the row somebody already has instead of
        refusing a second attempt to type the same word.
        """
        return OrganizerCategory.objects.filter(
            organization_id=organization_id, slug=slug, deleted_at__isnull=True
        ).first()

    def count_for_organization(self, organization_id: uuid.UUID | str) -> int:
        return OrganizerCategory.objects.filter(
            organization_id=organization_id, deleted_at__isnull=True
        ).count()

    def update_owned(
        self, *, organization_id: uuid.UUID | str, category_id: uuid.UUID | str, **changes
    ) -> OrganizerCategory | None:
        """One conditional UPDATE scoped by owner, so a row belonging to
        somebody else changes nothing and reports nothing."""
        updated = OrganizerCategory.objects.filter(
            pk=category_id, organization_id=organization_id, deleted_at__isnull=True
        ).update(updated_at=timezone.now(), **changes)
        if updated != 1:
            return None
        return self.get_owned(organization_id=organization_id, category_id=category_id)

    def soft_delete_owned(
        self, *, organization_id: uuid.UUID | str, category_id: uuid.UUID | str
    ) -> bool:
        return (
            OrganizerCategory.objects.filter(
                pk=category_id, organization_id=organization_id, deleted_at__isnull=True
            ).update(deleted_at=timezone.now())
            == 1
        )

    def is_on_any_event(self, category_id: uuid.UUID | str) -> bool:
        """Whether retiring this category would orphan a real event.

        `Event.custom_category` is `PROTECT`, so a hard delete would raise
        anyway; this is what lets the service answer with a 409 naming the fix
        (deactivate) instead of surfacing a database integrity error — the
        same arrangement `CrewMemberRepository.is_on_any_lineup` has.
        """
        # django-stubs types the `custom_category_id=` lookup as
        # OrganizerCategory | UUID | None, a stub limitation rather than a real
        # constraint — the column is a uuid and a string form of one is exactly
        # what a URL segment produces. Same note as `is_on_any_lineup`.
        return Event.objects.filter(custom_category_id=category_id).exists()  # type: ignore[misc]

    def owns_category(
        self, *, organization_id: uuid.UUID | str, category_id: uuid.UUID | str
    ) -> bool:
        """THE CROSS-TENANT CHECK, and it is the only real security boundary here.

        `custom_category` arrives on a PATCH as a uuid from a browser. Without
        this, a guessed id would put ANOTHER organization's label — and its
        image — on your event. The crew module states the same rule for the
        same reason; this is its category-shaped twin.

        Live rows only: a retired category cannot be attached to a new event,
        which is what `is_active` is for.
        """
        return OrganizerCategory.objects.filter(
            pk=category_id,
            organization_id=organization_id,
            deleted_at__isnull=True,
            is_active=True,
        ).exists()


class EventCrewRepository:
    """The lineup: which crew members appear on which event, in what order."""

    def for_event(self, event_id: uuid.UUID | str) -> list[EventCrew]:
        """One event's lineup with its people joined.

        `select_related("member")` is the whole reason this is not an N+1: the
        public content read renders a name, a role and a photo per entry, and
        without it a ten-person lineup would be eleven queries on the platform's
        hottest cached endpoint.
        """
        return list(
            EventCrew.objects.filter(event_id=event_id, member__deleted_at__isnull=True)
            .select_related("member")
            .only(
                "id",
                "billed_as",
                "position",
                "event_id",
                "member__id",
                "member__name",
                "member__role",
                "member__photo_url",
                "member__photo_alt_text",
            )
            .order_by("position", "id")
        )

    def replace_for_event(self, *, event_id: uuid.UUID | str, member_ids: list[str]) -> int:
        """Set the whole lineup. Returns how many entries it now has.

        SET REPLACEMENT rather than add/remove endpoints, because the control
        upstream is a multi-select: the user manipulates a SET and presses save
        once. Diffing it into per-row calls in the client would make the
        network the source of truth for what was chosen, and a dropped request
        would leave a lineup nobody had asked for.

        Delete-then-insert inside the caller's transaction. `position` comes
        from the order the ids arrive in, so the organizer's ordering in the
        picker is the ordering on the page.
        """
        EventCrew.objects.filter(event_id=event_id).delete()
        if not member_ids:
            return 0
        EventCrew.objects.bulk_create(
            [
                EventCrew(event_id=event_id, member_id=member_id, position=index)
                for index, member_id in enumerate(member_ids)
            ]
        )
        return len(member_ids)

    def copy_to_event(self, *, source_event_id: uuid.UUID | str, target_event_id: uuid.UUID | str):
        """Carry a lineup onto a duplicated event.

        A copy is a new event, but the LINEUP is exactly the retyping that
        `duplicate_event` exists to remove — a monthly residency has the same
        residents. It points at the same `CrewMember` rows rather than copying
        them: a person is one person, and duplicating the roster would leave an
        organizer editing the same face in four places.
        """
        entries = EventCrew.objects.filter(event_id=source_event_id).order_by("position", "id")
        EventCrew.objects.bulk_create(
            [
                EventCrew(
                    event_id=target_event_id,
                    member_id=entry.member_id,
                    billed_as=entry.billed_as,
                    position=entry.position,
                )
                for entry in entries
            ]
        )


class EventWaitlistRepository:
    """The waiting list for a sold-out event.

    Two access patterns, and they want different things:

    - The CUSTOMER's side is one row at a time (am I on it, join, leave) plus
      one list of their own — small, indexed, and not on any hot path.
    - The SWEEPER reads a bounded batch per event, oldest first, and marks each
      one as it goes. That is the query `event_waitlist_pending` exists for: a
      PARTIAL index on the un-notified half, which shrinks as a list is worked
      through rather than carrying everybody already told.
    """

    # ── the customer's side ─────────────────────────────────────────────────

    def join(self, *, user_id: uuid.UUID | str, event_id: uuid.UUID | str) -> bool:
        """Idempotent. True when a row was created, False when already waiting.

        `get_or_create` rather than a check-then-insert: the control double-fires
        on a slow connection, and the unique constraint is what makes the second
        press a no-op instead of an `IntegrityError` on somebody's screen.

        A REJOIN after being notified deliberately does NOT clear `notified_at`
        — that row is not re-created, it is found. Somebody who was told and did
        not buy has been served; putting them back at the head of the queue by
        pressing the button again would let anybody skip it.
        """
        _, created = EventWaitlist.objects.get_or_create(user_id=user_id, event_id=event_id)
        return created

    def leave(self, *, user_id: uuid.UUID | str, event_id: uuid.UUID | str) -> bool:
        deleted, _ = EventWaitlist.objects.filter(user_id=user_id, event_id=event_id).delete()
        return bool(deleted)

    def waiting_event_ids(self, *, user_id: uuid.UUID | str) -> list[str]:
        """Just the ids — what an event page needs to draw "You're on the list"
        without loading a row it already has."""
        return [
            str(row)
            for row in EventWaitlist.objects.filter(user_id=user_id).values_list(
                "event_id", flat=True
            )
        ]

    def list_for_user(self, *, user_id: uuid.UUID | str) -> QuerySet[EventWaitlist]:
        """The account's own waiting list.

        Filtered to what the catalogue still resolves, for the same reason
        `SavedEventRepository.list_cards` is: a card linking to a page that
        404s is worse than no card. Cancelled and past events stay — somebody
        waiting for a show that was called off needs to see THAT rather than an
        empty list implying they never joined.
        """
        return (
            EventWaitlist.objects.filter(
                user_id=user_id,
                event__status__in=EventRepository.PUBLICLY_RESOLVABLE_STATUSES,
                event__deleted_at__isnull=True,
            )
            .select_related("event")
            .only(
                "id",
                "created_at",
                "notified_at",
                "event__id",
                "event__title",
                "event__slug",
                "event__venue",
                "event__city",
                "event__starts_at",
                "event__poster_url",
                "event__status",
                "event__tickets_available",
            )
            # `id` breaks the tie for the same reason `pending_for_event` needs
            # it: two joins in one tick would otherwise render in a different
            # order on every load of the account screen.
            .order_by("-created_at", "id")
        )

    # ── the organizer's side ────────────────────────────────────────────────

    def count_for_event(self, event_id: uuid.UUID | str) -> int:
        return EventWaitlist.objects.filter(event_id=event_id).count()

    def counts_for_events(self, event_ids: list[uuid.UUID | str]) -> dict[str, int]:
        """Demand for a whole page of events, in ONE query.

        Asking per row is the N+1 the performance checklist exists to stop, and
        an events table is exactly where one would go unnoticed.
        """
        if not event_ids:
            return {}
        return {
            str(row["event_id"]): row["n"]
            for row in EventWaitlist.objects.filter(event_id__in=event_ids)
            .values("event_id")
            .annotate(n=Count("id"))
        }

    # ── the sweeper's side ──────────────────────────────────────────────────

    def events_awaiting_notification(self, *, now, cooldown_before, limit: int) -> list[uuid.UUID]:
        """Events that have seats AND somebody waiting who has not been told.

        Four conditions, and each one is load-bearing:

        - **LIVE, not deleted, and upcoming.** Telling somebody tickets are
          available for an event that has finished, been withdrawn or been
          cancelled is worse than telling them nothing.
        - **`tickets_available > 0`.** The denormal `ticketing` keeps current.
          It is a DISPLAY figure and this is a display decision — the actual
          purchase is still decided under the tier's row lock, so a stale
          positive here costs a hopeful click, never a bad sale.
        - **Somebody pending**, or there is nothing to do.
        - **Nobody notified recently.** THE COOLDOWN, and the reason this is a
          `NOT EXISTS` rather than an aggregate per candidate: without it a
          single freed seat notifies a fresh batch on every tick, and an
          hour-long queue is burned through in minutes — everybody told
          "tickets are available" about a seat that was taken before they
          finished reading. The batch that was told gets a real chance first.

        Soonest event first: waiting costs most where there is least time left.
        """
        pending = EventWaitlist.objects.filter(event_id=OuterRef("pk"), notified_at__isnull=True)
        recent = EventWaitlist.objects.filter(
            event_id=OuterRef("pk"), notified_at__gt=cooldown_before
        )
        return list(
            Event.objects.filter(
                status=EventStatus.LIVE,
                deleted_at__isnull=True,
                starts_at__gt=now,
                tickets_available__gt=0,
            )
            .filter(Exists(pending))
            .exclude(Exists(recent))
            .order_by("starts_at")
            .values_list("id", flat=True)[:limit]
        )

    def pending_for_event(self, *, event_id: uuid.UUID | str, limit: int) -> list[EventWaitlist]:
        """The next `limit` people waiting, oldest first — the queue order.

        `select_related("user")` because the very next thing the caller does is
        read `user.email` for every row; without it a batch of thirty is
        thirty-one queries on a scheduled job.
        """
        return list(
            EventWaitlist.objects.filter(event_id=event_id, notified_at__isnull=True)
            .select_related("user")
            .only("id", "event_id", "created_at", "user__id", "user__email", "user__full_name")
            # ── `id` IS NOT DECORATION, IT IS THE TIEBREAK ──────────────
            #
            # `created_at` is not unique. Several people joining inside the
            # same clock tick — which is what an on-sale looks like — sort
            # arbitrarily under `created_at` alone, and Postgres is free to
            # return them in a DIFFERENT arbitrary order on the next query.
            # A queue whose order changes between reads is not a queue, and
            # this codebase has the same rule written on every cursor-paginated
            # list for the same reason (see `OrganizerReviewPagination`).
            #
            # It was caught by a test that asserted the first six people told
            # were the first six who joined, and got 0, 2, 1 instead.
            .order_by("created_at", "id")[:limit]
        )

    def mark_notified(self, entry_id: uuid.UUID | str, *, when) -> bool:
        """Conditional on it still being un-notified, so two sweeps racing the
        same row cannot overwrite the first one's timestamp — and the count of
        rows this run actually claimed stays honest."""
        return (
            EventWaitlist.objects.filter(pk=entry_id, notified_at__isnull=True).update(
                notified_at=when
            )
            == 1
        )
