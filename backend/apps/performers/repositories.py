"""ORM access for the marketplace — the only file here that touches the ORM.

Shaped like `events`' repository, because it is the same kind of surface: a
public read path that will be hot, plus an owner-scoped write path.

- `.only(...)` on every read, with two field sets (card and detail) rather
  than one serialized model.
- `select_related("organization")` wherever the organisation's name or
  verification level is rendered, so a card never N+1s on it.
- Public visibility (`status=live`, not deleted) is enforced in the QUERYSET,
  never in a view — a filter somebody has to remember to add is a filter that
  eventually gets forgotten.
"""

from __future__ import annotations

import uuid

from django.contrib.postgres.search import SearchQuery
from django.db.models import Q, QuerySet
from django.utils import timezone

from core.base_repository import BaseRepository

from .models import (
    BookingRequest,
    Performer,
    PerformerMedia,
    PerformerStatus,
    Quote,
    QuoteStatus,
    RequestStatus,
)

#: The marketplace card. Deliberately tiny — this is the highest-volume payload.
_CARD_FIELDS = (
    "id",
    "stage_name",
    "performer_type",
    "tagline",
    "city",
    "travel_radius_km",
    "base_price_minor",
    "genres",
    "languages",
    "experience_years",
    "is_featured",
    "status",
    "organization_id",
    "organization__name",
    "organization__verified_level",
)

#: The profile page.
_DETAIL_FIELDS = (
    *_CARD_FIELDS,
    "bio",
    "occasions",
    "typical_set_minutes",
    "website_url",
    "instagram_url",
    "youtube_url",
    "version",
    "created_at",
)

#: The owner's own list — includes drafts and the moderation note.
_OWNER_FIELDS = (
    *_DETAIL_FIELDS,
    "submitted_at",
    "moderated_at",
    "moderation_note",
)


