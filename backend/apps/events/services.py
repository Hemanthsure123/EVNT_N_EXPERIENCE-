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
from datetime import datetime, timedelta
from typing import Any, Protocol

from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.text import slugify

from apps.accounts.repositories import UserRepository
from apps.organizations.exceptions import OrganizationNotFoundError
from apps.organizations.models import Organization, VerifiedLevel
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
    CrewMemberInUseError,
    CrewMemberNotFoundError,
    CrewOrganizationNotFoundError,
    DuplicateActiveEventError,
    DuplicateSlotError,
    EventNotFoundError,
    EventNotLiveError,
    EventNotUnderReviewError,
    InvalidEventStateError,
    NotEventOwnerError,
    NotPlatformOperatorError,
    OrganizationNotVerifiedError,
    OrganizerCategoryInUseError,
    OrganizerCategoryNotFoundError,
    SlotInUseError,
    StaleEventVersionError,
)
from .models import (
    CrewMember,
    Event,
    EventCategory,
    EventSlot,
    EventStatus,
    MediaKind,
    OrganizerCategory,
    QuestionKind,
)
from .publish_checks import run_publish_checks
from .repositories import (
    CrewMemberRepository,
    EventCrewRepository,
    EventRepository,
    EventSlotRepository,
    EventWaitlistRepository,
    OrganizerCategoryRepository,
)
from .selectors import invalidate_event_caches
from .slugs import event_slug

logger = logging.getLogger(__name__)


