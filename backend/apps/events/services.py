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
from django.db import IntegrityError, transaction

from apps.accounts.repositories import UserRepository
from apps.organizations.exceptions import OrganizationNotFoundError
from apps.organizations.models import VerifiedLevel
from apps.organizations.repositories import OrganizationRepository
from config.di import build_booking_service, task_queue_port
from core.audit import record_audit
from core.errors import InvalidInputError
from core.events import (
    EVENT_APPROVED,
    EVENT_ARCHIVED,
    EVENT_CANCELLED_BY_ORGANIZER,
    EVENT_CREATED,
    EVENT_DELETED_BY_OPERATOR,
    EVENT_PUBLISHED,
    EVENT_REJECTED,
    EVENT_SUBMITTED_FOR_REVIEW,
    EVENT_UPDATED,
)
from core.ports.storage_port import StoragePort
from core.ports.task_queue_port import TaskQueuePort
from core.unit_of_work import UnitOfWork

from .exceptions import (
    DuplicateSlotError,
    EventNotFoundError,
    EventNotLiveError,
    EventNotUnderReviewError,
    InvalidEventStateError,
    NotEventOwnerError,
    NotPlatformOperatorError,
    OrganizationNotVerifiedError,
    SlotInUseError,
    StaleEventVersionError,
)
from .models import Event, EventSlot, EventStatus, MediaKind
from .publish_checks import run_publish_checks
from .repositories import EventRepository, EventSlotRepository
from .selectors import invalidate_event_caches
from .slugs import event_slug

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
    # A column the browse filters index MUST be reachable by a PATCH, or the
    # taxonomy is decoration only a data migration can populate.
    "category",
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
    # A LIST column, unlike every other editable field here. It is written
    # wholesale — an empty list clears it — so it needs no special handling
    # beyond being reachable: a column the event page renders must be
    # reachable by a PATCH, or the field is decoration.
    "policies",
)


def make_good_on_an_event(
    *,
    event: Event,
    reason: str,
) -> tuple[dict, _Settlement]:
    """Work out what calling an event off OWES, without doing any of it yet.

    ── WHY THIS IS SHARED BETWEEN CANCEL AND DELETE ───────────────────────

    An operator removing a fraudulent listing and an organiser calling off
    their own show are different DECISIONS with different authorization and
    different end states — but from a ticket holder's side they are one fact:
    the event is not happening and their money comes back. Two implementations
    of "return everybody's money" is how one of them ends up missing the hold
    release, and it would be missing it on the money path.

    So the decision stays in each service and the consequence lives here. This
    function only READS — the caller opens its own `UnitOfWork`, records its
    own outbox event, and calls `settle()` inside `transaction.on_commit`.
    Nothing here spends money or touches an external system.
    """
    from apps.booking.models import BookingStatus
    from apps.booking.repositories import BookingRepository
    from apps.payments.repositories import PaymentRepository

    bookings = list(BookingRepository().list_live_for_event(event.id))
    paid = [b for b in bookings if b.status == BookingStatus.PAID]
    reserved = [b for b in bookings if b.status == BookingStatus.RESERVED]

    payments = PaymentRepository()
    refundable = [
        str(payment.id)
        for payment in (payments.get_paid_for_booking(b.id) for b in paid)
        if payment is not None
    ]
    attendee_emails = sorted({b.user.email for b in paid if b.user_id})
    # (booking, owner) pairs: `cancel_booking` proves ownership, so a hold is
    # released THROUGH the same path a customer's own cancel takes — one code
    # path returns inventory, not two.
    reserved_ids = [(b.id, b.user_id) for b in reserved]

    summary = {
        "event_id": str(event.id),
        "title": event.title,
        "reason": reason,
        "refunds_enqueued": len(refundable),
        "holds_released": len(reserved),
        "attendees_notified": len(attendee_emails),
        "attendee_emails": attendee_emails,
    }
    return summary, _Settlement(refundable=refundable, reserved=reserved_ids)