class PerformerRepository(BaseRepository[Performer]):
    model = Performer

    # --- reads: public -----------------------------------------------------

    def get_published_by_id(self, performer_id: uuid.UUID | str) -> Performer | None:
        return (
            self.get_queryset()
            .select_related("organization")
            .filter(pk=performer_id, status=PerformerStatus.LIVE, deleted_at__isnull=True)
            .only(*_DETAIL_FIELDS)
            .first()
        )

    def list_published(
        self,
        *,
        search: str | None = None,
        performer_type: str | None = None,
        city: str | None = None,
        budget_max_minor: int | None = None,
        language: str | None = None,
        genre: str | None = None,
        occasion: str | None = None,
        min_experience: int | None = None,
        verified_only: bool = False,
        featured_only: bool = False,
    ) -> QuerySet[Performer]:
        """The marketplace browse.

        Every filter here is one an operator or a customer can actually act on.
        There is deliberately NO minimum-rating filter: nothing on this
        platform stores a review, so it would filter on a number that does not
        exist (BACKLOG "Performer reviews and ratings").
        """
        queryset = (
            self.get_queryset()
            .select_related("organization")
            .filter(status=PerformerStatus.LIVE, deleted_at__isnull=True)
        )

        if performer_type:
            queryset = queryset.filter(performer_type=performer_type)
        if city:
            queryset = queryset.filter(city__iexact=city)
        if budget_max_minor is not None:
            # An act with no listed price is INCLUDED rather than filtered out:
            # "price on ask" is a real answer, and hiding those acts from every
            # budgeted search would quietly remove the expensive end of the
            # market from the marketplace.
            queryset = queryset.filter(
                Q(base_price_minor__isnull=True) | Q(base_price_minor__lte=budget_max_minor)
            )
        if language:
            queryset = queryset.filter(languages__contains=[language])
        if genre:
            queryset = queryset.filter(genres__contains=[genre])
        if occasion:
            queryset = queryset.filter(occasions__contains=[occasion])
        if min_experience:
            queryset = queryset.filter(experience_years__gte=min_experience)
        if verified_only:
            queryset = queryset.filter(organization__verified_level="verified")
        if featured_only:
            queryset = queryset.filter(is_featured=True)
        if search:
            # `websearch` never raises on arbitrary user input, unlike the
            # default tsquery parser — so no sanitising is needed here.
            queryset = queryset.filter(
                search_vector=SearchQuery(search, config="english", search_type="websearch")
            )

        # Featured first, then newest. Both are in the index the browse uses.
        return queryset.only(*_CARD_FIELDS).order_by("-is_featured", "-created_at", "id")

    # --- reads: owner ------------------------------------------------------

    def list_by_owner(self, owner_id: uuid.UUID | str) -> QuerySet[Performer]:
        return (
            self.get_queryset()
            .select_related("organization")
            .filter(organization__owner_id=owner_id, deleted_at__isnull=True)  # type: ignore[misc]
            .only(*_OWNER_FIELDS)
            .order_by("-created_at", "id")
        )

    def get_active_for_write(self, performer_id: uuid.UUID | str) -> Performer | None:
        return (
            self.get_queryset()
            .select_related("organization")
            .filter(pk=performer_id, deleted_at__isnull=True)
            .only(
                "id",
                "organization_id",
                "organization__owner_id",
                "stage_name",
                "status",
                "version",
            )
            .first()
        )

    def get_active_by_id(self, performer_id: uuid.UUID | str) -> Performer | None:
        return (
            self.get_queryset()
            .select_related("organization")
            .filter(pk=performer_id, deleted_at__isnull=True)
            .only(*_OWNER_FIELDS)
            .first()
        )

    # --- reads: moderation -------------------------------------------------

    #: What the console may ask for. `draft` is absent on purpose — an
    #: unsubmitted profile is the owner's private workspace.
    MODERATABLE_STATUSES = (
        PerformerStatus.PENDING_REVIEW,
        PerformerStatus.LIVE,
        PerformerStatus.REJECTED,
        PerformerStatus.ARCHIVED,
    )

    def list_for_moderation(self, *, status: str | None = None) -> QuerySet[Performer]:
        chosen = status if status in set(self.MODERATABLE_STATUSES) else None
        queryset = (
            self.get_queryset()
            .select_related("organization")
            .filter(status=chosen or PerformerStatus.PENDING_REVIEW, deleted_at__isnull=True)
            .only(*_OWNER_FIELDS)
        )
        if chosen is None or chosen == PerformerStatus.PENDING_REVIEW:
            # FIFO: the act that has waited longest is reviewed first.
            return queryset.order_by("submitted_at")
        # `-created_at` rather than `-moderated_at`: the console cursor-
        # paginates this, and a cursor needs a non-null monotonic column.
        return queryset.order_by("-created_at")

    # --- writes ------------------------------------------------------------

    def create(self, **fields) -> Performer:
        return Performer.objects.create(**fields)

    def update_if_version_matches(
        self, *, performer_id: uuid.UUID | str, expected_version: int, changes: dict
    ) -> bool:
        """One conditional UPDATE, so two editors cannot clobber each other.

        The tsvector trigger recomputes `search_vector` automatically whenever
        this touches a source column (see the migration), so search stays
        consistent with zero application code.
        """
        updated = (
            self.get_queryset()
            .filter(pk=performer_id, version=expected_version, deleted_at__isnull=True)
            .update(version=expected_version + 1, updated_at=timezone.now(), **changes)
        )
        return updated == 1

    def submit_for_review(self, *, performer_id: uuid.UUID | str, expected_version: int) -> bool:
        """draft | rejected -> pending_review.

        `moderation_note` is CLEARED on resubmission: the note describes the
        last decision, and leaving a stale rejection on a profile now awaiting
        a fresh review is how an operator rejects it twice for a problem that
        was already fixed.
        """
        updated = (
            self.get_queryset()
            .filter(
                pk=performer_id,
                version=expected_version,
                status__in=(PerformerStatus.DRAFT, PerformerStatus.REJECTED),
                deleted_at__isnull=True,
            )
            .update(
                status=PerformerStatus.PENDING_REVIEW,
                submitted_at=timezone.now(),
                moderation_note="",
                version=expected_version + 1,
                updated_at=timezone.now(),
            )
        )
        return updated == 1

    def moderate_if_pending(
        self,
        *,
        performer_id: uuid.UUID | str,
        approve: bool,
        actor_id: uuid.UUID | str,
        note: str,
    ) -> bool:
        """pending_review -> live | rejected.

        Conditional on the CURRENT STATUS rather than on a version, and that
        difference is deliberate: an operator is answering a question about a
        queue entry, not editing content they read a moment ago. What must not
        happen is two operators deciding the same profile, and the
        `status=PENDING_REVIEW` predicate is exactly that guard.
        """
        from django.db.models import F

        updated = (
            self.get_queryset()
            .filter(pk=performer_id, status=PerformerStatus.PENDING_REVIEW, deleted_at__isnull=True)
            .update(
                status=PerformerStatus.LIVE if approve else PerformerStatus.REJECTED,
                moderation_note=note,
                moderated_at=timezone.now(),
                moderated_by_id=actor_id,
                version=F("version") + 1,
                updated_at=timezone.now(),
            )
        )
        return updated == 1

    def set_featured(self, *, performer_id: uuid.UUID | str, featured: bool) -> bool:
        """An editorial pick. Only a LIVE profile can be featured — featuring a
        draft would put it on the landing page while it is invisible
        everywhere else."""
        from django.db.models import F

        updated = (
            self.get_queryset()
            .filter(pk=performer_id, status=PerformerStatus.LIVE, deleted_at__isnull=True)
            .exclude(is_featured=featured)
            .update(is_featured=featured, version=F("version") + 1, updated_at=timezone.now())
        )
        return updated == 1

    def set_status(self, *, performer_id: uuid.UUID | str, status: str, sources: tuple) -> bool:
        from django.db.models import F

        updated = (
            self.get_queryset()
            .filter(pk=performer_id, status__in=sources, deleted_at__isnull=True)
            .update(status=status, version=F("version") + 1, updated_at=timezone.now())
        )
        return updated == 1