def _validate_schedule_against_stored(event: Event, changes: dict) -> None:
    """The event window, decided against the MERGED row rather than the payload.

    ── WHY THE SERIALIZER CANNOT BE THE GUARANTEE ─────────────────────────

    `UpdateEventRequestSerializer` compares `starts_at` and `ends_at` only
    when BOTH are in the payload, which is all it can do — it has never seen
    the stored row. A PATCH carrying only `ends_at` therefore passed every
    check and wrote an end time BEFORE the start:

        stored:  starts_at = 12 Mar 19:00,  ends_at = 12 Mar 23:00
        PATCH :  {"version": 4, "ends_at": "2026-03-12T09:00:00Z"}
        result:  an event that ends ten hours before it begins

    Nothing downstream is defended against that. `ends_at` drives the
    check-in grace window (`checkin`), the settlement's "event has finished"
    gate and the payout date (`settlements`), and the event page's own
    date line. An inverted window makes a settlement releasable before the
    event and a check-in window that closes before it opens.

    This is the same class of bug — and the same fix — as coupons'
    `validate_terms` running against the merged row: a PATCH carrying one
    half of a pair must be judged against the half already stored, never
    against the absent other half of its own payload.

    ── AND WHY "MUST BE IN THE FUTURE" IS CONDITIONAL HERE ────────────────

    On a create, a start in the past is nonsense and is refused outright. On
    an update it depends on the stored row, which is exactly why the check
    could not stay in the serializer (see the note there):

    - the event has NOT started yet -> a new start must still be in the
      future, or an organizer could quietly move a selling event into the
      past, hiding it from every browse query (all of which filter
      `starts_at >= now`) while tickets stay on sale;
    - the event HAS already started -> allow it. The start being in the past
      is now a FACT about the event, not a mistake in the request, and
      refusing here is what locked organizers out of editing their own live
      and finished events.

    An unchanged `starts_at` is never judged at all, so re-sending the whole
    editable surface — which `toPatchInput` does on every save — is free.
    """
    if "starts_at" not in changes and "ends_at" not in changes:
        return

    starts_at = changes.get("starts_at", event.starts_at)
    # `.get` with the stored value as the default: an EXPLICIT null in the
    # payload ("clear the end time") still wins, because the key is present.
    ends_at = changes.get("ends_at", event.ends_at)

    if starts_at is None:
        raise InvalidInputError("An event must have a start time.")
    if ends_at is not None and ends_at <= starts_at:
        raise InvalidInputError("ends_at must be after starts_at.")

    if "starts_at" in changes and changes["starts_at"] != event.starts_at:
        now = timezone.now()
        already_started = event.starts_at is not None and event.starts_at <= now
        if not already_started and changes["starts_at"] <= now:
            raise InvalidInputError("starts_at must be in the future.")


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
    # The organizer's own label, BESIDE `category` rather than instead of it.
    # In the allow-list because a column the wizard offers must be reachable by
    # a PATCH, or it is decoration only a data migration can populate.
    "custom_category",
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
    # The three bullet lists, written wholesale exactly like `policies`.
    "highlights_included",
    "highlights_excluded",
    "guidelines",
    # The taxonomy. `event_type` and `tags` are BROWSE FILTERS, so the rule
    # bites harder than usual here: a filterable column an organiser cannot
    # set is a chip row that matches nothing for ever.
    "event_type",
    "tags",
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
        categories: OrganizerCategoryRepository | None = None,
    ) -> None:
        self._events = events
        self._organizations = organizations
        self._users = users
        self._storage = storage
        self._task_queue = task_queue
        # DEFAULTED, so every existing construction site — including the tests
        # that build this service by hand with fake adapters — keeps working
        # unchanged. It is only ever used to answer one question: does this
        # custom category belong to this event's organization.
        self._categories = categories or OrganizerCategoryRepository()

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

    def get_owned_event(self, *, event_id: uuid.UUID | str, actor_id: uuid.UUID | str) -> Event:
        """One of the caller's own events, at ANY status.

        This is what the organizer wizard reads to open the editor, and what
        the clone flow reads to fill a new draft from an existing event.

        Before it existed both went through the PUBLIC detail endpoint, which
        resolves only `LIVE` and `CANCELLED` — so opening the editor for a
        draft, a finished event or a rejected one answered 404 and the wizard
        said "That event is not available" about an event the organizer owns.
        Cloning a past event was impossible for the same reason, which is
        precisely the event somebody most wants to run again.

        The miss is a 404 for BOTH "not yours" and "does not exist", so a
        guessed uuid cannot be used to test whether an id is real.
        """
        event = self._events.get_owned_by_id(event_id, actor_id)
        if event is None:
            raise EventNotFoundError(str(event_id))
        return event

    def _enqueue_poster_processing(self, event_id: uuid.UUID | str, poster_url: str) -> None:
        transaction.on_commit(
            lambda: self._task_queue.enqueue(
                _POSTER_PROCESS_TASK,
                {"event_id": str(event_id), "poster_url": poster_url},
            )
        )

    def _resolved_custom_category_id(self, *, organization_id, category_id):
        """THE CROSS-TENANT CHECK, and it is the only real security boundary
        this field has.

        `custom_category` arrives as a uuid from a browser. Without this, a
        guessed id would put ANOTHER organization's label — and its uploaded
        image — on your event, which is precisely the failure the crew module
        documents for `PUT /events/{id}/crew` ("a guessed uuid puts another
        organization's face on your public page").

        `None` is a legitimate value meaning "detach", so it is passed through
        rather than validated. Anything else must be a LIVE, ACTIVE row this
        organization owns — a retired category cannot be attached to a new
        event, which is what `is_active` is for.

        Refused as an `InvalidInputError` rather than a 404: the id was
        supplied as a field on somebody's own event, and the honest answer is
        that the value is not one they may use.
        """
        if category_id is None:
            return None
        if not self._categories.owns_category(
            organization_id=organization_id, category_id=category_id
        ):
            raise InvalidInputError("That category is not one of yours.")
        return category_id

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
        category: str = "",
        custom_category=None,
    ) -> Event:
        org = self._organizations.get_active_by_id(organization_id)
        if org is None:
            raise OrganizationNotFoundError(str(organization_id))
        if str(org.owner_id) != str(actor_id):
            raise NotEventOwnerError()

        # BOTH categories are settable at creation. `category` used to be
        # neither a parameter here nor a field on the create serializer, so
        # every event built through the wizard landed uncategorised and stayed
        # that way until some later PATCH happened to carry it — the organiser
        # chose a tile, the API answered 201, and the choice went nowhere.
        custom_category_id = self._resolved_custom_category_id(
            organization_id=org.id, category_id=custom_category
        )

        event_id = uuid.uuid4()
        poster_url = self._upload_poster(event_id, poster) if poster is not None else ""

        with UnitOfWork() as uow:
            event = self._events.create(
                organization_id=org.id,
                category=category,
                custom_category_id=custom_category_id,
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
        if "custom_category" in applied_changes:
            # The serializer hands over a uuid; the column is a foreign key, so
            # the write needs `custom_category_id`. Assigning a raw uuid to
            # `custom_category` in a queryset `.update()` does not raise — it
            # writes nothing — which is the silent no-op this codebase keeps
            # finding, so the rename happens here where it is visible.
            applied_changes["custom_category_id"] = self._resolved_custom_category_id(
                organization_id=event.organization_id,
                category_id=applied_changes.pop("custom_category"),
            )
        # Against the MERGED row, and BEFORE the poster upload: an inverted
        # window must not cost an organizer a stored object nothing will ever
        # reference.
        _validate_schedule_against_stored(event, applied_changes)
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

        # ── ONE ACTIVE EVENT PER TITLE, PER VENUE ────────────────────────
        #
        # Checked HERE and nowhere earlier. A draft may carry any title it
        # likes, including one identical to a live event's — that is what a
        # clone of a monthly residency IS, and forcing "Copy of ..." into the
        # name to avoid a collision that may never happen is how a dashboard
        # fills with rows nobody meant to name that way.
        #
        # The collision only becomes real at the moment this event would
        # appear beside the other one, which is submission. TITLE AND VENUE
        # TOGETHER: the same night run in two cities is two events a buyer can
        # tell apart and both should be listed, so venue is what makes the
        # name ambiguous rather than merely repeated.
        #
        # Before `run_publish_checks`, so an organizer who has to rename is
        # told that first rather than after fixing three unrelated readiness
        # complaints — and because a rename is the one refusal here they can
        # act on without leaving the screen.
        clash = self._events.find_active_title_clash(
            title=event.title, venue=event.venue, exclude_id=event.id
        )
        if clash is not None:
            raise DuplicateActiveEventError(
                f"Another event called “{clash.title}” is already running at {clash.venue}. "
                "Give this one a different title — two live events with the same name at "
                "the same venue are indistinguishable to somebody buying a ticket.",
                conflicting_event_id=str(clash.id),
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
        "highlights_included",
        "highlights_excluded",
        "guidelines",
        "event_type",
        "tags",
        "poster_url",
    )

    #: The subset of `_CLONED_FIELDS` that are JSON list columns and therefore
    #: must be copied by value. Kept beside the tuple it filters so the two
    #: cannot drift; `test_policies_are_copied_by_value` covers the first of
    #: them and would keep passing if a later column aliased.
    _LIST_FIELDS = (
        "policies",
        "highlights_included",
        "highlights_excluded",
        "guidelines",
        "tags",
    )

    # ── `duplicate_event` WAS HERE, AND IT IS GONE ──────────────────────
    #
    # It copied an event into a fresh server-side DRAFT titled "Copy of ...",
    # and both things it did were wrong for what cloning is actually for.
    #
    # It CREATED A ROW ON A PRESS. An organizer exploring what clone does got a
    # permanent draft for it, and pressing twice got two. The events list in
    # the report that killed this had five of them — "Copy of Copy of Copy of
    # AURORA MUSIC AND ..." — none of which anybody meant to keep, all of them
    # needing individual archiving to clear.
    #
    # And it RENAMED THE EVENT. "Copy of" is scaffolding: the copy of a monthly
    # residency IS that residency, run again, and the organizer has to delete
    # those two words every single time. The name only has to be distinct where
    # a buyer would meet both at once, which is now checked at PUBLISH against
    # the title and the venue together — see `publish_event`.
    #
    # Cloning is a FRONTEND hydration now: the wizard opens as a new draft with
    # every field of the source poured into it, and nothing is written until
    # the organizer saves. That is only possible because the collections a
    # server copy existed to carry — sessions, running order, lineup, FAQs —
    # are staged in the draft and flushed on first save, exactly as tiers
    # always were. See `PendingSlot` in the frontend's `wizard/model.ts`.
    #
    # `EventRepository.copy_content_to` and
    # `TicketTypeRepository.copy_ticket_types_to` are left in place: they are
    # correct, tested, transaction-safe primitives, and the day a bulk
    # server-side copy is genuinely wanted they are what it should be built on.

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
#: `position` so the studio can reorder, `is_required` so a question can be
#: relaxed without retyping it. NOT `event`: a question cannot move between
#: events, and accepting the field would let a PATCH reparent one straight past
#: the ownership check that has just run.
_EDITABLE_QUESTION_FIELDS = (
    "prompt",
    "help_text",
    "kind",
    "choices",
    "is_required",
    "position",
)
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
        crew: CrewMemberRepository | None = None,
        lineups: EventCrewRepository | None = None,
    ) -> None:
        self._events = events
        self._content = content
        self._storage = storage
        self._slots = slots or EventSlotRepository()
        self._crew = crew or CrewMemberRepository()
        self._lineups = lineups or EventCrewRepository()

    # ---------------------------------------------------------------- crew

    #: How many people may appear on one event's lineup. Not a database
    #: constraint, because it is a product judgement rather than an invariant:
    #: a carousel of forty faces is not a lineup, it is a directory.
    MAX_LINEUP = 25

    def set_event_crew(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        member_ids: list[str],
    ) -> list:
        """Replace an event's whole lineup with this ordered set of members.

        ── THE CHECK THAT MATTERS IS THE CROSS-TENANT ONE ──────────────────

        `member_ids` arrives from a browser. Every id is verified to belong to
        THIS event's organization, in ONE query, and a single stranger's id
        REFUSES the whole write rather than being silently dropped. Dropping it
        would be worse than refusing: the organizer would press save, see no
        error, and never learn that one of their choices did not stick.

        Without that check, a guessed uuid would put another organization's
        person on your public event page — the only genuine security boundary
        this feature has.

        Duplicates are collapsed while PRESERVING ORDER: the picker can emit the
        same id twice on a slow connection, and `event_crew_unique_member` would
        turn that into an IntegrityError on a save that was entirely reasonable.
        """
        event = self._owned(event_id=event_id, actor_id=actor_id)

        seen: set[str] = set()
        ordered: list[str] = []
        for raw in member_ids:
            key = str(raw)
            if key not in seen:
                seen.add(key)
                ordered.append(key)

        if len(ordered) > self.MAX_LINEUP:
            raise InvalidInputError(
                f"An event can list at most {self.MAX_LINEUP} people on its lineup."
            )

        owned = self._crew.owned_ids(
            organization_id=event.organization_id, member_ids=list(ordered)
        )
        missing = [key for key in ordered if key not in owned]
        if missing:
            raise InvalidInputError(
                "Some of those people are not on this organisation's crew list."
            )

        with UnitOfWork():
            self._lineups.replace_for_event(event_id=event.id, member_ids=ordered)

        # AFTER commit, and only when the event is actually public — the same
        # rule every other content write here follows. Editing a draft's lineup
        # must not orphan every cached listing page on the platform.
        self._invalidate_if_public(event)
        return self._lineups.for_event(event.id)

    def list_event_crew(self, *, event_id: uuid.UUID | str, actor_id: uuid.UUID | str) -> list:
        """The owner's view of a lineup — used by the studio's picker."""
        event = self._owned(event_id=event_id, actor_id=actor_id)
        return self._lineups.for_event(event.id)

    def _owned(self, *, event_id: uuid.UUID | str, actor_id: uuid.UUID | str) -> Event:
        event = self._events.get_active_by_id(event_id)
        if event is None:
            raise EventNotFoundError(str(event_id))
        if event.organization.owner_id != actor_id:
            # NotFound, not PermissionDenied — a 403 confirms the event exists
            # to anyone guessing ids.
            raise EventNotFoundError(str(event_id))
        return event

    def get_schedule(self, *, event_id: uuid.UUID | str, actor_id: uuid.UUID | str) -> Event:
        """The event's window and lock token, for an owner who may have a stale one.

        Owner-scoped and never cached (`private, no-store` at the view), for
        the same reason the organizer's ticket-type read is not the public one:
        `version` is an optimistic-lock token, and a token read from a shared
        cache may be one save behind. A stale version here is not a stale
        figure on a screen — it is a 409 the wizard answers by RELOADING, so
        the organiser edits, saves, is reset, and never learns why.

        See `EventScheduleSerializer` for why a client needs to ask this at all.
        """
        return self._owned(event_id=event_id, actor_id=actor_id)

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
        # False for every image kind: their shape is settled by `MEDIA_SPECS`
        # at upload and they are drawn in a fixed frame. Only a video embed can
        # be vertical in a way nothing downstream could otherwise discover.
        is_vertical = False
        if kind == MediaKind.VIDEO:
            # NORMALISED, not merely validated. The URL stored is one we build
            # from an extracted id, so a crafted `youtube.com/embed/...?x=` can
            # never survive the round trip into an iframe on our own origin —
            # the same class of problem SVG uploads are, handled the same way.
            from core.video_embeds import parse_video_url

            # Both halves of the parse are kept. The embed URL is what the
            # iframe loads; `is_vertical` is the ONLY moment a Short is
            # distinguishable, because the URL it produces is identical to a
            # normal video's and the pasted link is deliberately not stored.
            embed = parse_video_url(url)
            url = embed.embed_url
            is_vertical = embed.is_vertical
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
                is_vertical=is_vertical,
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

        # PER KIND, not one spec for all of them. The hero, the filmstrip and
        # the lightbox really do share one widescreen frame — but `MOBILE` does
        # not: its whole job is the picture somebody sees on a phone, where the
        # card is taller than it is wide, and forcing it landscape made the one
        # slot named for mobile the one slot that could not be.
        #
        # An unlisted kind falls back to the landscape spec (see `MEDIA_SPECS`).
        from .repositories import MEDIA_SPECS

        content_type = validate_image(
            upload, spec=MEDIA_SPECS.get(MediaKind(kind), EVENT_IMAGE_SPEC)
        )
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
            # ── AND THE SHAPES HAVE TO MATCH ──────────────────────────────
            #
            # The cap re-check above exists because a row uploaded as `gallery`
            # and PATCHed to `hero` would otherwise skip the create path's cap.
            # The SPEC has exactly the same hole and no equivalent guard: a
            # landscape image moved to `mobile` would sit in the portrait slot
            # having never been measured against it, and by then the bytes are
            # gone — there is nothing left to re-validate.
            #
            # So a move BETWEEN SHAPES is refused, naming the fix. Moves within
            # one shape (gallery -> hero) stay free, which is every move an
            # organizer actually makes from the studio.
            from core.uploads import EVENT_IMAGE_SPEC

            from .repositories import MEDIA_SPECS

            before = MEDIA_SPECS.get(MediaKind(media.kind), EVENT_IMAGE_SPEC)
            after = MEDIA_SPECS.get(MediaKind(kind), EVENT_IMAGE_SPEC)
            if before is not after:
                raise InvalidInputError(
                    f"A {before.label} cannot become a {after.label} — they are different "
                    f"shapes, and this image was only ever checked against the first. "
                    f"Upload it again in the new slot."
                )

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

    # ---------------------------------------------------------- questions

    #: The brief's cap, and a real one: a checkout that asks six questions is a
    #: checkout people leave. Enforced here rather than in the database for the
    #: same reason `MEDIA_LIMITS` is — it is a product policy, not an invariant
    #: the data would be corrupt without.
    MAX_QUESTIONS = 5

    def list_questions(self, *, event_id: uuid.UUID | str, actor_id: uuid.UUID | str):
        """The organiser's own view — every live question, in their order."""
        event = self._owned(event_id=event_id, actor_id=actor_id)
        return self._content.questions_for(event.id)

    def add_question(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        prompt: str,
        kind: str,
        help_text: str = "",
        choices: list[str] | None = None,
        is_required: bool = False,
        position: int = 0,
    ):
        event = self._owned(event_id=event_id, actor_id=actor_id)
        if not prompt.strip():
            raise InvalidInputError("A question needs something to ask.")

        if self._content.count_questions(event.id) >= self.MAX_QUESTIONS:
            raise InvalidInputError(
                f"An event can ask at most {self.MAX_QUESTIONS} questions. "
                "Remove one to add another."
            )

        cleaned = self._clean_choices(kind, choices)

        with UnitOfWork():
            question = self._content.add_question(
                event_id=event.id,
                prompt=prompt.strip(),
                help_text=help_text.strip(),
                kind=kind,
                choices=cleaned,
                is_required=is_required,
                position=position,
            )
            self._invalidate_if_public(event)
        return question

    def update_question(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        question_id: uuid.UUID | str,
        changes: dict,
    ):
        event = self._owned(event_id=event_id, actor_id=actor_id)
        applied = _applied(changes, _EDITABLE_QUESTION_FIELDS)
        if "prompt" in applied and not applied["prompt"].strip():
            raise InvalidInputError("A question needs something to ask.")

        # The kind decides whether choices mean anything, so BOTH have to be
        # considered together — even when only one of them is being changed.
        # Editing a `choice` question's options without re-reading its kind, or
        # switching kind without clearing the options, leaves a row whose
        # `choices` contradict its `kind`, and the renderer trusts the kind.
        if "kind" in applied or "choices" in applied:
            existing = self._content.get_question(event_id=event.id, question_id=question_id)
            if existing is None:
                raise EventNotFoundError(str(question_id))
            kind = applied.get("kind", existing.kind)
            applied["kind"] = kind
            applied["choices"] = self._clean_choices(kind, applied.get("choices", existing.choices))

        if "prompt" in applied:
            applied["prompt"] = applied["prompt"].strip()
        if "help_text" in applied:
            applied["help_text"] = applied["help_text"].strip()

        with UnitOfWork():
            updated = self._content.update_question(
                event_id=event.id, question_id=question_id, changes=applied
            )
            if updated is None:
                raise EventNotFoundError(str(question_id))
            self._invalidate_if_public(event)
        return updated

    def remove_question(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        question_id: uuid.UUID | str,
    ) -> None:
        """Retire a question. SOFT, always.

        `BookingAnswer.question` is `PROTECT`ed, so a hard delete of a question
        somebody has answered would raise an IntegrityError — and even if it
        did not, it would leave the answer as a value with no prompt, which an
        organiser reading their export cannot act on.
        """
        event = self._owned(event_id=event_id, actor_id=actor_id)
        with UnitOfWork():
            if not self._content.soft_delete_question(question_id):
                raise EventNotFoundError(str(question_id))
            self._invalidate_if_public(event)

    @staticmethod
    def _clean_choices(kind: str, choices: list[str] | None) -> list[str]:
        """Trim, drop blanks, collapse duplicates — and refuse an empty set.

        A `CHOICE` question with no options is a control with nothing to pick,
        which renders as a dead dropdown at a checkout. Every other kind stores
        an empty list: options on a yes/no question are options nothing reads,
        and leaving them would let a kind change resurrect stale ones.
        """
        if kind != QuestionKind.CHOICE:
            return []
        cleaned: list[str] = []
        for option in choices or []:
            text = option.strip()
            if text and text not in cleaned:
                cleaned.append(text)
        if len(cleaned) < 2:
            raise InvalidInputError(
                "A multiple-choice question needs at least two options to choose between."
            )
        return cleaned

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
        # from the slots that carry one.
        ends = [slot.ends_at for slot in active if slot.ends_at]
        if ends:
            # Always AFTER the derived start: the latest end belongs to some
            # active slot, that slot's own end is validated to be after its
            # own start, and its start cannot precede `earliest`. So this
            # branch can never invert the pair.
            if event.ends_at != max(ends):
                window["ends_at"] = max(ends)
        elif event.ends_at is not None and event.ends_at <= earliest:
            # ── THE THIRD WRITE PATH, AND THE ONE THAT COULD INVERT ───────
            #
            # With no slot carrying an end, this used to leave the event's own
            # `ends_at` exactly as the organiser set it — which is right in
            # general and wrong precisely when the sessions have moved the
            # START past that stored end:
            #
            #     event  10:00-12:00, then one active session is added at
            #     20:00 with no end  ->  starts_at := 20:00, ends_at stays
            #     12:00, and the event now ends eight hours before it begins.
            #
            # Reachable through the ordinary sessions editor, with no
            # serializer anywhere in the path. It is also the one write that
            # the new `event_ends_after_starts` constraint would turn from a
            # silently bad row into an IntegrityError — a 500 on a save that
            # looked reasonable — so it has to be handled here rather than
            # left for the database to refuse.
            #
            # The stored end is CLEARED rather than shifted. Once an event has
            # sessions the sessions ARE the schedule (see the docstring), so an
            # end time that predates the first session is stale rather than
            # merely wrong, and none of the sessions says when this one
            # finishes. NULL is a state the column is nullable for and every
            # consumer already handles; inventing a finish time would put a
            # fabricated date in front of the settlement gate.
            window["ends_at"] = None
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


