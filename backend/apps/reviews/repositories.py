"""The only place review ORM queries live."""

from __future__ import annotations

import uuid
from typing import Any

from django.db.models import Count, QuerySet

from core.base_repository import BaseRepository

from .models import EventReview, ReviewStatus

#: What a review card needs and nothing else. `user__full_name` rather than the
#: user row: the public list must never carry an email address, and `.only()`
#: is what stops a serializer lazily fetching one.
_LIST_FIELDS = (
    "id",
    "rating",
    "body",
    "verified_attendee",
    "created_at",
    "updated_at",
    "status",
    "event_id",
    "user_id",
    "user__full_name",
)


class ReviewRepository(BaseRepository[EventReview]):
    model = EventReview

    def _published(self, event_id: uuid.UUID | str) -> QuerySet[EventReview]:
        return (
            EventReview.objects.filter(event_id=event_id, status=ReviewStatus.PUBLISHED)
            .select_related("user")
            .only(*_LIST_FIELDS)
        )

    def list_published(self, event_id: uuid.UUID | str) -> QuerySet[EventReview]:
        """The public list, newest first — matching `review_event_recent_idx`.

        Ordering is `-created_at, -id`: `created_at` alone is not unique, and a
        cursor paginator over a non-unique key silently repeats or skips rows at
        a page boundary. The same tiebreak the booking ticket list needed.
        """
        return self._published(event_id).order_by("-created_at", "-id")

    def get_for_user(
        self, *, event_id: uuid.UUID | str, user_id: uuid.UUID | str
    ) -> EventReview | None:
        """This person's review of this event, whatever its status.

        Hidden ones are included on purpose: the answer to "have you reviewed
        this?" is yes even if an operator removed it, and returning None would
        invite them to write it again.
        """
        return (
            EventReview.objects.filter(event_id=event_id, user_id=user_id)
            .select_related("user")
            .first()
        )

    def reviewed_event_ids(
        self, *, user_id: uuid.UUID | str, event_ids: list[uuid.UUID | str]
    ) -> set[str]:
        """Which of these events this person has already reviewed.

        ONE query for the whole candidate set. The pending-review endpoint
        checks up to a page of bookings; asking per booking is the N+1 that
        makes a prompt endpoint the slowest call on app open.
        """
        if not event_ids:
            return set()
        rows = EventReview.objects.filter(user_id=user_id, event_id__in=event_ids).values_list(
            "event_id", flat=True
        )
        return {str(value) for value in rows}

    def distribution(self, event_id: uuid.UUID | str) -> dict[int, int]:
        """How many published reviews sit at each star, computed in Postgres.

        A `GROUP BY rating` over `review_event_rating_idx`, not a Python
        `Counter` over every review row — counting 5,000 reviews in a list
        comprehension is how the event page becomes the slowest on the
        platform, which is the rule `console` states for every aggregate.
        """
        rows = (
            EventReview.objects.filter(event_id=event_id, status=ReviewStatus.PUBLISHED)
            .values("rating")
            .annotate(total=Count("id"))
        )
        return {int(row["rating"]): int(row["total"]) for row in rows}

    def create(self, **fields: Any) -> EventReview:
        return EventReview.objects.create(**fields)

    def get(self, review_id: uuid.UUID | str) -> EventReview | None:
        return EventReview.objects.filter(id=review_id).select_related("user", "event").first()

    def set_status(self, *, review_id: uuid.UUID | str, status: str) -> int:
        """Conditional: only changes rows NOT already in that status.

        The return value is what tells the caller whether the counters need
        adjusting. An unconditional UPDATE would report success for a no-op and
        the aggregate would drift by one every time an operator pressed Hide
        twice.
        """
        return EventReview.objects.filter(id=review_id).exclude(status=status).update(status=status)

    def list_for_moderation(self, *, status: str | None = None) -> QuerySet[EventReview]:
        """The operator queue. Newest first, and NOT restricted to published —
        the point of it is seeing what was hidden as well as what is live."""
        rows = EventReview.objects.select_related("user", "event").only(
            *_LIST_FIELDS, "event__title"
        )
        if status in {ReviewStatus.PUBLISHED, ReviewStatus.HIDDEN}:
            rows = rows.filter(status=status)
        return rows.order_by("-created_at", "-id")