class PerformerMediaRepository:
    """Photos. Same shape as `EventContentRepository`'s media half."""

    #: Ten photos is a portfolio; a hundred is a dump nobody scrolls.
    MAX_PHOTOS = 12

    def media_for(self, performer_id: uuid.UUID | str) -> QuerySet[PerformerMedia]:
        return (
            PerformerMedia.objects.filter(
                performer_id=performer_id, deleted_at__isnull=True, is_visible=True
            )
            .only("id", "url", "alt_text", "caption", "position")
            .order_by("position", "created_at")
        )

    def count_media(self, performer_id: uuid.UUID | str) -> int:
        return PerformerMedia.objects.filter(
            performer_id=performer_id, deleted_at__isnull=True
        ).count()

    def add_media(self, **fields) -> PerformerMedia:
        return PerformerMedia.objects.create(**fields)

    def soft_delete_media(
        self, *, performer_id: uuid.UUID | str, media_id: uuid.UUID | str
    ) -> bool:
        updated = PerformerMedia.objects.filter(
            pk=media_id, performer_id=performer_id, deleted_at__isnull=True
        ).update(deleted_at=timezone.now())
        return updated == 1

    def all_media_for_many(self, performer_ids: list) -> dict:
        """EVERY photo, grouped by performer, in ONE query.

        The owner's studio shows the whole gallery rather than just a cover, so
        it needs all of them — but still without a query per row.
        """
        rows = (
            PerformerMedia.objects.filter(
                performer_id__in=performer_ids, deleted_at__isnull=True, is_visible=True
            )
            .only("id", "performer_id", "url", "alt_text", "caption", "position")
            .order_by("performer_id", "position", "created_at")
        )
        grouped: dict = {}
        for row in rows:
            grouped.setdefault(row.performer_id, []).append(row)
        return grouped

    def media_for_many(self, performer_ids: list) -> dict:
        """First photo per performer, for the card grid — ONE query rather than
        one per card."""
        rows = (
            PerformerMedia.objects.filter(
                performer_id__in=performer_ids, deleted_at__isnull=True, is_visible=True
            )
            .only("performer_id", "url", "alt_text", "position")
            .order_by("performer_id", "position", "created_at")
        )
        first: dict = {}
        for row in rows:
            first.setdefault(row.performer_id, row)
        return first