class CrewService:
    """An organization's crew roster — the people it can put on a stage.

    Its own service rather than more methods on `EventContentService`, for the
    same reason `AccountAdminService` is separate from `AuthService`: every
    method there acts on ONE EVENT and is authorised by that event's owner,
    while every method here acts on an ORGANIZATION and is authorised by the
    organization's owner. Folding them together would mean one class holding two
    different answers to "who is allowed to do this".

    OWNERSHIP IS CHECKED HERE, not in a DRF permission, and it is checked by
    SCOPING THE QUERY rather than by fetching-then-comparing: `get_owned` and
    `update_owned` filter on `organization_id`, so a row belonging to somebody
    else is never loaded at all. A 404 rather than a 403, so a guessed uuid
    cannot be used to confirm that a row exists.
    """

    #: A roster, not a directory. High enough that no real organizer meets it,
    #: low enough that an unbounded write loop cannot fill a table.
    MAX_ROSTER = 200

    def __init__(
        self,
        *,
        organizations: OrganizationRepository,
        crew: CrewMemberRepository | None = None,
        storage: StoragePort | None = None,
    ) -> None:
        self._organizations = organizations
        self._crew = crew or CrewMemberRepository()
        self._storage = storage

    def _owned_organization(self, *, organization_id, actor_id) -> Organization:
        organization = self._organizations.get_active_by_id(organization_id)
        if organization is None or str(organization.owner_id) != str(actor_id):
            raise CrewOrganizationNotFoundError("Organization not found.")
        return organization

    def list_roster(self, *, organization_id, actor_id, active_only: bool = False) -> list:
        self._owned_organization(organization_id=organization_id, actor_id=actor_id)
        return self._crew.list_for_organization(organization_id, active_only=active_only)

    def add_member(
        self,
        *,
        organization_id,
        actor_id,
        name: str,
        role: str = "",
        details: str = "",
        photo_url: str = "",
        photo_alt_text: str = "",
    ) -> CrewMember:
        organization = self._owned_organization(organization_id=organization_id, actor_id=actor_id)
        if self._crew.count_for_organization(organization.id) >= self.MAX_ROSTER:
            raise InvalidInputError(
                f"This organisation already has {self.MAX_ROSTER} crew members."
            )
        return self._crew.create_member(
            organization_id=organization.id,
            name=name.strip(),
            role=role.strip(),
            details=details,
            photo_url=photo_url,
            photo_alt_text=photo_alt_text,
        )

    def add_member_with_photo(
        self,
        *,
        organization_id,
        actor_id,
        name: str,
        role: str = "",
        details: str = "",
        upload=None,
        content_type: str = "",
        alt_text: str = "",
    ) -> CrewMember:
        """Create the person, then put their portrait on them.

        CREATE FIRST, UPLOAD SECOND, and deliberately in that order: the
        storage key is scoped by member id (`crew/{org}/{member}/...`), so
        there is nothing to name an object after until the row exists.

        A failed upload therefore leaves a member with no photo rather than no
        member. That is the recoverable half of the two outcomes — the
        organizer sees the person on the roster and can attach a picture from
        the existing photo endpoint — where the reverse would leave a stored
        object nothing references and the name they typed lost.

        Not wrapped in a transaction spanning both, because the upload is a
        network round trip and this codebase does not hold a transaction open
        across one (the rule `attach_photo` states directly above).
        """
        member = self.add_member(
            organization_id=organization_id,
            actor_id=actor_id,
            name=name,
            role=role,
            details=details,
        )
        if upload is None:
            return member
        return self.attach_photo(
            organization_id=organization_id,
            actor_id=actor_id,
            member_id=member.id,
            upload=upload,
            content_type=content_type,
            alt_text=alt_text,
        )

    def update_member(self, *, organization_id, actor_id, member_id, **changes) -> CrewMember:
        organization = self._owned_organization(organization_id=organization_id, actor_id=actor_id)
        updated = self._crew.update_owned(
            organization_id=organization.id, member_id=member_id, **changes
        )
        if updated is None:
            raise CrewMemberNotFoundError("Crew member not found.")
        return updated

    def remove_member(self, *, organization_id, actor_id, member_id) -> None:
        """Retire somebody from the roster.

        REFUSED while they are on any lineup, with a message that names the
        alternative. `EventCrew.member` is `PROTECT`, so the database would stop
        this anyway — but it would stop it as an IntegrityError, and an operator
        deserves to be told that the person is on an event and that deactivating
        them is the thing they actually want.
        """
        organization = self._owned_organization(organization_id=organization_id, actor_id=actor_id)
        member = self._crew.get_owned(organization_id=organization.id, member_id=member_id)
        if member is None:
            raise CrewMemberNotFoundError("Crew member not found.")
        if self._crew.is_on_any_lineup(member.id):
            raise CrewMemberInUseError(
                "This person appears on an event's lineup. Deactivate them instead, "
                "which keeps those events intact and hides them from new ones."
            )
        self._crew.soft_delete_owned(organization_id=organization.id, member_id=member.id)

    def attach_photo(
        self, *, organization_id, actor_id, member_id, upload, content_type: str, alt_text: str
    ):
        """Store a portrait and put it on the roster row.

        THE UPLOAD HAPPENS BEFORE ANY TRANSACTION OPENS, which is the rule
        every other external call in this codebase follows: a DB transaction
        should not be held open across a network round trip, and if the storage
        write succeeds but the row update then fails, the orphaned object is
        harmless.
        """
        organization = self._owned_organization(organization_id=organization_id, actor_id=actor_id)
        member = self._crew.get_owned(organization_id=organization.id, member_id=member_id)
        if member is None:
            raise CrewMemberNotFoundError("Crew member not found.")
        if self._storage is None:  # pragma: no cover - wiring guard
            raise InvalidInputError("Photo uploads are not configured.")

        key = f"crew/{organization.id}/{member.id}/{uuid.uuid4().hex}"
        url = self._storage.upload(path=key, content=upload.read(), content_type=content_type)
        return self.update_member(
            organization_id=organization.id,
            actor_id=actor_id,
            member_id=member.id,
            photo_url=url,
            photo_alt_text=alt_text,
        )

    def describe_photo(self, *, organization_id, actor_id, member_id, alt_text: str) -> CrewMember:
        """Correct a portrait's alt text WITHOUT re-uploading the bytes.

        Alt text is collected before the upload, which is the right order — text
        written while looking at the picker is real alt text where a field
        appended to a finished grid gets "image1". The cost of that order is
        that a typo could only be fixed by choosing the file again, so somebody
        who noticed one after the fact either re-uploaded a duplicate object or
        left the wrong description on the page. This is the correction path.

        It REFUSES when there is no photo, rather than storing a description of
        nothing: `photo_alt_text` beside an empty `photo_url` would be a row
        describing an image that does not exist, and the next upload would
        silently overwrite it anyway.
        """
        organization = self._owned_organization(organization_id=organization_id, actor_id=actor_id)
        member = self._crew.get_owned(organization_id=organization.id, member_id=member_id)
        if member is None:
            raise CrewMemberNotFoundError("Crew member not found.")
        if not member.photo_url:
            raise InvalidInputError("There is no photo to describe. Upload one first.")
        return self.update_member(
            organization_id=organization.id,
            actor_id=actor_id,
            member_id=member.id,
            photo_alt_text=alt_text,
        )

    def remove_photo(self, *, organization_id, actor_id, member_id) -> CrewMember:
        """Take the portrait off a roster row.

        ── THE ROW IS CLEARED; THE OBJECT IS LEFT ────────────────────────────

        `StoragePort` has no `delete`, and adding one for this would be the
        wrong first caller. Every other place this codebase replaces an image
        (a poster, an organisation logo, a previous crew photo) already leaves
        the old object behind — the key carries a uuid, so nothing is ever
        overwritten in place — and a delete here would be the only path that
        also destroys bytes. Orphaned objects are a storage-lifecycle concern
        with one honest fix (a bucket rule over the `crew/` prefix), not
        something to bolt onto a request that must not fail halfway.

        What matters to the reader is the ROW, and clearing both columns
        together is what keeps them consistent: a `photo_alt_text` left behind
        would describe an image nobody can see, and `RemoteImage` would fall
        back to initials while a screen reader announced a photograph.

        Idempotent. A member with no photo is returned unchanged rather than
        404ing — a double-press, or two open tabs, is not an error, and this is
        the same "clamped, so a repeat is a safe no-op" rule the ticketing
        release primitive follows.
        """
        organization = self._owned_organization(organization_id=organization_id, actor_id=actor_id)
        member = self._crew.get_owned(organization_id=organization.id, member_id=member_id)
        if member is None:
            raise CrewMemberNotFoundError("Crew member not found.")
        if not member.photo_url:
            return member
        return self.update_member(
            organization_id=organization.id,
            actor_id=actor_id,
            member_id=member.id,
            photo_url="",
            photo_alt_text="",
        )


