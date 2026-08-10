"""Business rules for support queries: who may see one, and who may answer it.

Two rules carry this module, and both are about ACCESS rather than workflow:

1. **A customer sees their own threads and nothing else.** Support is where
   people describe payment problems and gate refusals, in their own words, with
   their name attached.
2. **An organiser sees only queries about THEIR events, and only those
   addressed to them.** A query routed to the platform is one somebody chose
   not to send to the venue; surfacing it anyway would break the promise the
   audience field makes.

Everything else — status transitions, the reply thread — follows from those.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from django.db import transaction

from core.errors import InvalidInputError, NotFoundError, PermissionDeniedError
from core.unit_of_work import UnitOfWork

from .models import SupportAudience, SupportQuery, SupportStatus
from .repositories import SupportRepository

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Viewer:
    """Who is asking, and what that entitles them to see.

    Passed in rather than looked up here: the view already has the request's
    user, and a service that re-resolves identity is a second place for an
    authorization rule to live.
    """

    user_id: uuid.UUID | str
    is_staff: bool
    #: Organizations this viewer owns. Empty for an ordinary customer.
    organization_ids: tuple[uuid.UUID | str, ...] = ()


class SupportService:
    def __init__(self, *, queries: SupportRepository) -> None:
        self._queries = queries

    # ── the customer's half ───────────────────────────────────────────────

    def raise_query(
        self,
        *,
        user_id: uuid.UUID | str,
        subject: str,
        body: str,
        audience: str,
        event_id: uuid.UUID | str | None = None,
        ticket_id: uuid.UUID | str | None = None,
    ) -> SupportQuery:
        """Ask for help.

        `audience` is narrowed to `platform` when there is no event to route
        to. A query addressed to "the organizer" with nothing identifying an
        organizer would sit in a queue nobody owns — which is exactly the
        failure this module replaced, reproduced inside it.
        """
        subject = subject.strip()
        body = body.strip()
        if not subject:
            raise InvalidInputError("A subject is required.", code="subject_required")
        if not body:
            raise InvalidInputError("Tell us what happened.", code="body_required")

        resolved = audience
        if not event_id and audience in (SupportAudience.ORGANIZER, SupportAudience.BOTH):
            resolved = SupportAudience.PLATFORM

        with UnitOfWork():
            query = self._queries.create(
                user_id=user_id,
                subject=subject,
                body=body,
                audience=resolved,
                event_id=event_id,
                ticket_id=ticket_id,
            )
        logger.info("support.query_raised", extra={"query_id": str(query.id)})
        return query

    # ── shared ────────────────────────────────────────────────────────────

    def get_for_viewer(self, *, query_id: uuid.UUID | str, viewer: Viewer) -> SupportQuery:
        query = self._queries.get(query_id)
        if query is None:
            raise NotFoundError("That support query does not exist.", code="query_not_found")
        if not self._can_view(query, viewer):
            # NotFound rather than PermissionDenied: telling somebody a query
            # exists but is not theirs is itself a disclosure — it confirms an
            # id that was guessed.
            raise NotFoundError("That support query does not exist.", code="query_not_found")
        return query

    def reply(self, *, query_id: uuid.UUID | str, viewer: Viewer, body: str) -> SupportQuery:
        body = body.strip()
        if not body:
            raise InvalidInputError("A reply cannot be empty.", code="body_required")

        query = self.get_for_viewer(query_id=query_id, viewer=viewer)
        if query.status == SupportStatus.CLOSED:
            raise InvalidInputError(
                "This query is closed. Raise a new one and we will pick it up.",
                code="query_closed",
            )

        answering = self._answers_on_behalf(query, viewer)
        with transaction.atomic():
            self._queries.add_reply(
                query_id=query.id,
                author_id=viewer.user_id,
                body=body,
                is_staff_reply=answering,
            )
            # Only a reply from the OTHER side moves the state. A customer
            # adding detail to their own open query has not answered it.
            if answering:
                self._queries.mark_answered(query_id=query.id)

        refreshed = self._queries.get(query.id)
        assert refreshed is not None  # noqa: S101 - just written in this transaction
        return refreshed

    def set_status(self, *, query_id: uuid.UUID | str, viewer: Viewer, status: str) -> SupportQuery:
        """Resolve, reopen or close.

        `answered` is deliberately NOT settable: it means "somebody replied",
        and a value that can be set without replying is one that will be.
        """
        if status == SupportStatus.ANSWERED:
            raise InvalidInputError(
                "Answered is set by replying, not by hand.",
                code="status_not_settable",
            )
        if status not in SupportStatus.values:
            raise InvalidInputError("Unknown status.", code="status_unknown")

        query = self.get_for_viewer(query_id=query_id, viewer=viewer)
        # The asker may close or reopen their own thread; only the side that
        # answers may mark it resolved.
        if status == SupportStatus.RESOLVED and not self._answers_on_behalf(query, viewer):
            raise PermissionDeniedError(
                "Only the organizer or support can resolve a query.",
                code="resolve_not_allowed",
            )
        self._queries.set_status(query_id=query.id, status=status)
        refreshed = self._queries.get(query.id)
        assert refreshed is not None  # noqa: S101
        return refreshed

    # ── access rules, in one place ────────────────────────────────────────

    def _can_view(self, query: SupportQuery, viewer: Viewer) -> bool:
        if str(query.user_id) == str(viewer.user_id):
            return True
        if viewer.is_staff:
            return query.audience in (SupportAudience.PLATFORM, SupportAudience.BOTH)
        return self._is_owning_organizer(query, viewer)

    def _is_owning_organizer(self, query: SupportQuery, viewer: Viewer) -> bool:
        if query.event_id is None or query.event is None:
            return False
        if query.audience not in (SupportAudience.ORGANIZER, SupportAudience.BOTH):
            return False
        owned = {str(value) for value in viewer.organization_ids}
        return str(query.event.organization_id) in owned

    def _answers_on_behalf(self, query: SupportQuery, viewer: Viewer) -> bool:
        """Is this reply coming from the support side rather than the asker?

        Checked in this order on purpose: an operator who is ALSO the person
        who asked is replying as themselves, not as support.
        """
        if str(query.user_id) == str(viewer.user_id):
            return False
        return viewer.is_staff or self._is_owning_organizer(query, viewer)