class BookingRequestRepository:
    def create(self, **fields) -> BookingRequest:
        return BookingRequest.objects.create(**fields)

    def get_by_id(self, request_id: uuid.UUID | str) -> BookingRequest | None:
        return BookingRequest.objects.filter(pk=request_id).first()

    def list_for_customer(self, customer_id: uuid.UUID) -> QuerySet[BookingRequest]:
        return (
            BookingRequest.objects.filter(customer_id=customer_id)
            .select_related("booked_performer")
            .order_by("-created_at")
        )

    def list_open_for_performer(self, performer: Performer) -> QuerySet[BookingRequest]:
        """The performer's feed: open briefs they can actually serve.

        Matched on TYPE and CITY, and on budget — a brief whose ceiling is
        below the act's floor is not a lead, it is noise. `travel_radius_km` is
        deliberately NOT used here: matching a radius needs coordinates, and
        `city` is a plain string on both sides (BACKLOG "Geocoded cities").
        """
        queryset = BookingRequest.objects.filter(
            status=RequestStatus.OPEN,
            performer_type=performer.performer_type,
            city__iexact=performer.city,
            event_date__gte=timezone.now().date(),
        )
        if performer.base_price_minor is not None:
            queryset = queryset.filter(budget_max_minor__gte=performer.base_price_minor)
        return queryset.order_by("event_date", "-created_at")

    def close_with_booking(
        self, *, request_id: uuid.UUID | str, performer_id: uuid.UUID | str
    ) -> bool:
        """open -> booked, conditional on still being open.

        The predicate is the race guard: two customers cannot accept two quotes
        on one request, and a second accept matches zero rows rather than
        overwriting the first winner.
        """
        updated = BookingRequest.objects.filter(pk=request_id, status=RequestStatus.OPEN).update(
            status=RequestStatus.BOOKED,
            booked_performer_id=performer_id,
            updated_at=timezone.now(),
        )
        return updated == 1

    def cancel(self, *, request_id: uuid.UUID, customer_id: uuid.UUID) -> bool:
        updated = BookingRequest.objects.filter(
            pk=request_id, customer_id=customer_id, status=RequestStatus.OPEN
        ).update(status=RequestStatus.CANCELLED, updated_at=timezone.now())
        return updated == 1


class QuoteRepository:
    def create(self, **fields) -> Quote:
        return Quote.objects.create(**fields)

    def get_by_id(self, quote_id: uuid.UUID | str) -> Quote | None:
        return (
            Quote.objects.select_related("request", "performer", "performer__organization")
            .filter(pk=quote_id)
            .first()
        )

    def list_for_request(self, request_id: uuid.UUID) -> QuerySet[Quote]:
        return (
            Quote.objects.filter(request_id=request_id)
            .select_related("performer", "performer__organization")
            .only(
                "id",
                "amount_minor",
                "message",
                "status",
                "created_at",
                "request_id",
                "performer__id",
                "performer__stage_name",
                "performer__performer_type",
                "performer__city",
                "performer__experience_years",
                "performer__organization__name",
                "performer__organization__verified_level",
            )
            # Cheapest first. A customer comparing quotes is comparing price,
            # and the alternative (newest first) makes them scroll to compare.
            .order_by("amount_minor", "created_at")
        )

    def list_for_performer(self, performer_id: uuid.UUID | str) -> QuerySet[Quote]:
        return (
            Quote.objects.filter(performer_id=performer_id)
            .select_related("request")
            .order_by("-created_at")
        )

    def accept(self, *, quote_id: uuid.UUID | str) -> bool:
        updated = Quote.objects.filter(pk=quote_id, status=QuoteStatus.PENDING).update(
            status=QuoteStatus.ACCEPTED, updated_at=timezone.now()
        )
        return updated == 1

    def decline_others(self, *, request_id: uuid.UUID, winner_id: uuid.UUID) -> int:
        """Every other pending quote on the request, in one UPDATE.

        Declining them is not housekeeping — a performer whose quote sits
        "pending" forever cannot tell a lost bid from a slow customer, and
        will hold the date for nothing.
        """
        return (
            Quote.objects.filter(request_id=request_id, status=QuoteStatus.PENDING)
            .exclude(pk=winner_id)
            .update(status=QuoteStatus.DECLINED, updated_at=timezone.now())
        )

    def withdraw(self, *, quote_id: uuid.UUID | str) -> bool:
        updated = Quote.objects.filter(pk=quote_id, status=QuoteStatus.PENDING).update(
            status=QuoteStatus.WITHDRAWN, updated_at=timezone.now()
        )
        return updated == 1

    def count_for_requests(self, request_ids: list) -> dict:
        """Quote counts per request, in ONE grouped query rather than per row."""
        from django.db.models import Count

        rows = (
            Quote.objects.filter(request_id__in=request_ids)
            .values("request_id")
            .annotate(total=Count("id"))
        )
        return {row["request_id"]: int(row["total"]) for row in rows}