# ── The waiting list for a sold-out event ───────────────────────────────────

#: The `notifications.NotificationType` value a waitlist alert renders as.
#:
#: Declared HERE because this module is what asks for it; `notifications` holds
#: the matching enum member and the template. The literals must agree, and
#: `test_waitlist.py` asserts this value so a change on either side has
#: somewhere to fail — the same wiring `announcements` uses.
WAITLIST_NOTIFICATION_TYPE = "waitlist_available"

WAITLIST_NOTIFY_TASK = "events.waitlist_notify"

#: How many people are told per available ticket.
#:
#: NOT one. A notified person is a candidate, not a holder: nothing is reserved
#: for them, and most people who are emailed do not buy. Telling exactly one
#: person per seat means a seat sits unsold while its single candidate is
#: asleep. Three is enough that a freed seat usually finds a buyer and small
#: enough that the disappointed are few.
#:
#: A HELD allocation per person — a real claim window — is the other design,
#: and it is deliberately not this one: it would reserve inventory against
#: somebody who has not opened their email, which is the same harm the funnel
#: reserves LATE to avoid, at a scale of hours instead of minutes.
WAITLIST_NOTIFY_PER_SEAT = 3

#: A hard ceiling per event per sweep, whatever the arithmetic above says.
#:
#: An organizer releasing 500 extra tickets should not turn one tick into 1,500
#: renders and claims. The rest are told on the next sweep, which is two
#: minutes away.
WAITLIST_MAX_BATCH = 100

