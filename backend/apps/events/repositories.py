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
from django.db.models import QuerySet
from django.utils import timezone

from core.base_repository import BaseRepository

from .models import Event, EventStatus

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
)

# Columns the fuller event *detail* needs.
_DETAIL_FIELDS = (
    "id",
    "organization_id",
    "organization__name",
    "title",
    "description",
    "venue",
    "city",
    "starts_at",
    "ends_at",
    "status",
    "poster_url",
    "from_price_minor",
    "tickets_available",
    "version",
    "created_at",
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
)

# Columns the publish/edit path loads: enough to run the publish checks and
# the ownership check, without the fat text/tsvector columns.
_WRITE_LOAD_FIELDS = (
    "id",
    "organization_id",
    "organization__owner_id",
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
        starts_after=None,
        starts_before=None,
    ) -> QuerySet[Event]:
        """Upcoming, published events (soonest first) for the public browse /
        search surface. All filters are index-backed:
        - status + starts_at range -> event_status_starts_idx (or the
          city-pinned event_status_city_starts_idx when `city` is given);
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

    def publish_if_draft(self, *, event_id: uuid.UUID | str, expected_version: int) -> bool:
        """Transition draft -> live under the same optimistic-lock guard."""
        updated = (
            self.get_queryset()
            .filter(
                pk=event_id,
                version=expected_version,
                status=EventStatus.DRAFT,
                deleted_at__isnull=True,
            )
            .update(
                status=EventStatus.LIVE,
                version=expected_version + 1,
                updated_at=timezone.now(),
            )
        )
        return updated == 1
