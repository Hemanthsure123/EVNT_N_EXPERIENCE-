"""ORM access for support queries. The only place in this module with queries."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from django.db.models import QuerySet

from .models import SupportAudience, SupportQuery, SupportReply, SupportStatus

#: Every list read pulls exactly these columns, and the joins the serializer
#: needs. Named once so the three queues cannot drift into three shapes — and
#: so adding a field to the response is one edit rather than a silent extra
#: query per row when a serializer touches something deferred.
_LIST_FIELDS = (
    "id",
    "audience",
    "status",
    "subject",
    "body",
    "created_at",
    "updated_at",
    "user__id",
    "user__full_name",
    "user__email",
    "event__id",
    "event__title",
    "event__organization_id",
    "ticket__id",
)


class SupportRepository:
    def _base(self) -> QuerySet[SupportQuery]:
        # `select_related` on both FKs: every row's serializer reads the event
        # title and the asker's name, and without this a page of 20 is 41
        # queries.
        return SupportQuery.objects.select_related("user", "event", "ticket").only(*_LIST_FIELDS)

    # ── writes ────────────────────────────────────────────────────────────

    def create(
        self,
        *,
        user_id: uuid.UUID | str,
        subject: str,
        body: str,
        audience: str,
        event_id: uuid.UUID | str | None,
        ticket_id: uuid.UUID | str | None,
    ) -> SupportQuery:
        return SupportQuery.objects.create(
            user_id=user_id,
            subject=subject,
            body=body,
            audience=audience,
            event_id=event_id,
            ticket_id=ticket_id,
        )

    def add_reply(
        self,
        *,
        query_id: uuid.UUID | str,
        author_id: uuid.UUID | str,
        body: str,
        is_staff_reply: bool,
    ) -> SupportReply:
        return SupportReply.objects.create(
            query_id=query_id,
            author_id=author_id,
            body=body,
            is_staff_reply=is_staff_reply,
        )

    def set_status(self, *, query_id: uuid.UUID | str, status: str) -> int:
        """Conditional UPDATE, and it returns the row count on purpose.

        A caller that needs to know whether it actually changed anything —
        "did I close this, or had somebody already?" — reads the count rather
        than re-fetching and comparing.
        """
        return SupportQuery.objects.filter(id=query_id).exclude(status=status).update(status=status)

    def mark_answered(self, *, query_id: uuid.UUID | str) -> int:
        """`open` -> `answered`, and ONLY from `open`.

        A reply on a query somebody already resolved must not drag it back to
        `answered`: the state means "a reply is waiting for the customer", and
        a resolved thread has no such wait. Expressed as a predicate on the
        UPDATE rather than a read-then-write, so two replies landing together
        cannot both decide they were first.
        """
        return SupportQuery.objects.filter(id=query_id, status=SupportStatus.OPEN).update(
            status=SupportStatus.ANSWERED
        )

    # ── reads ─────────────────────────────────────────────────────────────

    def get(self, query_id: uuid.UUID | str) -> SupportQuery | None:
        return self._base().filter(id=query_id).first()

    def list_for_user(self, *, user_id: uuid.UUID | str) -> QuerySet[SupportQuery]:
        return self._base().filter(user_id=user_id)

    def list_for_organizations(
        self, *, organization_ids: Sequence[uuid.UUID | str], status: str | None
    ) -> QuerySet[SupportQuery]:
        """An organiser's queue.

        Scoped through `event__organization_id`, so a query with no event is
        correctly invisible here — there is no organiser it belongs to. And
        never `audience=platform`: a customer who addressed us specifically did
        not agree to have a venue read it.
        """
        rows = self._base().filter(
            event__organization_id__in=list(organization_ids),
            audience__in=[SupportAudience.ORGANIZER, SupportAudience.BOTH],
        )
        return rows.filter(status=status) if status else rows

    def list_for_platform(self, *, status: str | None) -> QuerySet[SupportQuery]:
        """The operator queue. Everything addressed to us, or to both."""
        rows = self._base().filter(audience__in=[SupportAudience.PLATFORM, SupportAudience.BOTH])
        return rows.filter(status=status) if status else rows

    def replies_for(self, *, query_id: uuid.UUID | str) -> QuerySet[SupportReply]:
        return (
            SupportReply.objects.filter(query__id=query_id)
            .select_related("author")
            .only("id", "body", "created_at", "is_staff_reply", "author__full_name", "query_id")
        )