#: Events looked at per sweep, soonest first.
WAITLIST_MAX_EVENTS_PER_SWEEP = 50


class WaitlistNotifier(Protocol):
    """The one method this module uses from `NotificationService`.

    Structural and injected, for the two reasons `announcements.Notifier`
    gives: it keeps the dependency one-way and explicit — events asks
    notifications to send, and nothing in notifications knows this list exists
    — and it lets the fan-out be tested against a recording double rather than
    against another module's template registry.
    """

    def notify(
        self,
        *,
        notification_type: str,
        recipient: str,
        context: dict,
        dedupe_key: str,
        delay_seconds: int = 0,
    ) -> Any: ...


class OrganizerCategoryService:
    """An organization's own category labels, and the picker they appear in.

    Its own service rather than more methods on `EventService`, for exactly
    the reason `CrewService` gives: every method on `EventService` acts on ONE
    EVENT and is authorised by that event's owner, while every method here
    acts on an ORGANIZATION and is authorised by the organization's owner.

    Ownership is checked HERE, not in a DRF permission, and by SCOPING THE
    QUERY rather than fetching-then-comparing — `get_owned` and `update_owned`
    filter on `organization_id`, so a row belonging to somebody else is never
    loaded at all. A 404 rather than a 403, so a guessed uuid cannot be used
    to confirm a row exists.
    """

    #: A vocabulary, not a tagging system. High enough that no real organizer
    #: meets it, low enough that an unbounded write loop cannot fill a table.
    #: The same reasoning and the same order of magnitude as
    #: `CrewService.MAX_ROSTER`.
    MAX_CATEGORIES = 50

    def __init__(
        self,
        *,
        organizations: OrganizationRepository,
        categories: OrganizerCategoryRepository | None = None,
        storage: StoragePort | None = None,
    ) -> None:
        self._organizations = organizations
        self._categories = categories or OrganizerCategoryRepository()
        self._storage = storage

    # ------------------------------------------------------------- helpers

    def _owned_organization(self, *, organization_id, actor_id) -> Organization:
        organization = self._organizations.get_active_by_id(organization_id)
        if organization is None or str(organization.owner_id) != str(actor_id):
            raise CrewOrganizationNotFoundError("Organization not found.")
        return organization

    @staticmethod
    def _slug_for(label: str) -> str:
        """A slug for one organization's own list, never a public URL.

        `event_slug` is not reused: it is sized for `Event.slug` (80) and this
        column is 60, and the two are unrelated things that would then have to
        move together. Truncation is belt-and-braces — `label` is capped at 60
        and slugify never lengthens a string — but a `DataError` on a write
        path is not worth saving two lines.
        """
        return slugify(label, allow_unicode=False)[:60].strip("-")

    # ---------------------------------------------------------------- read

    def list_for_organization(
        self, *, organization_id, actor_id, active_only: bool = False
    ) -> list[OrganizerCategory]:
        self._owned_organization(organization_id=organization_id, actor_id=actor_id)
        return self._categories.list_for_organization(organization_id, active_only=active_only)

    def picker(self, *, organization_id, actor_id) -> dict:
        """Everything an organizer may choose from, global and their own, at once.

        ── ONE REQUEST, TWO KINDS, AND THE KINDS STAY LABELLED ───────────────

        The wizard needs a single list to render, so this returns one — but
        every row carries `source`, because the two halves are genuinely
        different and a client that cannot tell them apart will get something
        wrong. A global category is a browse facet: it is what
        `event_status_category_idx` indexes, what the landing pages are built
        from, and it writes to `Event.category`. A custom one is a private
        label that writes to `Event.custom_category` and never reaches a
        browse filter. Flattening them into an undifferentiated list would
        invite a client to send "sufi-night" as `category` and get a 400 it
        could not explain.

        ── WHY GLOBAL ROWS CARRY NO `image_url` ──────────────────────────────

        Their artwork is BUNDLED — one illustrated scene per slug, drawn in
        the frontend and keyed on exactly these nine values. There is no
        stored asset to point at, and minting URLs for pictures that already
        ship in the bundle would add a fetch, a cache and a broken-image state
        to a picker that currently cannot fail. `image_url` is therefore ""
        for every global row and the client draws its own illustration by
        `slug`, which is what it already does.

        Custom rows are the opposite case and that is the whole reason the
        column exists: nothing bundled can ever draw "Sufi night", so without
        a stored image such a row could only ever render as text.
        """
        organization = self._owned_organization(organization_id=organization_id, actor_id=actor_id)
        globals_ = [
            {
                "id": None,
                "slug": value,
                "label": label,
                "image_url": "",
                "image_alt_text": "",
                "source": "global",
                "is_active": True,
            }
            for value, label in EventCategory.choices
        ]
        custom = [
            {
                "id": row.id,
                "slug": row.slug,
                "label": row.label,
                "image_url": row.image_url,
                "image_alt_text": row.image_alt_text,
                "source": "organizer",
                "is_active": row.is_active,
            }
            # ACTIVE ONLY: this is the picker for a NEW event, and a retired
            # category is exactly the thing that should not be offered on one.
            # The management list (`list_for_organization`) still shows it, so
            # it can be brought back.
            for row in self._categories.list_for_organization(organization.id, active_only=True)
        ]
        return {"data": globals_ + custom}

    # --------------------------------------------------------------- write

    def add_category(
        self,
        *,
        organization_id,
        actor_id,
        label: str,
        image_url: str = "",
        image_alt_text: str = "",
    ) -> OrganizerCategory:
        """Save what an organizer typed, for them alone.

        TYPING THE SAME WORD TWICE RETURNS THE ROW THEY ALREADY HAVE rather
        than refusing. This is a free-text box on a wizard step somebody is
        moving through quickly; a 409 on "Sufi night" because they created it
        for last month's event is a dead end that teaches nothing, and the
        outcome they wanted — a category by that name on their list — is
        already true. The unique constraint remains the real guard against a
        concurrent double-submit; this is the friendly path in front of it.
        """
        organization = self._owned_organization(organization_id=organization_id, actor_id=actor_id)
        label = label.strip()
        if not label:
            raise InvalidInputError("A category needs a name.")
        slug = self._slug_for(label)
        if not slug:
            # A label that ASCII-slugifies to nothing — Devanagari, Tamil, an
            # emoji. `event_slug` may return "" because a bare uuid URL is a
            # fine fallback there; here the slug is the UNIQUENESS KEY within
            # the organization, so an empty one would collide with every other
            # non-Latin label they ever add.
            raise InvalidInputError(
                "A category name needs at least one letter or number that can be "
                "written in the Latin alphabet."
            )

        existing = self._categories.get_owned_by_slug(organization_id=organization.id, slug=slug)
        if existing is not None:
            return existing

        if self._categories.count_for_organization(organization.id) >= self.MAX_CATEGORIES:
            raise InvalidInputError(
                f"This organisation already has {self.MAX_CATEGORIES} custom categories."
            )
        try:
            return self._categories.create_category(
                organization_id=organization.id,
                label=label,
                slug=slug,
                image_url=image_url,
                image_alt_text=image_alt_text,
            )
        except IntegrityError:
            # Lost a race with a concurrent identical submit — the double-tap
            # the unique constraint exists for. The winner's row is the answer
            # to the question this call asked, so return it rather than
            # surfacing a database error for something that succeeded.
            winner = self._categories.get_owned_by_slug(organization_id=organization.id, slug=slug)
            if winner is None:  # pragma: no cover - the row must exist by now
                raise
            return winner

    def update_category(
        self, *, organization_id, actor_id, category_id, **changes
    ) -> OrganizerCategory:
        """Rename or retire a category.

        A RENAME MOVES THE SLUG WITH IT, which is safe here and would not be
        on `Event.slug`: nothing links to a category by slug, no email carries
        one, and `Event.custom_category` is a foreign key to the ROW — so the
        events already carrying it follow the rename automatically and no
        printed or shared URL breaks. That is the opposite of the coupon rule
        ("the terms stay editable, the CODE does not"), and for the opposite
        reason: a coupon code is something a customer holds in their hand.
        """
        organization = self._owned_organization(organization_id=organization_id, actor_id=actor_id)
        if "label" in changes:
            label = (changes["label"] or "").strip()
            if not label:
                raise InvalidInputError("A category needs a name.")
            slug = self._slug_for(label)
            if not slug:
                raise InvalidInputError(
                    "A category name needs at least one letter or number that can be "
                    "written in the Latin alphabet."
                )
            clash = self._categories.get_owned_by_slug(organization_id=organization.id, slug=slug)
            if clash is not None and str(clash.id) != str(category_id):
                raise InvalidInputError("You already have a category with that name.")
            changes["label"] = label
            changes["slug"] = slug

        updated = self._categories.update_owned(
            organization_id=organization.id, category_id=category_id, **changes
        )
        if updated is None:
            raise OrganizerCategoryNotFoundError("Category not found.")
        return updated

    def remove_category(self, *, organization_id, actor_id, category_id) -> None:
        """Retire a category from the list.

        REFUSED while any event carries it, with a message that names the
        alternative — `Event.custom_category` is `PROTECT`, so the database
        would stop this anyway, but as an IntegrityError rather than as
        something an organizer can act on.
        """
        organization = self._owned_organization(organization_id=organization_id, actor_id=actor_id)
        category = self._categories.get_owned(
            organization_id=organization.id, category_id=category_id
        )
        if category is None:
            raise OrganizerCategoryNotFoundError("Category not found.")
        if self._categories.is_on_any_event(category.id):
            raise OrganizerCategoryInUseError(
                "This category is on at least one of your events. Deactivate it "
                "instead, which keeps those events intact and hides it from new ones."
            )
        self._categories.soft_delete_owned(organization_id=organization.id, category_id=category.id)

    def attach_image(
        self, *, organization_id, actor_id, category_id, upload, content_type: str, alt_text: str
    ) -> OrganizerCategory:
        """Store a picture and put it on the category row.

        THE UPLOAD HAPPENS BEFORE ANY TRANSACTION OPENS — the rule every other
        external call in this codebase follows. If the storage write succeeds
        and the row update then fails, the orphaned object is harmless; a
        transaction held open across a network round trip is not.

        The URL written is the one the storage adapter returns, never a string
        a client handed us. That is what keeps `image_url` a pointer into our
        own bucket instead of an unvalidated remote image, which is the
        objection `cms.Category.icon` records against URLs in the first place.
        """
        organization = self._owned_organization(organization_id=organization_id, actor_id=actor_id)
        category = self._categories.get_owned(
            organization_id=organization.id, category_id=category_id
        )
        if category is None:
            raise OrganizerCategoryNotFoundError("Category not found.")
        if self._storage is None:  # pragma: no cover - wiring guard
            raise InvalidInputError("Image uploads are not configured.")

        key = f"categories/{organization.id}/{category.id}/{uuid.uuid4().hex}"
        url = self._storage.upload(path=key, content=upload.read(), content_type=content_type)
        return self.update_category(
            organization_id=organization.id,
            actor_id=actor_id,
            category_id=category.id,
            image_url=url,
            image_alt_text=alt_text,
        )


