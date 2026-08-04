"""Business rules for events: create a draft, edit it (optimistic-locked),
and publish it (draft -> live) behind an extensible readiness gate.

Performance rules from CLAUDE.md's checklist, applied here:
- Slow external I/O (the poster upload) happens OUTSIDE the UnitOfWork
  transaction, before it opens.
- Poster *processing* (resize/thumbnail) is handed to TaskQueuePort so the
  create/edit request returns immediately (see tasks.py).
- Edits use a single race-free conditional UPDATE (optimistic lock), not a
  read-modify-write, so concurrent editors can't clobber each other.
- Public caches are invalidated only when a change is actually publicly
  visible (a live event, or a publish), never for draft-only churn.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from django.core.files.uploadedfile import UploadedFile
from django.db import transaction

from apps.accounts.repositories import UserRepository
from apps.organizations.exceptions import OrganizationNotFoundError
from apps.organizations.models import VerifiedLevel
from apps.organizations.repositories import OrganizationRepository
from core.audit import record_audit
from core.errors import InvalidInputError
from core.events import (
    EVENT_APPROVED,
    EVENT_ARCHIVED,
    EVENT_CREATED,
    EVENT_PUBLISHED,
    EVENT_REJECTED,
    EVENT_SUBMITTED_FOR_REVIEW,
    EVENT_UPDATED,
)
from core.ports.storage_port import StoragePort
from core.ports.task_queue_port import TaskQueuePort
from core.unit_of_work import UnitOfWork

from .exceptions import (
    EventNotFoundError,
    EventNotLiveError,
    EventNotUnderReviewError,
    InvalidEventStateError,
    NotEventOwnerError,
    NotPlatformOperatorError,
    OrganizationNotVerifiedError,
    StaleEventVersionError,
)
from .models import Event, EventStatus, MediaKind
from .publish_checks import run_publish_checks
from .repositories import EventRepository
from .selectors import invalidate_event_caches

logger = logging.getLogger(__name__)

_POSTER_PROCESS_TASK = "events.process_poster"
# Fields a client may edit, mapped straight onto the model. Status is not
# here on purpose — lifecycle transitions go through publish()/(future)
# pause()/finish(), never a blind PATCH.
_EDITABLE_FIELDS = (
    "title",
    "description",
    "venue",
    "city",
    # Where the venue resolves to. Editable for the same reason the content
    # fields are: a column the event page renders must be reachable by a
    # PATCH, or the map is decoration nobody can ever populate. Written by
    # the organizer's venue picker when they choose a Places suggestion.
    "place_id",
    "latitude",
    "longitude",
    "starts_at",
    "ends_at",
    # Content fields — same PATCH, same optimistic lock, same cache
    # invalidation. They are editable rather than read-only because the
    # alternative is a column the event page renders that nobody can ever
    # fill in.
    "short_description",
    "duration_minutes",
    "language",
    "age_restriction",
    "accessibility_notes",
    "seo_title",
    "seo_description",
)


class EventService:
    def __init__(
        self,
        *,
        events: EventRepository,
        organizations: OrganizationRepository,
        users: UserRepository,
        storage: StoragePort,
        task_queue: TaskQueuePort,
    ) -> None:
        self._events = events
        self._organizations = organizations
        self._users = users
        self._storage = storage
        self._task_queue = task_queue

    # --- helpers -----------------------------------------------------------

    def _upload_poster(self, event_id: uuid.UUID | str, poster: UploadedFile) -> str:
        path = f"event-posters/{event_id}/{uuid.uuid4().hex}-{poster.name}"
        content_type = poster.content_type or "application/octet-stream"
        return self._storage.upload(path=path, content=poster.read(), content_type=content_type)

    def _load_owned_for_write(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        require_owner: bool = True,
    ) -> Event:
        """Load an event this actor may write to.

        `require_owner=False` is for a PLATFORM OPERATOR acting through
        `EventModerationService`, which proves staff for itself before calling
        in. It is a keyword-only argument with an owner-checking default so the
        skip can never happen by forgetting an argument — the caller has to
        name it, and only one caller does.
        """
        event = self._events.get_active_for_write(event_id)
        if event is None:
            raise EventNotFoundError(str(event_id))
        if require_owner and str(event.organization.owner_id) != str(actor_id):
            raise NotEventOwnerError()
        return event

    def _enqueue_poster_processing(self, event_id: uuid.UUID | str, poster_url: str) -> None:
        transaction.on_commit(
            lambda: self._task_queue.enqueue(
                _POSTER_PROCESS_TASK,
                {"event_id": str(event_id), "poster_url": poster_url},
            )
        )

    # --- commands ----------------------------------------------------------

    def create_event(
        self,
        *,
        organization_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        title: str,
        venue: str,
        city: str,
        starts_at: datetime,
        description: str = "",
        ends_at: datetime | None = None,
        poster: UploadedFile | None = None,
        place_id: str = "",
        latitude=None,
        longitude=None,
    ) -> Event:
        org = self._organizations.get_active_by_id(organization_id)
        if org is None:
            raise OrganizationNotFoundError(str(organization_id))
        if str(org.owner_id) != str(actor_id):
            raise NotEventOwnerError()

        event_id = uuid.uuid4()
        poster_url = self._upload_poster(event_id, poster) if poster is not None else ""

        with UnitOfWork() as uow:
            event = self._events.create(
                organization_id=org.id,
                title=title,
                venue=venue,
                city=city,
                starts_at=starts_at,
                description=description,
                ends_at=ends_at,
                poster_url=poster_url,
                place_id=place_id,
                latitude=latitude,
                longitude=longitude,
            )
            # We already hold the loaded org — attach it so serializing the
            # response doesn't lazy-load organization.name (an N+1).
            event.organization = org

            uow.publish(
                EVENT_CREATED,
                {
                    "event_id": str(event.id),
                    "organization_id": str(org.id),
                    "title": event.title,
                },
                aggregate_id=str(event.id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="event.created",
                target_type="event",
                target_id=str(event.id),
            )
            # A brand-new event is a draft — invisible to every public read —
            # so there's no public cache to invalidate here.
            if poster_url:
                self._enqueue_poster_processing(event.id, poster_url)

        logger.info("event_created", extra={"event_id": str(event.id)})
        return event

    def update_event(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        expected_version: int,
        changes: dict,
        poster: UploadedFile | None = None,
        require_owner: bool = True,
    ) -> Event:
        event = self._load_owned_for_write(
            event_id=event_id, actor_id=actor_id, require_owner=require_owner
        )

        applied_changes = {k: v for k, v in changes.items() if k in _EDITABLE_FIELDS}
        poster_url = self._upload_poster(event.id, poster) if poster is not None else None
        if poster_url is not None:
            applied_changes["poster_url"] = poster_url

        was_live = event.status == EventStatus.LIVE

        with UnitOfWork() as uow:
            applied = self._events.update_if_version_matches(
                event_id=event.id, expected_version=expected_version, changes=applied_changes
            )
            if not applied:
                # The row moved on (a concurrent edit) since the client's read.
                raise StaleEventVersionError()

            uow.publish(
                EVENT_UPDATED,
                {"event_id": str(event.id), "organization_id": str(event.organization_id)},
                aggregate_id=str(event.id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="event.updated",
                target_type="event",
                target_id=str(event.id),
            )
            # Only a live event is publicly cached; editing a draft touches no
            # public cache.
            if was_live:
                transaction.on_commit(lambda: invalidate_event_caches(event.id))
            if poster_url is not None:
                self._enqueue_poster_processing(event.id, poster_url)

        refreshed = self._events.get_active_by_id(event.id)
        if refreshed is None:  # pragma: no cover — just deleted mid-request
            raise EventNotFoundError(str(event_id))
        return refreshed

    def publish_event(self, *, event_id: uuid.UUID | str, actor_id: uuid.UUID | str) -> Event:
        """Submit a draft for platform review.

        **This no longer makes an event public.** An organizer publishes; a
        platform operator approves; only then is it `live`. That is the whole
        point of the moderation gate — a marketplace where anyone can put
        anything in front of buyers is one bad listing away from a refund
        wave, and the check cannot live on the organizer's side of the fence.
        The method keeps its name because `POST /events/{id}/publish` is what
        an organizer is doing; what CHANGED is the state it lands in.

        A rejected event may be resubmitted here — the readiness checks and
        the ownership check run again, so an organizer cannot fix a rejection
        by deleting a ticket type.

        **The organization must be VERIFIED.** This is the second half of the
        approval story and it lives HERE, in the service, because the frontend
        already renders an "awaiting approval" shell and a gate that only
        renders is not a gate — `POST /events/{id}/publish` is
        `IsAuthenticated`, so a direct API call would otherwise walk straight
        past it. It gates SUBMISSION and not create/edit on purpose: an
        organizer waiting on verification can build their event, they just
        cannot join the queue that ends in a public listing.
        """
        event = self._load_owned_for_write(event_id=event_id, actor_id=actor_id)

        # Read off the already-joined organization row — `_WRITE_LOAD_FIELDS`
        # includes `organization__verified_level` so this costs no query.
        if event.organization.verified_level != VerifiedLevel.VERIFIED:
            raise OrganizationNotVerifiedError(event.organization.verified_level)

        if event.status not in (EventStatus.DRAFT, EventStatus.REJECTED):
            raise InvalidEventStateError(
                f"Only draft or rejected events can be submitted (this one is '{event.status}').",
                status=str(event.status),
            )

        # Extensible readiness gate — core checks now, ticketing's "has a
        # ticket type" check later, all without editing this method.
        run_publish_checks(event)

        owner = self._users.get_by_id(event.organization.owner_id)

        with UnitOfWork() as uow:
            submitted = self._events.submit_for_review_if_draft(
                event_id=event.id, expected_version=event.version
            )
            if not submitted:
                # Version moved, or it is no longer draft/rejected — a
                # concurrent change.
                raise StaleEventVersionError()

            uow.publish(
                EVENT_SUBMITTED_FOR_REVIEW,
                {
                    "event_id": str(event.id),
                    "organization_id": str(event.organization_id),
                    "owner_email": owner.email if owner else "",
                    "title": event.title,
                },
                aggregate_id=str(event.id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="event.submitted_for_review",
                target_type="event",
                target_id=str(event.id),
            )
            # Still invalidated: an event moving OUT of live (a resubmitted
            # rejection) has to leave the public caches immediately.
            transaction.on_commit(lambda: invalidate_event_caches(event.id))

        logger.info("event_submitted_for_review", extra={"event_id": str(event.id)})
        refreshed = self._events.get_active_by_id(event.id)
        if refreshed is None:  # pragma: no cover — just deleted mid-request
            raise EventNotFoundError(str(event_id))
        return refreshed

    def archive_event(self, *, event_id: uuid.UUID | str, actor_id: uuid.UUID | str) -> Event:
        """Retire an event the organizer is finished with.

        A LIFECYCLE TRANSITION, not a `status` field a PATCH may set — the same
        reason `publish` is its own endpoint. `status` is deliberately absent
        from `UpdateEventRequestSerializer`, so this is the only way an event
        reaches `archived`, and the source-state rule lives in exactly one
        place (the repository's conditional UPDATE).

        There is NO delete counterpart, and there should not be: an event is
        referenced by bookings, tickets and a settlement, all `PROTECT`ed, so
        deleting one would either fail or orphan real money. Archive is the
        honest operation.
        """
        event = self._load_owned_for_write(event_id=event_id, actor_id=actor_id)

        if event.status not in (EventStatus.DRAFT, EventStatus.REJECTED, EventStatus.FINISHED):
            raise InvalidEventStateError(
                f"A '{event.status}' event cannot be archived. "
                "Take it off sale first, or wait for it to finish."
            )

        was_visible = event.status == EventStatus.LIVE

        with UnitOfWork() as uow:
            archived = self._events.archive_if_archivable(
                event_id=event.id, expected_version=event.version
            )
            if not archived:
                raise StaleEventVersionError()

            uow.publish(
                EVENT_ARCHIVED,
                {"event_id": str(event.id), "organization_id": str(event.organization_id)},
                aggregate_id=str(event.id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="event.archived",
                target_type="event",
                target_id=str(event.id),
            )
            if was_visible:  # pragma: no cover — guarded above, kept for safety
                transaction.on_commit(lambda: invalidate_event_caches(event.id))

        logger.info("event_archived", extra={"event_id": str(event.id)})
        refreshed = self._events.get_active_by_id(event.id)
        if refreshed is None:  # pragma: no cover — just deleted mid-request
            raise EventNotFoundError(str(event_id))
        return refreshed


class EventModerationService:
    """A platform operator's decisions on submitted events.

    Deliberately a SEPARATE service from `EventService`, for the same reason
    `organizations.decide_verification` is separate from `submit_verification`:
    every method on `EventService` begins by proving the caller owns the row,
    and every method here begins by proving they do not have to. Mixing the two
    in one class is how an ownership check eventually gets skipped on a write
    that needed it.

    The caller must be staff, and this service proves it for ITSELF rather
    than trusting the view. There is no row-level ownership question to ask —
    the question is only "is this a platform operator" — but approval is the
    ONLY path an event has to `live`, and a rule enforced solely by one
    permission class is one new caller (a management command, a task, a second
    view) away from being skipped. One extra lookup on an admin-volume
    endpoint is a cheap price for the transition that makes something public.
    """

    def __init__(self, *, events: EventRepository, users) -> None:
        self._events = events
        self._users = users

    def _require_operator(self, actor_id: uuid.UUID | str):
        actor = self._users.get_by_id(actor_id)
        if actor is None or not actor.is_staff or not actor.is_active:
            raise NotPlatformOperatorError()
        return actor

    def moderate(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        approve: bool,
        note: str = "",
    ) -> Event:
        """Approve or reject an event awaiting review.

        Approval is the ONLY path to `live`. The decision is a conditional
        `UPDATE ... WHERE status = 'pending_review'`, so two operators clicking
        Approve on the same queue entry cannot both succeed — the second is
        told the decision was already made rather than silently re-approving.
        """
        self._require_operator(actor_id)

        event = self._events.get_active_by_id(event_id)
        if event is None:
            raise EventNotFoundError(str(event_id))
        if event.status != EventStatus.PENDING_REVIEW:
            raise EventNotUnderReviewError()
        if not approve and not note.strip():
            # A rejection an organizer cannot act on is a support ticket.
            raise InvalidInputError("A rejection needs a reason the organizer can act on.")

        owner = self._users.get_by_id(event.organization.owner_id)

        with UnitOfWork() as uow:
            decided = self._events.moderate_if_pending(
                event_id=event.id, approve=approve, actor_id=actor_id, note=note
            )
            if not decided:
                raise EventNotUnderReviewError()

            payload = {
                "event_id": str(event.id),
                "organization_id": str(event.organization_id),
                "owner_email": owner.email if owner else "",
                "title": event.title,
                "note": note,
            }
            uow.publish(
                EVENT_APPROVED if approve else EVENT_REJECTED, payload, aggregate_id=str(event.id)
            )
            if approve:
                # The event is public from this moment, so the event the rest
                # of the platform already listens for is emitted HERE, not at
                # submission. `notifications` schedules its reminder off this,
                # and scheduling a reminder for an event that was then
                # rejected would be a message to ticket holders who do not
                # exist.
                uow.publish(EVENT_PUBLISHED, payload, aggregate_id=str(event.id))

            record_audit(
                actor_id=str(actor_id),
                action="event.approved" if approve else "event.rejected",
                target_type="event",
                target_id=str(event.id),
                metadata={"note": note},
            )
            transaction.on_commit(lambda: invalidate_event_caches(event.id))

        logger.info(
            "event_moderated",
            extra={"event_id": str(event.id), "approved": approve},
        )
        refreshed = self._events.get_active_by_id(event.id)
        if refreshed is None:  # pragma: no cover — deleted mid-request
            raise EventNotFoundError(str(event_id))
        return refreshed

    def unpublish(
        self, *, event_id: uuid.UUID | str, actor_id: uuid.UUID | str, note: str
    ) -> Event:
        """Take a live event back off sale, with a reason.

        The tickets already sold are untouched — this hides the listing, it
        does not cancel anybody's booking. Refunding is `payments`' job and is
        a separate, deliberate decision.
        """
        self._require_operator(actor_id)

        if not note.strip():
            raise InvalidInputError("Taking an event down needs a reason.")

        event = self._events.get_active_by_id(event_id)
        if event is None:
            raise EventNotFoundError(str(event_id))
        if event.status != EventStatus.LIVE:
            raise EventNotLiveError()

        with UnitOfWork() as uow:
            if not self._events.unpublish(event_id=event.id, actor_id=actor_id, note=note):
                raise EventNotLiveError()
            uow.publish(
                EVENT_REJECTED,
                {
                    "event_id": str(event.id),
                    "organization_id": str(event.organization_id),
                    "title": event.title,
                    "note": note,
                },
                aggregate_id=str(event.id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="event.unpublished",
                target_type="event",
                target_id=str(event.id),
                metadata={"note": note},
            )
            transaction.on_commit(lambda: invalidate_event_caches(event.id))

        refreshed = self._events.get_active_by_id(event.id)
        if refreshed is None:  # pragma: no cover
            raise EventNotFoundError(str(event_id))
        return refreshed

    def update_event(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        expected_version: int,
        changes: dict,
        events_service: EventService,
    ) -> Event:
        """An operator editing SOMEBODY ELSE'S event.

        It delegates to `EventService.update_event` rather than reimplementing
        the write: the optimistic lock, the editable-field allow-list, the
        cache invalidation and the outbox event are all business rules that
        must not have a second, operator-flavoured copy that drifts. The only
        thing that changes is the ownership check, which this service has
        already replaced with a staff check of its own.

        The audit row records the OPERATOR, because the operator is who did it.
        """
        self._require_operator(actor_id)
        event = events_service.update_event(
            event_id=event_id,
            actor_id=actor_id,
            expected_version=expected_version,
            changes=changes,
            require_owner=False,
        )
        record_audit(
            actor_id=str(actor_id),
            action="event.edited_by_operator",
            target_type="event",
            target_id=str(event.id),
            metadata={"fields": sorted(k for k in changes if k in _EDITABLE_FIELDS)},
        )
        return event

    def delete_event(
        self, *, event_id: uuid.UUID | str, actor_id: uuid.UUID | str, reason: str
    ) -> None:
        """Remove an event from the platform.

        ── IT REFUSES WHEN ANYBODY HOLDS A TICKET ────────────────────────────

        Deleting an event somebody bought a ticket to is not an operator
        decision this endpoint can carry out honestly. The attendee would keep
        a ticket whose event no longer resolves, the organizer would keep a
        settlement referencing a row that reads as gone, and `Booking.event`
        and `Settlement.event` are `PROTECT` precisely so the database refuses
        to make that state reachable.

        So an event with any booking that is not merely an expired hold is
        refused, and the operator is told what to do instead: unpublish takes
        it off sale immediately and leaves the money path intact, and refunding
        is a separate deliberate decision in `payments`. Spam and mistakes —
        the events this endpoint exists for — have no bookings and delete
        cleanly.

        The delete itself is SOFT (`deleted_at`), which is what every read path
        on this platform already means by gone.
        """
        self._require_operator(actor_id)

        if not reason.strip():
            raise InvalidInputError("Deleting an event needs a reason.")

        event = self._events.get_active_by_id(event_id)
        if event is None:
            raise EventNotFoundError(str(event_id))

        if self._events.has_committed_bookings(event.id):
            raise InvalidEventStateError(
                "This event has bookings, so it cannot be deleted. Take it off sale "
                "instead, and refund the bookings if that is the intent.",
                status=str(event.status),
            )

        with UnitOfWork() as uow:
            if not self._events.soft_delete_event(event.id):
                # Someone deleted it between the read and here.
                raise EventNotFoundError(str(event_id))
            uow.publish(
                EVENT_ARCHIVED,
                {
                    "event_id": str(event.id),
                    "organization_id": str(event.organization_id),
                    "title": event.title,
                    "reason": reason,
                },
                aggregate_id=str(event.id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="event.deleted_by_operator",
                target_type="event",
                target_id=str(event.id),
                metadata={"reason": reason, "status": str(event.status)},
            )
            transaction.on_commit(lambda: invalidate_event_caches(event.id))

        logger.info("event_deleted_by_operator", extra={"event_id": str(event.id)})


# What an in-place edit of a content row may touch. Same shape as
# `_EDITABLE_FIELDS` above and for the same reason: the set of writable columns
# is a business rule, so a serializer key that is not here changes nothing
# rather than reaching the ORM. `url` is absent from the media set on purpose —
# see `UpdateEventMediaSerializer`.
_EDITABLE_MEDIA_FIELDS = ("kind", "alt_text", "caption", "position")
_EDITABLE_FAQ_FIELDS = ("question", "answer", "position")
_EDITABLE_TIMELINE_FIELDS = ("label", "description", "starts_at", "position")


def _applied(changes: dict, editable: tuple[str, ...]) -> dict:
    """The subset of `changes` that may be written, with text stripped.

    Stripping here rather than at the boundary keeps it identical to what the
    add paths already do — a caption of `"  "` must land as `""`, not as two
    spaces that render as a blank line under a photo.
    """
    return {
        key: value.strip() if isinstance(value, str) else value
        for key, value in changes.items()
        if key in editable
    }


class EventContentService:
    """Media, FAQs and running order for an event.

    OWNERSHIP IS CHECKED HERE, not in a DRF permission — the same reasoning the
    rest of this service uses: `_load_owned_for_write` already fetches the row,
    and an object-level permission would fetch it a second time per request.

    THE MEDIA CAPS LIVE HERE and nowhere else. One hero, ten gallery, one
    video. A partial unique index could enforce the singletons but not the
    count, and a rule split across two layers is a rule that drifts.
    """

    def __init__(self, *, events: EventRepository, content, storage: StoragePort) -> None:
        self._events = events
        self._content = content
        self._storage = storage

    def _owned(self, *, event_id: uuid.UUID | str, actor_id: uuid.UUID | str) -> Event:
        event = self._events.get_active_by_id(event_id)
        if event is None:
            raise EventNotFoundError(str(event_id))
        if event.organization.owner_id != actor_id:
            # NotFound, not PermissionDenied — a 403 confirms the event exists
            # to anyone guessing ids.
            raise EventNotFoundError(str(event_id))
        return event

    def _require_media_slot(self, event_id: uuid.UUID | str, kind: str) -> None:
        """Refuse when the event is already at the cap for `kind`.

        One implementation for all three write paths (add, upload, and a PATCH
        that MOVES a row to another kind) — the caps are the invariant this
        service exists to hold, and three copies of the check is three chances
        for one of them to be the lenient one.
        """
        from .repositories import MEDIA_LIMITS

        # `kind` arrives as a validated plain string from the serializer;
        # MEDIA_LIMITS is keyed by the enum, whose members ARE strings.
        limit = MEDIA_LIMITS.get(MediaKind(kind))
        if limit is not None and self._content.count_media(event_id, kind) >= limit:
            raise InvalidInputError(
                f"This event already has the maximum of {limit} "
                f"{'item' if limit == 1 else 'items'} for {kind}."
            )

    def _invalidate_if_public(self, event: Event) -> None:
        """Drop the event's public caches — but only if it HAS any.

        Editing a draft's content must not touch them: invalidation bumps the
        listing GENERATION, which orphans every cached listing page on the
        platform at once, and a draft appears on none of them. Same rule as
        `EventService.update_event`.

        Always inside `on_commit`, never before it — a concurrent reader in the
        pre-commit window would otherwise repopulate the cache from the row as
        it was before the write.
        """
        if event.status != EventStatus.LIVE:
            return
        transaction.on_commit(lambda: invalidate_event_caches(event.id))

    # -------------------------------------------------------------- media

    def add_media(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        kind: str,
        url: str,
        alt_text: str,
        caption: str = "",
        position: int = 0,
    ):
        event = self._owned(event_id=event_id, actor_id=actor_id)

        self._require_media_slot(event.id, kind)
        if not alt_text.strip():
            # The most-viewed image on the platform must not be invisible to a
            # screen reader. The column allows blank so historical rows survive;
            # this path does not.
            raise InvalidInputError("Alt text is required — it is what a screen reader reads.")

        with UnitOfWork():
            media = self._content.add_media(
                event_id=event.id,
                kind=kind,
                url=url,
                alt_text=alt_text.strip(),
                caption=caption.strip(),
                position=position,
            )
            record_audit(
                actor_id=str(actor_id),
                action="event.media_added",
                target_type="event",
                target_id=str(event.id),
                metadata={"kind": kind},
            )
            transaction.on_commit(lambda: invalidate_event_caches(event.id))
        return media

    def upload_media(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        upload,
        kind: str,
        alt_text: str,
        caption: str = "",
        position: int = 0,
    ):
        """Validate, store, and attach — one call.

        Deliberately ONE request rather than upload-then-attach. A two-step
        flow leaks orphaned objects every time a browser is closed between the
        steps, and it makes the client responsible for a URL it has no reason
        to hold. Ownership and the media caps are proven BEFORE anything is
        written to storage, so a refused upload leaves nothing behind.
        """
        from core.uploads import storage_path, validate_image

        event = self._owned(event_id=event_id, actor_id=actor_id)

        # Cheap checks first, in this order on purpose: ownership, then the
        # cap, then the file. Reading and storing bytes for an upload we were
        # always going to reject is wasted work and wasted storage.
        self._require_media_slot(event.id, kind)
        if not alt_text.strip():
            raise InvalidInputError("Alt text is required — it is what a screen reader reads.")

        content_type = validate_image(upload)
        path = storage_path(prefix="event-media", owner_id=str(event.id), filename=upload.name)

        # OUTSIDE the transaction: storage is slow external I/O, and CLAUDE.md's
        # performance rule is that it never happens while a DB transaction holds
        # connections. If the write below fails, the orphaned object is
        # harmless — far better than a row pointing at nothing.
        url = self._storage.upload(path=path, content=upload.read(), content_type=content_type)

        with UnitOfWork():
            media = self._content.add_media(
                event_id=event.id,
                kind=kind,
                url=url,
                alt_text=alt_text.strip(),
                caption=caption.strip(),
                position=position,
            )
            record_audit(
                actor_id=str(actor_id),
                action="event.media_uploaded",
                target_type="event",
                target_id=str(event.id),
                metadata={"kind": kind, "content_type": content_type},
            )
            transaction.on_commit(lambda: invalidate_event_caches(event.id))
        return media

    def update_media(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        media_id: uuid.UUID | str,
        changes: dict,
    ):
        """Edit one attached image or video in place.

        `changes: dict` rather than a keyword per field, matching
        `EventService.update_event`: on a PATCH, "absent" and "set to the
        default" are different instructions, and a signature of optional
        keywords cannot tell them apart without a sentinel per field.

        **Changing `kind` re-checks the TARGET kind's cap.** Without that, the
        one-hero invariant is trivially broken by adding a gallery image and then
        PATCHing it to `hero` — the create path's cap check would never have run
        for the kind the row ended up in.
        """
        event = self._owned(event_id=event_id, actor_id=actor_id)
        media = self._content.get_media(event_id=event.id, media_id=media_id)
        if media is None:
            # Scoped by event in the repository, so another organizer's media id
            # is indistinguishable from one that does not exist — which is the
            # point.
            raise EventNotFoundError(str(media_id))

        applied = _applied(changes, _EDITABLE_MEDIA_FIELDS)
        if "alt_text" in applied and not applied["alt_text"]:
            raise InvalidInputError("Alt text is required — it is what a screen reader reads.")
        kind = applied.get("kind")
        if kind is not None and kind != media.kind:
            self._require_media_slot(event.id, kind)

        with UnitOfWork():
            updated = self._content.update_media(
                event_id=event.id, media_id=media_id, changes=applied
            )
            if updated is None:  # pragma: no cover — removed between load and write
                raise EventNotFoundError(str(media_id))
            record_audit(
                actor_id=str(actor_id),
                action="event.media_updated",
                target_type="event",
                target_id=str(event.id),
                metadata={"media_id": str(media_id), "fields": sorted(applied)},
            )
            self._invalidate_if_public(event)
        return updated

    def reorder_media(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        items: list[dict],
    ):
        """Apply a whole new order to the event's media, atomically.

        Returns the full, freshly-ordered list — the client replaces its local
        order rather than reconciling it.

        An id that does not belong to this event is a NO-OP and not an error:
        the repository scopes every row by `event_id`, so a foreign id matches
        nothing. That is deliberate — the caller is describing the order of
        their own gallery, and refusing the whole request over one stale id
        (a photo someone else deleted mid-drag) would lose the reorder they
        actually made.
        """
        event = self._owned(event_id=event_id, actor_id=actor_id)
        # Keyed by str so the repository can match `str(row.pk)` regardless of
        # whether the caller passed UUID objects or strings.
        positions = {str(item["id"]): int(item["position"]) for item in items}

        with UnitOfWork():
            moved = self._content.reorder_media(event_id=event.id, positions=positions)
            record_audit(
                actor_id=str(actor_id),
                action="event.media_reordered",
                target_type="event",
                target_id=str(event.id),
                metadata={"requested": len(positions), "moved": moved},
            )
            self._invalidate_if_public(event)
        return self._content.media_for(event.id)

    def remove_media(
        self, *, event_id: uuid.UUID | str, actor_id: uuid.UUID | str, media_id: uuid.UUID | str
    ) -> None:
        event = self._owned(event_id=event_id, actor_id=actor_id)
        with UnitOfWork():
            if not self._content.soft_delete_media(media_id):
                raise EventNotFoundError(str(media_id))
            record_audit(
                actor_id=str(actor_id),
                action="event.media_removed",
                target_type="event",
                target_id=str(event.id),
            )
            transaction.on_commit(lambda: invalidate_event_caches(event.id))

    # ---------------------------------------------------------------- faq

    def add_faq(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        question: str,
        answer: str,
        position: int = 0,
    ):
        event = self._owned(event_id=event_id, actor_id=actor_id)
        if not question.strip() or not answer.strip():
            raise InvalidInputError("An FAQ needs both a question and an answer.")

        with UnitOfWork():
            faq = self._content.add_faq(
                event_id=event.id,
                question=question.strip(),
                answer=answer.strip(),
                position=position,
            )
            transaction.on_commit(lambda: invalidate_event_caches(event.id))
        return faq

    def update_faq(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        faq_id: uuid.UUID | str,
        changes: dict,
    ):
        """Edit one question or answer in place.

        A typo in a published answer is the single most common content edit on
        this collection, and delete-then-re-add loses the FAQ's place in the
        list while the organizer retypes it.
        """
        event = self._owned(event_id=event_id, actor_id=actor_id)
        applied = _applied(changes, _EDITABLE_FAQ_FIELDS)
        # Same rule as `add_faq`, applied to whichever half is present: an FAQ
        # with an empty answer is worse than no FAQ.
        if any(field in applied and not applied[field] for field in ("question", "answer")):
            raise InvalidInputError("An FAQ needs both a question and an answer.")

        with UnitOfWork():
            updated = self._content.update_faq(event_id=event.id, faq_id=faq_id, changes=applied)
            if updated is None:
                raise EventNotFoundError(str(faq_id))
            self._invalidate_if_public(event)
        return updated

    def remove_faq(
        self, *, event_id: uuid.UUID | str, actor_id: uuid.UUID | str, faq_id: uuid.UUID | str
    ) -> None:
        event = self._owned(event_id=event_id, actor_id=actor_id)
        with UnitOfWork():
            if not self._content.soft_delete_faq(faq_id):
                raise EventNotFoundError(str(faq_id))
            transaction.on_commit(lambda: invalidate_event_caches(event.id))

    # ----------------------------------------------------------- timeline

    def add_timeline_entry(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        kind: str,
        label: str,
        description: str = "",
        starts_at=None,
        position: int = 0,
    ):
        event = self._owned(event_id=event_id, actor_id=actor_id)
        if not label.strip():
            raise InvalidInputError("A timeline entry needs a label.")

        with UnitOfWork():
            entry = self._content.add_timeline_entry(
                event_id=event.id,
                kind=kind,
                label=label.strip(),
                description=description.strip(),
                starts_at=starts_at,
                position=position,
            )
            transaction.on_commit(lambda: invalidate_event_caches(event.id))
        return entry

    def update_timeline_entry(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        entry_id: uuid.UUID | str,
        changes: dict,
    ):
        """Edit one running-order entry in place.

        A set time moving is the normal case for this collection — a doors time
        slips by half an hour and every entry after it shifts — so this is the
        edit the running order most needed.
        """
        event = self._owned(event_id=event_id, actor_id=actor_id)
        applied = _applied(changes, _EDITABLE_TIMELINE_FIELDS)
        if "label" in applied and not applied["label"]:
            raise InvalidInputError("A timeline entry needs a label.")

        with UnitOfWork():
            updated = self._content.update_timeline_entry(
                event_id=event.id, entry_id=entry_id, changes=applied
            )
            if updated is None:
                raise EventNotFoundError(str(entry_id))
            self._invalidate_if_public(event)
        return updated

    def remove_timeline_entry(
        self, *, event_id: uuid.UUID | str, actor_id: uuid.UUID | str, entry_id: uuid.UUID | str
    ) -> None:
        event = self._owned(event_id=event_id, actor_id=actor_id)
        with UnitOfWork():
            if not self._content.soft_delete_timeline_entry(entry_id):
                raise EventNotFoundError(str(entry_id))
            transaction.on_commit(lambda: invalidate_event_caches(event.id))