class _Settlement:
    """The spending half, deliberately separate and deliberately deferred.

    Every call in here is external or slow — a refund goes to Razorpay through
    the queue's retry + dead-letter path, and a hold release opens its own
    transaction. Run it from `transaction.on_commit`, never inline: with the
    synchronous dev queue an inline enqueue would refund INSIDE the caller's
    transaction, so a rollback would leave money returned for an event that
    still exists.
    """

    def __init__(self, *, refundable: list[str], reserved: list) -> None:
        self._refundable = refundable
        self._reserved = reserved

    def settle(self) -> None:
        queue = task_queue_port()
        for payment_id in self._refundable:
            queue.enqueue(
                "payments.process_refund",
                {"payment_id": payment_id, "reason": "event_cancelled"},
            )
        booking_service = build_booking_service()
        for booking_id, owner_id in self._reserved:
            try:
                booking_service.cancel_booking(booking_id=booking_id, actor_id=owner_id)
            except Exception:  # noqa: BLE001
                # One stuck hold must not stop the others being freed.
                logger.exception(
                    "events.make_good.hold_release_failed",
                    extra={"booking_id": str(booking_id)},
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
        """The event's cover image — validated exactly like every other upload.

        This method previously did NEITHER of the two things `core.uploads`
        exists to do, and both were real:

        1. **No validation.** It took `poster.content_type` from the browser and
           handed it to storage unread, so an HTML file renamed `.jpg` was
           served back from our own origin with a content type of its choosing.
           That is the stored-XSS primitive the allow-list and the byte sniff
           were written to close, and the poster — the one image on every event
           page — was the path that skipped them.
        2. **The attacker's filename in the storage key.** `-{poster.name}`
           interpolates an unsanitised name straight into the object path.
           `storage_path` exists because that name can carry `../`, a null byte
           or 4 KB of Unicode.

        It now runs the same gate as gallery media, `EVENT_IMAGE_SPEC` included:
        the poster is what the hero frame draws, so if anything must be the
        right shape it is this.
        """
        from core.uploads import EVENT_IMAGE_SPEC, storage_path, validate_image

        content_type = validate_image(poster, spec=EVENT_IMAGE_SPEC)
        # `name` is optional on an UploadedFile — a multipart part can arrive
        # without a filename. `storage_path` only reads it for the extension,
        # so an empty string means "no extension", not a broken key.
        path = storage_path(
            prefix="event-posters", owner_id=str(event_id), filename=poster.name or ""
        )
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
                # The readable half of `/events/{slug}-{id}`. Derived here, on
                # the ONE path that creates an event, so no row can exist
                # without one — and never taken from the request (see
                # `_EDITABLE_FIELDS`, which deliberately omits it).
                slug=event_slug(title),
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

        # A renamed event gets a new slug, and the old URL keeps working — it
        # carries the same UUID, so it resolves and redirects. Freezing the slug
        # instead would mean an event whose title was fixed for a typo carries
        # that typo in its URL forever.
        #
        # Guarded on the slug ACTUALLY differing, not merely on `title` being in
        # the payload: "Sunburn Arena!" -> "Sunburn Arena" is the same slug, and
        # writing it anyway would manufacture a redirect for an edit that
        # changed no URL. This rides inside the same conditional UPDATE below,
        # so it is covered by the optimistic lock and the cache invalidation
        # with no extra plumbing.
        if "title" in applied_changes:
            new_slug = event_slug(applied_changes["title"])
            if new_slug != event.slug:
                applied_changes["slug"] = new_slug

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

    def cancel_event(
        self, *, event_id: uuid.UUID | str, actor_id: uuid.UUID | str, reason: str
    ) -> dict:
        """An organiser calls their own event off, and makes good on it.

        ── WHY THIS IS NOT ARCHIVE, AND NOT DELETE ────────────────────────

        `archive_event` retires an event nobody is holding a ticket to — it
        refuses `live` for exactly that reason. Deletion is an OPERATOR's tool
        for a listing that should not exist. Neither covers the ordinary,
        awful case: a live event with real bookings that is not going to
        happen, called off by the person running it.

        ── THE PAGE MUST STILL RESOLVE ────────────────────────────────────

        `cancelled` is a PUBLIC state, not a soft delete. Hundreds of people
        have a link in an email and they WILL open it. A 404 reads as "the
        platform lost my booking"; the page saying "this event was cancelled
        and your refund is on its way" is the entire difference between a
        support queue and none.

        ── AND IT IS TERMINAL ─────────────────────────────────────────────

        There is no un-cancel. Money has been returned and inventory released,
        so "resuming" would mean re-charging people who were refunded and
        re-issuing tickets nobody holds. The honest route back is a new event.

        Returns the same summary shape the operator's delete does, because
        this click also spends money and the organiser needs to see how much
        it started rather than a bare 200.
        """
        if not reason.strip():
            # Attendees are shown this verbatim. "Cancelled" with no reason is
            # the message that generates every one of the support tickets this
            # endpoint exists to prevent.
            raise InvalidInputError(
                "Say why this event is being cancelled — everyone who booked will see it."
            )

        event = self._load_owned_for_write(event_id=event_id, actor_id=actor_id)
        if event.status not in (EventStatus.LIVE, EventStatus.PAUSED):
            raise InvalidEventStateError(
                f"A '{event.status}' event cannot be cancelled. "
                "Only an event that is on sale, or paused, has anybody to tell."
            )

        summary, settlement = make_good_on_an_event(event=event, reason=reason.strip())

        with UnitOfWork() as uow:
            # Conditional on the version AND on the source state, so two
            # organisers pressing Cancel at once cannot both succeed and send
            # two rounds of cancellation emails.
            if not self._events.cancel_if_cancellable(
                event_id=event.id, expected_version=event.version
            ):
                raise StaleEventVersionError()

            uow.publish(
                EVENT_CANCELLED_BY_ORGANIZER,
                {
                    "event_id": str(event.id),
                    "title": event.title,
                    "reason": reason.strip(),
                    "refunded_bookings": summary["refunds_enqueued"],
                    "attendee_emails": summary["attendee_emails"],
                },
                aggregate_id=str(event.id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="event.cancelled",
                target_type="event",
                target_id=str(event.id),
                metadata={
                    "reason": reason.strip(),
                    "refunds_enqueued": summary["refunds_enqueued"],
                    "reserved_holds": summary["holds_released"],
                },
            )
            transaction.on_commit(settlement.settle)
            # It WAS live, so it is on listing pages and in the detail cache —
            # both have to go, or the event goes on being sold from a cache.
            transaction.on_commit(lambda: invalidate_event_caches(event.id))

        logger.info(
            "event_cancelled",
            extra={"event_id": str(event.id), "refunds": summary["refunds_enqueued"]},
        )
        return {key: value for key, value in summary.items() if key != "attendee_emails"}

    #: Copied onto a duplicate. Deliberately NOT every column.
    #:
    #: What is excluded is the point of the list:
    #:   - `status`, `version`, `slug` — a copy starts as a fresh DRAFT.
    #:   - moderation fields (`moderation_note`, `moderated_at`, `moderated_by`)
    #:     — a previous approval is not transferable; the copy is a new event
    #:     and a human decides on it again.
    #:   - `from_price_minor` / `tickets_available` — display denormals
    #:     `ticketing` owns and recomputes from real tier rows. Copying them
    #:     would put a price on a page with nothing behind it.
    #:   - `search_vector` — a DB trigger maintains it.
    _CLONED_FIELDS = (
        "title",
        "description",
        "short_description",
        "venue",
        "city",
        "category",
        "place_id",
        "latitude",
        "longitude",
        "starts_at",
        "ends_at",
        "duration_minutes",
        "language",
        "age_restriction",
        "accessibility_notes",
        "seo_title",
        "seo_description",
        "policies",
        "poster_url",
    )

    def duplicate_event(self, *, event_id: uuid.UUID | str, actor_id: uuid.UUID | str) -> Event:
        """Copy an event into a fresh DRAFT the organizer can edit.

        Running the same show monthly meant retyping the venue, the policies,
        the age limit and the running order every time. This copies all of it
        and hands back a draft.

        ── WHAT IT DOES NOT COPY, AND WHY ────────────────────────────────────

        A clone is a NEW event, not a continuation, so nothing that was earned
        by the original comes with it:

          - It is always a DRAFT, whatever the source was. A copy of a live
            event that arrived already live would be an event published
            without anyone deciding to publish it.
          - Moderation history does not transfer. A previous approval was for
            a specific event on a specific date.
          - No bookings, tickets, scans or settlement — those belong to the
            original and are `PROTECT`ed to it.
          - NO TICKET TYPES. They belong to `ticketing`, and dependencies here
            point one way — ticketing imports events, never the reverse — so
            reaching across to clone tier rows would invert the one rule that
            keeps these modules separable. The consequence is honest and
            deliberate: the copy cannot be published until the organizer adds
            a tier, because `ticketing` registers exactly that publish check.
            The API says so in its response rather than leaving them to
            discover it at the publish gate.

        The content collections this module OWNS — FAQs and the running order
        — are copied, because they are the retyping this exists to remove.
        """
        source = self._load_owned_for_write(event_id=event_id, actor_id=actor_id)

        fields = {name: getattr(source, name) for name in self._CLONED_FIELDS}
        # A list column: copy the VALUE, not the reference, or editing the
        # clone's policies would edit the original's in the same process.
        fields["policies"] = list(fields.get("policies") or [])
        title = f"Copy of {source.title}"[: Event._meta.get_field("title").max_length]

        with UnitOfWork() as uow:
            clone = self._events.create_clone(
                organization_id=source.organization_id,
                fields={**fields, "title": title, "slug": event_slug(title)},
            )
            self._events.copy_content_to(source_id=source.id, target_id=clone.id)

            uow.publish(
                EVENT_CREATED,
                {
                    "event_id": str(clone.id),
                    "organization_id": str(clone.organization_id),
                    "cloned_from": str(source.id),
                },
                aggregate_id=str(clone.id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="event.duplicated",
                target_type="event",
                target_id=str(clone.id),
                metadata={"cloned_from": str(source.id)},
            )

        logger.info(
            "event_duplicated",
            extra={"event_id": str(clone.id), "cloned_from": str(source.id)},
        )
        return clone

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
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        reason: str,
    ) -> dict:
        """Remove an event from the platform, in ANY state, and make good on it.

        ── IT USED TO REFUSE WHEN ANYBODY HELD A TICKET ────────────────────

        The previous implementation raised `InvalidEventStateError` for an
        event with bookings and told the operator to unpublish and refund
        separately. The reasoning was sound — an attendee must not keep a
        ticket to an event that no longer resolves — but the conclusion was
        backwards: it refused in exactly the cases an operator reaches for this
        (a fraudulent listing that has already sold, an event that cannot
        legally go ahead), and left the dangerous half — the refunds — as a
        separate action somebody had to remember.

        So it no longer refuses. It does the whole job instead: remove the
        event AND return everybody's money, in one operation, so the two can
        never come apart.

        ── WHY IT IS STILL A SOFT DELETE ──────────────────────────────────

        `Booking`, `ScanLog` and `TicketType` reference `Event` with `PROTECT`,
        so a real `DELETE` raises `ProtectedError` for anything carrying a
        ticket tier — i.e. every published event, because publishing requires
        one. `deleted_at` is what every read on this platform already means by
        gone, and it keeps the financial record intact, which a platform that
        took money for those tickets is obliged to do.

        ── AND WHY THE REFUNDS ARE ENQUEUED, AFTER COMMIT ─────────────────

        The external call belongs on the queue's retry + dead-letter path, and
        an operator pressing Delete must not wait on Razorpay. `on_commit`
        because with the synchronous dev queue an inline enqueue would run the
        refund INSIDE this transaction — so a rollback would leave money
        returned for an event that still exists.

        Returns a summary the console renders, because this click spends money:
        the operator needs to see how many refunds it started, not a bare 204.
        """
        self._require_operator(actor_id)
        if not reason.strip():
            # The organizer is shown this verbatim. A deletion with no reason
            # becomes a support thread nobody can answer.
            raise InvalidInputError("Say why this event is being removed — the organizer sees it.")

        event = self._events.get_active_by_id(event_id)
        if event is None:
            raise EventNotFoundError(str(event_id))

        owner = self._users.get_by_id(event.organization.owner_id)

        # Shared with `EventService.cancel_event`: two implementations of
        # "return everybody's money" is how one of them ends up missing the
        # hold release, on the money path.
        summary, settlement = make_good_on_an_event(event=event, reason=reason.strip())
        attendee_emails = summary["attendee_emails"]

        with UnitOfWork() as uow:
            # Conditional on being un-deleted, so two operators cannot both
            # "succeed" and send two rounds of cancellation emails.
            if not self._events.soft_delete(
                event_id=event.id, actor_id=actor_id, reason=reason.strip()
            ):
                raise EventNotFoundError(str(event_id))

            uow.publish(
                EVENT_DELETED_BY_OPERATOR,
                {
                    "event_id": str(event.id),
                    "title": event.title,
                    "owner_email": owner.email if owner else "",
                    "reason": reason.strip(),
                    "refunded_bookings": summary["refunds_enqueued"],
                    "attendee_emails": attendee_emails,
                },
                aggregate_id=str(event.id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="event.deleted_by_operator",
                target_type="event",
                target_id=str(event.id),
                metadata={
                    "reason": reason.strip(),
                    "reserved_holds": summary["holds_released"],
                    "refunds_enqueued": summary["refunds_enqueued"],
                },
            )

            transaction.on_commit(settlement.settle)
            transaction.on_commit(lambda: invalidate_event_caches(event.id))

        logger.info(
            "event_deleted_by_operator",
            extra={
                "event_id": str(event.id),
                "refunds": summary["refunds_enqueued"],
                "holds": summary["holds_released"],
            },
        )
        # `attendee_emails` is dropped from the response: the console renders
        # counts, and a list of every ticket holder's address is not something
        # an endpoint should hand back when nothing displays it.
        return {key: value for key, value in summary.items() if key != "attendee_emails"}


# What an in-place edit of a content row may touch. Same shape as
# `_EDITABLE_FIELDS` above and for the same reason: the set of writable columns
# is a business rule, so a serializer key that is not here changes nothing
# rather than reaching the ORM. `url` is absent from the media set on purpose —
# see `UpdateEventMediaSerializer`.
_EDITABLE_MEDIA_FIELDS = ("kind", "alt_text", "caption", "position")
_EDITABLE_FAQ_FIELDS = ("question", "answer", "position")
_EDITABLE_TIMELINE_FIELDS = ("label", "description", "starts_at", "position")


#: How many sessions one event may carry. A season with more than this is
#: several events, not one — and the slot list is rendered in full on the
#: ticket panel, un-paginated, because a chooser you have to page through is
#: not a chooser.
MAX_SLOTS_PER_EVENT = 60

_EDITABLE_SLOT_FIELDS = ("label", "starts_at", "ends_at", "position", "is_active")


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

    def __init__(
        self,
        *,
        events: EventRepository,
        content,
        storage: StoragePort,
        slots: EventSlotRepository | None = None,
    ) -> None:
        self._events = events
        self._content = content
        self._storage = storage
        self._slots = slots or EventSlotRepository()

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
        if kind == MediaKind.VIDEO:
            # NORMALISED, not merely validated. The URL stored is one we build
            # from an extracted id, so a crafted `youtube.com/embed/...?x=` can
            # never survive the round trip into an iframe on our own origin —
            # the same class of problem SVG uploads are, handled the same way.
            from core.video_embeds import parse_video_url

            url = parse_video_url(url).embed_url
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
        from core.uploads import EVENT_IMAGE_SPEC, storage_path, validate_image

        event = self._owned(event_id=event_id, actor_id=actor_id)

        # Cheap checks first, in this order on purpose: ownership, then the
        # cap, then the file. Reading and storing bytes for an upload we were
        # always going to reject is wasted work and wasted storage.
        self._require_media_slot(event.id, kind)
        if kind == MediaKind.VIDEO:
            # This endpoint used to fail here with "upload a JPEG, PNG, WebP,
            # AVIF or GIF" — technically true and useless, because the caller
            # was not trying to upload an image. A trailer is 50-200 MB, needs
            # transcoding and a CDN this platform has not configured; what
            # organisers have is a YouTube or Vimeo link, so that is the route
            # and this says so.
            raise InvalidInputError(
                "Videos are added as a link, not a file. Upload it to YouTube or Vimeo "
                "and paste the link instead."
            )
        if not alt_text.strip():
            raise InvalidInputError("Alt text is required — it is what a screen reader reads.")

        # `EVENT_IMAGE_SPEC` because every one of these renders in the event
        # page's single widescreen frame — the hero, the filmstrip and the
        # lightbox all draw the same shape. See the note on `ImageSpec`.
        content_type = validate_image(upload, spec=EVENT_IMAGE_SPEC)
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

    # -------------------------------------------------------------- slots

    def list_slots(self, *, event_id: uuid.UUID | str, actor_id: uuid.UUID | str):
        """Every session including the ones taken off sale.

        The owner's view. The public one (`EventContentView`) shows active
        slots only — an organiser needs to see the session they switched off,
        or the only way to notice it is that nobody buys a ticket for it.
        """
        event = self._owned(event_id=event_id, actor_id=actor_id)
        return self._slots.list_for_event(event.id, active_only=False)

    def add_slot(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        starts_at,
        label: str = "",
        ends_at=None,
        position: int = 0,
    ) -> EventSlot:
        event = self._owned(event_id=event_id, actor_id=actor_id)
        if self._slots.list_for_event(event.id, active_only=False).count() >= MAX_SLOTS_PER_EVENT:
            raise InvalidInputError(
                f"An event can have at most {MAX_SLOTS_PER_EVENT} sessions. "
                "Run a longer season as separate events."
            )

        with UnitOfWork():
            try:
                # Its own savepoint: a unique-constraint violation aborts the
                # transaction it happens in, so catching it without one would
                # leave the surrounding UnitOfWork unusable.
                with transaction.atomic():
                    slot = self._slots.create(
                        event_id=event.id,
                        label=label.strip(),
                        starts_at=starts_at,
                        ends_at=ends_at,
                        position=position,
                    )
            except IntegrityError as exc:
                raise DuplicateSlotError() from exc
            self._sync_event_window(event)
            transaction.on_commit(lambda: invalidate_event_caches(event.id))
        return slot

    def update_slot(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        slot_id: uuid.UUID | str,
        changes: dict,
    ) -> EventSlot:
        event = self._owned(event_id=event_id, actor_id=actor_id)
        slot = self._slots.get_for_event(event.id, slot_id)
        if slot is None:
            raise EventNotFoundError(str(slot_id))
        applied = _applied(changes, _EDITABLE_SLOT_FIELDS)
        if not applied:
            raise InvalidInputError("Provide at least one field to update.")

        # Checked against the MERGED row, not the payload: moving only the start
        # of a slot that already has an end can invert the pair just as surely
        # as sending both.
        merged_start = applied.get("starts_at", slot.starts_at)
        # `.get` with the current value as the default, so an explicit null
        # (clearing the end) survives as a null rather than falling back.
        merged_end = applied.get("ends_at", slot.ends_at)
        if merged_end and merged_end <= merged_start:
            raise InvalidInputError("This slot ends before it starts — check the times.")

        with UnitOfWork():
            try:
                with transaction.atomic():
                    self._slots.update_fields(slot, **applied)
            except IntegrityError as exc:
                raise DuplicateSlotError() from exc
            self._sync_event_window(event)
            transaction.on_commit(lambda: invalidate_event_caches(event.id))
        return slot

    def remove_slot(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        slot_id: uuid.UUID | str,
    ) -> None:
        """Delete a session outright — only while nothing sells it.

        A slot with tiers attached is refused rather than cascaded. `TicketType
        .slot` is PROTECT precisely because those tiers hold the inventory
        counters and, once anything is sold, the issued tickets: deleting the
        session out from under them would leave real tickets admitting to a
        show that no longer exists. Turning the slot OFF is the operation that
        always works, and is what a cancelled session actually is.
        """
        event = self._owned(event_id=event_id, actor_id=actor_id)
        slot = self._slots.get_for_event(event.id, slot_id)
        if slot is None:
            raise EventNotFoundError(str(slot_id))
        if self._slots.count_ticket_types(slot.id):
            raise SlotInUseError()

        with UnitOfWork():
            self._slots.delete_slot(slot)
            self._sync_event_window(event)
            transaction.on_commit(lambda: invalidate_event_caches(event.id))

    def _sync_event_window(self, event: Event) -> None:
        """Keep the event's own window equal to the span of its sessions.

        Three separate systems read `Event.starts_at` as the truth: browse
        sorts and cursor-pages on it, the check-in window opens against it, and
        settlements decide an event has finished from it. So an event whose
        sessions are at 18:00 and 21:00 while the row still says 14:00 is
        wrong in three places at once — and the one people SEE is the listing.

        Only ACTIVE slots count. A session taken off sale must not go on
        holding the event's start time at its hour.

        The organiser can still edit `starts_at` directly; the next slot write
        simply re-derives it. Once an event has sessions, the sessions ARE the
        schedule, and there is no second place to keep it.
        """
        active = list(self._slots.list_for_event(event.id, active_only=True))
        if not active:
            return
        window: dict = {}
        earliest = min(slot.starts_at for slot in active)
        if event.starts_at != earliest:
            window["starts_at"] = earliest
        # `ends_at` is optional on a slot, so the latest end is only knowable
        # from the slots that carry one. With none, the event's own end is left
        # exactly as the organiser set it rather than invented from a start.
        ends = [slot.ends_at for slot in active if slot.ends_at]
        if ends and event.ends_at != max(ends):
            window["ends_at"] = max(ends)
        if window:
            self._events.set_window(event.id, **window)
            for field, value in window.items():
                setattr(event, field, value)

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