class WaitlistService:
    """Join, leave, and tell people when tickets come back.

    ── THE TRIGGER IS A SWEEPER, NOT THE MONEY PATH ────────────────────────

    Nothing in `ticketing.release` calls this, and that is a decision rather
    than an omission. Three reasons, in order of weight:

    1. **Seats come back on paths that are not `release` at all.** An organizer
       raising a tier's quantity, a refund voiding tickets, an operator editing
       a row — a trigger hung off the reserve/release transaction would silently
       miss every one of them. That is precisely the "it only works when
       something arrives" failure `payments.reconcile_pending` exists to answer.
    2. **The question is EVENT-level and `release` only knows a TIER.** A tier
       going from nought to some is not the same fact as an event having seats,
       so a tier-level signal would be an approximate trigger for a question
       this job has to re-ask anyway.
    3. **It would put a fan-out concern on the platform's most carefully bounded
       transaction** — the one whose lock window is documented down to the
       statement — to buy about a minute of latency on an email.

    ── AND IT MARKS AFTER IT SENDS, NEVER BEFORE ───────────────────────────

    A crash between the two costs a repeated ATTEMPT, which the notification
    ledger dedupes into nothing. Marking first would cost a message nobody ever
    receives, and there would be no trace that it had not been sent.
    """

    def __init__(
        self,
        *,
        waitlist: EventWaitlistRepository,
        events: EventRepository,
        notifier: WaitlistNotifier,
    ) -> None:
        self._waitlist = waitlist
        self._events = events
        self._notifier = notifier

    # ── the customer's side ─────────────────────────────────────────────────

    def join(self, *, user_id, event_id) -> bool:
        """Put somebody on the list. Idempotent; True when newly added.

        ── IT DOES NOT REFUSE WHEN TICKETS ARE AVAILABLE ───────────────────

        Tempting, and wrong twice. `tickets_available` is a cached DISPLAY
        denormal, so refusing on it would be deciding from a cache — the thing
        every money-adjacent path in this codebase is built not to do. And
        availability is a moving target: the last seat routinely goes between
        the page rendering and the press, so a refusal would fail for exactly
        the people this list is for. Joining while seats exist is harmless —
        the sweeper tells them, which is redundant rather than wrong.

        It DOES refuse for an event nobody can book: a draft, a cancelled show,
        one that has finished. Collecting an intention to attend something that
        cannot be attended is a promise with nothing behind it.
        """
        event = self._events.get_published_by_id(event_id)
        if event is None:
            raise EventNotFoundError(str(event_id))
        return self._waitlist.join(user_id=user_id, event_id=event.id)

    def leave(self, *, user_id, event_id) -> bool:
        """Take somebody off. A no-op if they were not on it — the caller's
        intent is "I should not be on this list", which is true either way."""
        return self._waitlist.leave(user_id=user_id, event_id=event_id)

    def forget_for_booking(self, *, user_id, event_id) -> bool:
        """They bought. Take them off the list.

        Called from this module's `BOOKING_CONFIRMED` observer, which is why
        `events` still does not import `booking`: it reacts to a domain event
        rather than reaching across.

        Without it, somebody who bought while the page said sold out — a hold
        lapsed under them and they refreshed — stays on the list un-notified,
        and is later emailed "tickets are available" for an event they already
        have a ticket to. Which reads as the platform not knowing what it sold.
        """
        return self._waitlist.leave(user_id=user_id, event_id=event_id)

    # ── the sweeper ─────────────────────────────────────────────────────────

    def notify_available(
        self,
        *,
        event_limit: int = WAITLIST_MAX_EVENTS_PER_SWEEP,
        cooldown_minutes: int | None = None,
    ) -> int:
        """Tell the next batch on every event that has seats again.

        Returns how many people were told. Cheap on an empty result set — one
        indexed query that finds nothing — which is what lets the schedule run
        it every two minutes.
        """
        now = timezone.now()
        cooldown = (
            settings.WAITLIST_NOTIFY_COOLDOWN_MINUTES
            if cooldown_minutes is None
            else cooldown_minutes
        )
        cooldown_before = now - timedelta(minutes=cooldown)

        event_ids = self._waitlist.events_awaiting_notification(
            now=now, cooldown_before=cooldown_before, limit=event_limit
        )

        # ── AND ONLY THE ONES SOMEBODY CAN ACTUALLY BUY FROM ────────────
        #
        # `Event.tickets_available` is `Sum(quantity - sold - reserved)` across
        # every tier and knows nothing about a sale window, so an event whose
        # only remaining tier opens next month reports a positive number and
        # sells nothing. This message is nothing but a call to action; sending
        # it about seats nobody can buy is worse than sending nothing.
        #
        # Read through `ticketing`'s repository rather than by importing
        # `TicketType` — the same one-way seam `duplicate_event` uses, so
        # `events` still knows nothing about tiers. One query for the whole
        # candidate page.
        if event_ids:
            from apps.ticketing.repositories import TicketTypeRepository

            buyable = TicketTypeRepository().event_ids_with_buyable_inventory(event_ids, now=now)
            event_ids = [event_id for event_id in event_ids if event_id in buyable]

        told = 0
        for event_id in event_ids:
            told += self._notify_one_event(event_id, now=now)
        if told:
            logger.info("waitlist.notified", extra={"count": told, "events": len(event_ids)})
        return told

    def _notify_one_event(self, event_id, *, now) -> int:
        event = self._events.get_published_by_id(event_id)
        if event is None:
            # It stopped being bookable between the candidate query and here.
            # Nothing to say, and saying it would be worse than silence.
            return 0

        available = event.tickets_available or 0
        allowance = min(available * WAITLIST_NOTIFY_PER_SEAT, WAITLIST_MAX_BATCH)
        if allowance < 1:
            return 0

        batch = self._waitlist.pending_for_event(event_id=event.id, limit=allowance)
        if not batch:
            return 0

        # `notifications` owns the ONE way an event's start time is written for
        # a human — it is documented there as exactly that, because the ticket
        # email and the ticket PDF once disagreed with the event page by five
        # and a half hours. Formatting it a second way here is how that comes
        # back. Imported lazily so this module still has no notifications
        # import at module scope; the SENDING dependency is the injected
        # `WaitlistNotifier` protocol and stays that way.
        from apps.notifications.templates import format_when

        site = str(getattr(settings, "PUBLIC_SITE_URL", "") or "").rstrip("/")
        context = {
            "event_title": event.title,
            "event_when": format_when(event.starts_at),
            "event_where": f"{event.venue}, {event.city}",
            # Blank rather than a guess when the origin is unset: a call to
            # action pointing at the wrong host is worse than none, and this
            # message is nothing BUT a call to action.
            "url": f"{site}/events/{event.id}" if site else "",
            # What the reader most needs to know, and the one number that keeps
            # this message honest: it is a heads-up, not a reservation.
            "tickets_available": available,
        }

        told = 0
        for entry in batch:
            user = entry.user
            if not user.email:
                continue
            try:
                log = self._notifier.notify(
                    notification_type=WAITLIST_NOTIFICATION_TYPE,
                    recipient=user.email,
                    context={"name": user.full_name, **context},
                    # ── KEYED ON THE USER ID, NOT THE EMAIL ─────────────
                    #
                    # `NotificationLog.dedupe_key` is `CharField(max_length=255)`
                    # and UNIQUE. An address may be 254 characters on its own,
                    # so a key built from one can overflow the column and raise
                    # on insert — for the one person whose address is long,
                    # after the batch is already half sent. A uuid pair is 82
                    # characters whoever it belongs to.
                    #
                    # Per (event, person), so a redelivered task, an overlapping
                    # sweep and a retry after a crash all resolve to ONE
                    # message. Somebody is told about an event exactly once,
                    # which is what the email itself promises.
                    dedupe_key=f"waitlist:{event.id}:{user.id}",
                )
            except Exception:
                # ── ONE BAD ROW MUST NOT STRAND THE REST OF THE BATCH ───
                #
                # `notify` renders before it claims, so a context key a
                # template did not expect raises here — and every fan-out in
                # this codebase loops without isolation, which means one such
                # row silently costs every recipient after it. The entry is
                # left pending on purpose: it is retried on the next sweep, and
                # until it succeeds it is visibly un-notified rather than
                # marked done.
                logger.exception(
                    "waitlist.notify_failed",
                    extra={"event_id": str(event.id), "waitlist_id": str(entry.id)},
                )
                continue
            if log is None:
                # A blank recipient, or a channel this deployment has switched
                # off. Nothing was sent, so nothing is marked — the row stays
                # pending and is skipped again, which is both the right outcome
                # and a visible one.
                continue
            # AFTER the claim, never before. See the class docstring.
            self._waitlist.mark_notified(entry.id, when=now)
            told += 1
        return told
