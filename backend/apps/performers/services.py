"""Business rules for the Hire a Band marketplace.

Three services, split by WHOSE question each answers — the same split
`events` uses, and for the same reason: every method on a service should begin
with the same authorization question, so one can never be skipped by accident.

- `PerformerService` — the owner's. Every method proves the caller owns the
  organisation the profile belongs to.
- `PerformerModerationService` — an operator's. Every method begins by NOT
  asking about ownership, because a platform operator has none.
- `MarketplaceService` — the customer's and the performer's, around briefs and
  quotes. Ownership here is per-object and asked per method.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date

from django.core.files.uploadedfile import UploadedFile
from django.db import IntegrityError

from apps.accounts.repositories import UserRepository
from apps.organizations.exceptions import OrganizationNotFoundError
from apps.organizations.repositories import OrganizationRepository
from core.audit import record_audit
from core.errors import InvalidInputError
from core.events import (
    PERFORMER_APPROVED,
    PERFORMER_CREATED,
    PERFORMER_QUOTE_ACCEPTED,
    PERFORMER_QUOTE_SUBMITTED,
    PERFORMER_REJECTED,
    PERFORMER_REQUEST_CREATED,
    PERFORMER_SUBMITTED_FOR_REVIEW,
)
from core.ports.storage_port import StoragePort
from core.unit_of_work import UnitOfWork
from core.uploads import storage_path, validate_image

from .exceptions import (
    DuplicateQuoteError,
    EnquiryNotFoundError,
    EnquiryWithdrawnError,
    InvalidPerformerStateError,
    NotPerformerOwnerError,
    PerformerNotBookableError,
    PerformerNotFoundError,
    PerformerNotUnderReviewError,
    QuoteNotFoundError,
    RequestClosedError,
    RequestNotFoundError,
    StalePerformerVersionError,
)
from .models import (
    BookingRequest,
    Performer,
    PerformerStatus,
    Quote,
    QuoteStatus,
    RequestKind,
    RequestStatus,
)
from .repositories import (
    BookingRequestRepository,
    PerformerMediaRepository,
    PerformerRepository,
    QuoteRepository,
)

logger = logging.getLogger(__name__)

#: Fields an owner may edit. `status`, `is_featured` and every moderation
#: column are absent on purpose — those are transitions and editorial
#: decisions, never a blind PATCH.
_EDITABLE_FIELDS = (
    "stage_name",
    "performer_type",
    "tagline",
    "bio",
    "city",
    "travel_radius_km",
    "base_price_minor",
    "genres",
    "languages",
    "occasions",
    "experience_years",
    "typical_set_minutes",
    "website_url",
    "instagram_url",
    "youtube_url",
)


class PerformerService:
    def __init__(
        self,
        *,
        performers: PerformerRepository,
        media: PerformerMediaRepository,
        organizations: OrganizationRepository,
        storage: StoragePort,
    ) -> None:
        self._performers = performers
        self._media = media
        self._organizations = organizations
        self._storage = storage

    # --- helpers -----------------------------------------------------------

    def _load_owned(self, *, performer_id: uuid.UUID | str, actor_id: uuid.UUID | str) -> Performer:
        performer = self._performers.get_active_for_write(performer_id)
        if performer is None:
            raise PerformerNotFoundError(str(performer_id))
        if str(performer.organization.owner_id) != str(actor_id):
            raise NotPerformerOwnerError()
        return performer

    # --- commands ----------------------------------------------------------

    def create_performer(
        self,
        *,
        organization_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        stage_name: str,
        performer_type: str,
        city: str,
        **optional,
    ) -> Performer:
        """A new profile, owned by an organisation the caller already owns.

        Reusing `Organization` is the whole point: an organizer who already
        runs events lists a band without a second account, and the operator who
        verified them has already verified this.
        """
        org = self._organizations.get_active_by_id(organization_id)
        if org is None:
            raise OrganizationNotFoundError(str(organization_id))
        if str(org.owner_id) != str(actor_id):
            raise NotPerformerOwnerError()

        fields = {key: value for key, value in optional.items() if key in _EDITABLE_FIELDS}

        with UnitOfWork() as uow:
            performer = self._performers.create(
                organization_id=org.id,
                stage_name=stage_name.strip(),
                performer_type=performer_type,
                city=city.strip(),
                **fields,
            )
            performer.organization = org

            uow.publish(
                PERFORMER_CREATED,
                {
                    "performer_id": str(performer.id),
                    "organization_id": str(org.id),
                    "stage_name": performer.stage_name,
                },
                aggregate_id=str(performer.id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="performer.created",
                target_type="performer",
                target_id=str(performer.id),
            )

        logger.info("performer_created", extra={"performer_id": str(performer.id)})
        return performer

    def update_performer(
        self,
        *,
        performer_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        expected_version: int,
        changes: dict,
    ) -> Performer:
        performer = self._load_owned(performer_id=performer_id, actor_id=actor_id)
        applied = {key: value for key, value in changes.items() if key in _EDITABLE_FIELDS}
        if not applied:
            raise InvalidInputError("Provide at least one field to update.")

        with UnitOfWork():
            if not self._performers.update_if_version_matches(
                performer_id=performer.id, expected_version=expected_version, changes=applied
            ):
                raise StalePerformerVersionError()
            record_audit(
                actor_id=str(actor_id),
                action="performer.updated",
                target_type="performer",
                target_id=str(performer.id),
            )

        return self._reload(performer.id)

    def submit_for_review(
        self, *, performer_id: uuid.UUID | str, actor_id: uuid.UUID | str
    ) -> Performer:
        """Ask an operator to publish this profile.

        The readiness checks are HERE rather than in a view because they are
        the rule, not the presentation: a profile with no photo and no bio is
        one an operator will reject, and catching it now saves a round trip
        through a human.
        """
        performer = self._load_owned(performer_id=performer_id, actor_id=actor_id)

        if performer.status not in (PerformerStatus.DRAFT, PerformerStatus.REJECTED):
            raise InvalidPerformerStateError(
                f"Only a draft or rejected profile can be submitted (this one is "
                f"'{performer.status}')."
            )

        full = self._performers.get_active_by_id(performer.id)
        if full is None:  # pragma: no cover — just deleted mid-request
            raise PerformerNotFoundError(str(performer_id))
        problems = readiness_problems(full, self._media.count_media(full.id))
        if problems:
            raise InvalidInputError(problems[0])

        with UnitOfWork() as uow:
            if not self._performers.submit_for_review(
                performer_id=performer.id, expected_version=performer.version
            ):
                raise StalePerformerVersionError()

            uow.publish(
                PERFORMER_SUBMITTED_FOR_REVIEW,
                {
                    "performer_id": str(performer.id),
                    "organization_id": str(performer.organization_id),
                    "stage_name": performer.stage_name,
                },
                aggregate_id=str(performer.id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="performer.submitted_for_review",
                target_type="performer",
                target_id=str(performer.id),
            )

        return self._reload(performer.id)

    def set_paused(
        self, *, performer_id: uuid.UUID | str, actor_id: uuid.UUID | str, paused: bool
    ) -> Performer:
        """Take the act off the market, or put it back.

        A pause is the owner's own decision and needs no operator: it does not
        change what was approved, only whether it is currently listed. Coming
        back from a pause therefore returns to LIVE rather than to the queue.
        """
        performer = self._load_owned(performer_id=performer_id, actor_id=actor_id)
        target = PerformerStatus.PAUSED if paused else PerformerStatus.LIVE
        sources = (PerformerStatus.LIVE,) if paused else (PerformerStatus.PAUSED,)

        if not self._performers.set_status(
            performer_id=performer.id, status=target, sources=sources
        ):
            raise InvalidPerformerStateError(
                "Only a published profile can be paused, and only a paused one resumed."
            )

        record_audit(
            actor_id=str(actor_id),
            action="performer.paused" if paused else "performer.resumed",
            target_type="performer",
            target_id=str(performer.id),
        )
        return self._reload(performer.id)

    # --- media -------------------------------------------------------------

    def upload_photo(
        self,
        *,
        performer_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        upload: UploadedFile,
        alt_text: str,
        caption: str = "",
        position: int = 0,
    ):
        """Validate, store, then attach — in that order.

        The storage write happens BEFORE the transaction opens, per the
        performance checklist: a DB transaction should hold connections for as
        short a time as possible, and if the upload succeeds but the row write
        fails, the orphaned object is harmless.
        """
        performer = self._load_owned(performer_id=performer_id, actor_id=actor_id)

        if not alt_text.strip():
            raise InvalidInputError(
                "Describe the photo. It is what a screen reader reads out, and "
                "the most-viewed image on your profile."
            )
        if self._media.count_media(performer.id) >= PerformerMediaRepository.MAX_PHOTOS:
            raise InvalidInputError(
                f"A profile can have up to {PerformerMediaRepository.MAX_PHOTOS} photos. "
                "Remove one to add another."
            )

        content_type = validate_image(upload)
        path = storage_path(
            prefix="performer-media", owner_id=str(performer.id), filename=upload.name or "photo"
        )
        url = self._storage.upload(path=path, content=upload.read(), content_type=content_type)

        with UnitOfWork():
            media = self._media.add_media(
                performer_id=performer.id,
                url=url,
                alt_text=alt_text.strip(),
                caption=caption.strip(),
                position=position,
            )
        return media

    def remove_photo(
        self,
        *,
        performer_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        media_id: uuid.UUID | str,
    ) -> None:
        performer = self._load_owned(performer_id=performer_id, actor_id=actor_id)
        if not self._media.soft_delete_media(performer_id=performer.id, media_id=media_id):
            raise PerformerNotFoundError(str(media_id))

    def _reload(self, performer_id: uuid.UUID | str) -> Performer:
        refreshed = self._performers.get_active_by_id(performer_id)
        if refreshed is None:  # pragma: no cover — just deleted mid-request
            raise PerformerNotFoundError(str(performer_id))
        return refreshed


def readiness_problems(performer: Performer, photo_count: int) -> list[str]:
    """What still stands between this profile and a submission.

    A list rather than a boolean, because the point is to TELL the owner what
    to fix. Each check is something an operator would otherwise reject for.
    """
    problems: list[str] = []
    if len((performer.bio or "").strip()) < 80:
        problems.append(
            "Write at least a short paragraph about the act — around 80 characters or more. "
            "It is the first thing a customer reads."
        )
    if photo_count == 0:
        problems.append("Add at least one photo. An act nobody can see is an act nobody hires.")
    if not performer.genres:
        problems.append("Add at least one genre, so you appear in the right searches.")
    if not performer.occasions:
        problems.append("Say which occasions you play — weddings, corporate, festivals.")
    return problems


class PerformerModerationService:
    """A platform operator's decisions.

    Deliberately separate from `PerformerService`: every method there begins by
    proving ownership, and every method here begins by proving it does not have
    to. Mixing the two in one class is how an ownership check eventually gets
    skipped on a write that needed it.
    """

    def __init__(self, *, performers: PerformerRepository, users: UserRepository) -> None:
        self._performers = performers
        self._users = users

    def moderate(
        self,
        *,
        performer_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        approve: bool,
        note: str = "",
    ) -> Performer:
        performer = self._performers.get_active_by_id(performer_id)
        if performer is None:
            raise PerformerNotFoundError(str(performer_id))
        if performer.status != PerformerStatus.PENDING_REVIEW:
            raise PerformerNotUnderReviewError()
        if not approve and not note.strip():
            raise InvalidInputError(
                "A rejection needs a reason — the performer sees this exact text and "
                "cannot fix what they have not been told."
            )

        owner = self._users.get_by_id(performer.organization.owner_id)

        with UnitOfWork() as uow:
            if not self._performers.moderate_if_pending(
                performer_id=performer.id,
                approve=approve,
                actor_id=actor_id,
                note=note.strip(),
            ):
                # Somebody else decided it first. The conditional UPDATE makes
                # that a real race, not a theoretical one.
                raise PerformerNotUnderReviewError()

            uow.publish(
                PERFORMER_APPROVED if approve else PERFORMER_REJECTED,
                {
                    "performer_id": str(performer.id),
                    "organization_id": str(performer.organization_id),
                    "stage_name": performer.stage_name,
                    "owner_email": owner.email if owner else "",
                    "note": note.strip(),
                },
                aggregate_id=str(performer.id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="performer.approved" if approve else "performer.rejected",
                target_type="performer",
                target_id=str(performer.id),
                metadata={"note": note.strip()} if note.strip() else {},
            )

        refreshed = self._performers.get_active_by_id(performer.id)
        if refreshed is None:  # pragma: no cover
            raise PerformerNotFoundError(str(performer_id))
        return refreshed

    def set_featured(
        self, *, performer_id: uuid.UUID | str, actor_id: uuid.UUID | str, featured: bool
    ) -> Performer:
        performer = self._performers.get_active_by_id(performer_id)
        if performer is None:
            raise PerformerNotFoundError(str(performer_id))
        if not self._performers.set_featured(performer_id=performer.id, featured=featured):
            raise InvalidPerformerStateError(
                "Only a published profile can be featured, and it is already in that state."
            )
        record_audit(
            actor_id=str(actor_id),
            action="performer.featured" if featured else "performer.unfeatured",
            target_type="performer",
            target_id=str(performer.id),
        )
        refreshed = self._performers.get_active_by_id(performer.id)
        if refreshed is None:  # pragma: no cover
            raise PerformerNotFoundError(str(performer_id))
        return refreshed


class MarketplaceService:
    """The ENQUIRY DESK: a customer's requirement, and an operator working it.

    ── WHAT THIS USED TO BE ───────────────────────────────────────────────

    A two-sided marketplace: customers posted briefs, listed performers
    quoted on them, and accepting a quote booked an act in one transaction.
    The platform no longer has a supply side — a customer sends what they
    need and an operator gets back to them off-platform — so the quote half
    of this class is unreachable and the request half became a work queue.

    `users` is optional so a unit test can build this without one; the
    contact-detail fallback simply does not fire, which is the honest
    degradation (a test that supplies its own contacts is testing the thing
    it meant to).
    """

    def __init__(
        self,
        *,
        requests: BookingRequestRepository,
        quotes: QuoteRepository,
        performers: PerformerRepository,
        users=None,
    ) -> None:
        self._requests = requests
        self._quotes = quotes
        self._performers = performers
        self._users = users

    def create_request(
        self,
        *,
        customer_id: uuid.UUID | str,
        performer_type: str,
        occasion: str,
        city: str,
        event_date: date,
        budget_min_minor: int,
        budget_max_minor: int,
        guests: int | None = None,
        notes: str = "",
        contact_name: str = "",
        contact_phone: str = "",
        contact_email: str = "",
        kind: str = RequestKind.ENQUIRY,
    ) -> BookingRequest:
        """Take an enquiry, and make sure somebody can answer it.

        ── THE CONTACT DETAILS ARE FILLED IN, NOT LEFT BLANK ──────────────

        This used to be a marketplace brief that deliberately carried the job
        and not the person: a performer seeing a lead was shown the
        requirement and nothing else. The only reader now is an operator whose
        entire job is to get back to the customer, so an enquiry nobody can
        answer is an enquiry that wastes both people's time.

        Anything the form left blank falls back to the ACCOUNT — which always
        has an email, and often has a name and a phone. A blank field on the
        form means "the account's is fine", not "do not contact me".
        """
        if budget_max_minor < budget_min_minor:
            raise InvalidInputError("The top of the budget has to be at least the bottom of it.")
        if event_date < date.today():
            raise InvalidInputError("The event date has to be in the future.")

        account = self._users.get_by_id(customer_id) if self._users is not None else None

        with UnitOfWork() as uow:
            request = self._requests.create(
                kind=kind,
                # The OPENING STATE differs by flow and there is no sensible
                # shared default: a marketplace brief starts `open` (waiting
                # for quotes), an enquiry starts `new` (waiting for an
                # operator). Leaving the model default would file every
                # restored brief into the operator's queue.
                status=(
                    RequestStatus.OPEN if kind == RequestKind.MARKETPLACE else RequestStatus.NEW
                ),
                customer_id=customer_id,
                contact_name=(contact_name.strip() or (account.full_name if account else "")),
                contact_phone=(contact_phone.strip() or (account.phone if account else "")),
                contact_email=(contact_email.strip() or (account.email if account else "")),
                performer_type=performer_type,
                occasion=occasion,
                city=city.strip(),
                event_date=event_date,
                budget_min_minor=budget_min_minor,
                budget_max_minor=budget_max_minor,
                guests=guests,
                notes=notes.strip(),
            )
            uow.publish(
                PERFORMER_REQUEST_CREATED,
                {
                    "request_id": str(request.id),
                    "performer_type": performer_type,
                    "city": request.city,
                    "event_date": request.event_date.isoformat(),
                    "contact_email": request.contact_email,
                    "contact_name": request.contact_name,
                },
                aggregate_id=str(request.id),
            )
        logger.info("enquiry_created", extra={"request_id": str(request.id)})
        return request

    def decide_enquiry(
        self,
        *,
        request_id,
        actor_id,
        status: str,
        admin_note: str = "",
    ) -> BookingRequest:
        """An operator moves an enquiry through the queue.

        ── WHY THE NOTE IS NOT SHOWN TO THE CUSTOMER ──────────────────────

        The same rule the event moderation note follows: it is written for the
        NEXT operator ("called twice, no answer"), and rendering an internal
        judgement to the person it is about is a judgement published. The
        customer hears back through whatever channel the operator used.

        The move is refused on a WITHDRAWN enquiry. A customer who cancelled
        has taken their request back, and closing it as won afterwards would
        record a booking against a request that no longer exists.
        """
        if status not in set(BookingRequestRepository.OPERATOR_STATUSES):
            raise InvalidInputError("That is not a state an operator can move an enquiry to.")

        request = self._requests.get_by_id(request_id)
        if request is None:
            raise EnquiryNotFoundError(str(request_id))

        with UnitOfWork():
            if not self._requests.decide(
                request_id=request_id,
                status=status,
                # Recorded even when moving BACK to `new`: "who last touched
                # this" is the useful fact, and blanking it on a bounce-back
                # would lose the only trail there is.
                handled_by_id=actor_id,
                admin_note=admin_note.strip(),
            ):
                raise EnquiryWithdrawnError()
            record_audit(
                actor_id=str(actor_id),
                action="enquiry.decided",
                target_type="enquiry",
                target_id=str(request_id),
                metadata={"status": status},
            )

        refreshed = self._requests.get_by_id(request_id)
        if refreshed is None:  # pragma: no cover — just deleted mid-request
            raise EnquiryNotFoundError(str(request_id))
        logger.info("enquiry_decided", extra={"request_id": str(request_id), "status": status})
        return refreshed

    def cancel_request(self, *, request_id: uuid.UUID, customer_id: uuid.UUID) -> BookingRequest:
        if not self._requests.cancel(request_id=request_id, customer_id=customer_id):
            raise RequestClosedError()
        request = self._requests.get_by_id(request_id)
        if request is None:  # pragma: no cover
            raise RequestNotFoundError(str(request_id))
        return request

    def submit_quote(
        self,
        *,
        request_id: uuid.UUID | str,
        performer_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        amount_minor: int,
        message: str = "",
    ) -> Quote:
        """A performer answers a brief.

        The uniqueness of (request, performer) is enforced by the DATABASE, and
        the `IntegrityError` below is the real guard — checking first and then
        inserting leaves a window in which two concurrent submissions both pass
        the check.
        """
        performer = self._performers.get_active_for_write(performer_id)
        if performer is None:
            raise PerformerNotFoundError(str(performer_id))
        if str(performer.organization.owner_id) != str(actor_id):
            raise NotPerformerOwnerError()
        if performer.status != PerformerStatus.LIVE:
            raise PerformerNotBookableError()

        request = self._requests.get_by_id(request_id)
        if request is None:
            raise RequestNotFoundError(str(request_id))
        # UNREACHABLE. Quoting has no route (see `urls.py`) — the platform has
        # no performer supply side, and an enquiry is worked by an operator by
        # hand. Kept compiling against `NEW` rather than deleted mid-change, so
        # the module still type-checks while the marketplace's remains are
        # removed in their own pass.
        # MARKETPLACE semantics: quotes are taken on a brief that is OPEN.
        # The enquiry rewrite re-pointed this at `NEW`, which is the enquiry
        # opening state — so with both flows live it would have refused every
        # legitimate quote and accepted quotes on operator enquiries.
        if request.status != RequestStatus.OPEN:
            raise RequestClosedError()

        try:
            with UnitOfWork() as uow:
                quote = self._quotes.create(
                    request_id=request.id,
                    performer_id=performer.id,
                    amount_minor=amount_minor,
                    message=message.strip(),
                )
                uow.publish(
                    PERFORMER_QUOTE_SUBMITTED,
                    {
                        "quote_id": str(quote.id),
                        "request_id": str(request.id),
                        "performer_id": str(performer.id),
                        "amount_minor": amount_minor,
                    },
                    aggregate_id=str(request.id),
                )
        except IntegrityError as exc:
            raise DuplicateQuoteError() from exc

        return quote

    def withdraw_quote(self, *, quote_id: uuid.UUID | str, actor_id: uuid.UUID | str) -> Quote:
        quote = self._quotes.get_by_id(quote_id)
        if quote is None:
            raise QuoteNotFoundError(str(quote_id))
        if str(quote.performer.organization.owner_id) != str(actor_id):
            raise NotPerformerOwnerError()
        if not self._quotes.withdraw(quote_id=quote.id):
            raise RequestClosedError()
        refreshed = self._quotes.get_by_id(quote.id)
        if refreshed is None:  # pragma: no cover
            raise QuoteNotFoundError(str(quote_id))
        return refreshed

    def accept_quote(self, *, quote_id: uuid.UUID | str, customer_id: uuid.UUID | str) -> Quote:
        """Hire.

        ONE transaction does three things that must not come apart: the quote
        is accepted, the request is closed against that performer, and every
        other pending quote is declined. If any step failed on its own, a
        customer could end up with two accepted quotes, or performers could sit
        holding a date for a request already booked.

        The race guard is the `status=OPEN` predicate on the request update: a
        second accept matches zero rows and is refused, rather than overwriting
        the first winner.
        """
        quote = self._quotes.get_by_id(quote_id)
        if quote is None:
            raise QuoteNotFoundError(str(quote_id))
        if str(quote.request.customer_id) != str(customer_id):
            raise NotPerformerOwnerError()
        if quote.status != QuoteStatus.PENDING:
            raise RequestClosedError()

        with UnitOfWork() as uow:
            if not self._requests.close_with_booking(
                request_id=quote.request_id, performer_id=quote.performer_id
            ):
                raise RequestClosedError()
            if not self._quotes.accept(quote_id=quote.id):  # pragma: no cover — checked above
                raise RequestClosedError()
            self._quotes.decline_others(request_id=quote.request_id, winner_id=quote.id)

            uow.publish(
                PERFORMER_QUOTE_ACCEPTED,
                {
                    "quote_id": str(quote.id),
                    "request_id": str(quote.request_id),
                    "performer_id": str(quote.performer_id),
                    "amount_minor": quote.amount_minor,
                },
                aggregate_id=str(quote.request_id),
            )
            record_audit(
                actor_id=str(customer_id),
                action="performer.quote_accepted",
                target_type="quote",
                target_id=str(quote.id),
            )

        refreshed = self._quotes.get_by_id(quote.id)
        if refreshed is None:  # pragma: no cover
            raise QuoteNotFoundError(str(quote_id))
        return refreshed
