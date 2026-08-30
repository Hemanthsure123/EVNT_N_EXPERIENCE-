"""Business rules for organizations: create/update, submit for
verification, link a payout account.

Two performance rules baked in here (see CLAUDE.md's Performance
checklist):
1. Slow external I/O (storage uploads, the payments API call to create a
   linked account) happens OUTSIDE the UnitOfWork transaction, before it
   opens — a DB transaction should hold locks/connections for as short a
   time as possible, and neither of those calls needs to be atomic with
   the DB write (if the upload succeeds but the DB write then fails, the
   transaction still rolls back and the orphaned upload is harmless).
2. Verification "processing" is hard work handed to TaskQueuePort so
   submit_verification() returns fast — see apps/organizations/tasks.py.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from django.core.files.uploadedfile import UploadedFile
from django.db import transaction
from django.utils import timezone

from apps.accounts.repositories import UserRepository
from core.audit import record_audit
from core.events import (
    ORGANIZATION_CREATED,
    ORGANIZATION_VERIFICATION_REJECTED,
    ORGANIZATION_VERIFICATION_SUBMITTED,
    ORGANIZATION_VERIFIED,
    PAYOUT_ACCOUNT_LINKED,
)
from core.ports.payment_port import PaymentPort
from core.ports.storage_port import StoragePort
from core.ports.task_queue_port import TaskQueuePort
from core.unit_of_work import UnitOfWork

from .exceptions import (
    NoPendingVerificationError,
    NotFollowingError,
    NotOrganizationOwnerError,
    NotPlatformOperatorError,
    OrganizationNotFoundError,
)
from .models import Organization, VerificationRecord, VerificationStatus, VerifiedLevel
from .repositories import OrganizationFollowRepository, OrganizationRepository
from .selectors import invalidate_organization_cache

logger = logging.getLogger(__name__)


class OrganizationService:
    def __init__(
        self,
        *,
        organizations: OrganizationRepository,
        users: UserRepository,
        storage: StoragePort,
        payments: PaymentPort,
        task_queue: TaskQueuePort,
    ) -> None:
        self._organizations = organizations
        self._users = users
        self._storage = storage
        self._payments = payments
        # Kept even though `submit_verification` no longer enqueues anything:
        # this is the injection point a real KYC provider's async check plugs
        # into, and `organizations.process_verification` is still registered.
        self._task_queue = task_queue

    def _upload_logo(self, organization_id: uuid.UUID | str, logo: UploadedFile) -> str:
        path = f"org-logos/{organization_id}/{uuid.uuid4().hex}-{logo.name}"
        content_type = logo.content_type or "application/octet-stream"
        return self._storage.upload(path=path, content=logo.read(), content_type=content_type)

    def _get_owned_organization(
        self, *, organization_id: uuid.UUID | str, actor_id: uuid.UUID | str
    ) -> Organization:
        org = self._organizations.get_active_by_id(organization_id)
        if org is None:
            raise OrganizationNotFoundError(str(organization_id))
        if str(org.owner_id) != str(actor_id):
            user = self._users.get_by_id(actor_id)
            if user is None or not user.is_staff:
                raise NotOrganizationOwnerError()
        return org

    def create_organization(
        self, *, owner_id: uuid.UUID | str, name: str, logo: UploadedFile | None = None
    ) -> Organization:
        organization_id = uuid.uuid4()
        logo_url = self._upload_logo(organization_id, logo) if logo is not None else ""

        with UnitOfWork() as uow:
            org = self._organizations.create(
                id=organization_id, owner_id=owner_id, name=name, logo_url=logo_url
            )

            owner = self._users.get_by_id(owner_id)
            if owner is not None and not owner.is_organizer:
                owner.is_organizer = True
                self._users.save(owner)

            uow.publish(
                ORGANIZATION_CREATED,
                {
                    "organization_id": str(org.id),
                    "name": org.name,
                    "owner_id": str(owner_id),
                    "owner_email": owner.email if owner else "",
                },
                aggregate_id=str(org.id),
            )
            record_audit(
                actor_id=str(owner_id),
                action="organization.created",
                target_type="organization",
                target_id=str(org.id),
            )
            transaction.on_commit(lambda: invalidate_organization_cache(org.id, owner_id))

        logger.info("organization_created", extra={"organization_id": str(org.id)})
        return org

    def update_organization(
        self,
        *,
        organization_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        name: str | None = None,
        logo: UploadedFile | None = None,
    ) -> Organization:
        org = self._get_owned_organization(organization_id=organization_id, actor_id=actor_id)
        logo_url = self._upload_logo(org.id, logo) if logo is not None else None

        with UnitOfWork():
            if name is not None:
                org.name = name
            if logo_url is not None:
                org.logo_url = logo_url
            self._organizations.save(org)
            record_audit(
                actor_id=str(actor_id),
                action="organization.updated",
                target_type="organization",
                target_id=str(org.id),
            )
            transaction.on_commit(lambda: invalidate_organization_cache(org.id, org.owner_id))

        return org

    def submit_verification(
        self, *, organization_id: uuid.UUID | str, actor_id: uuid.UUID | str, notes: str = ""
    ) -> VerificationRecord:
        """Ask a platform operator to verify this organization.

        **It leaves the record PENDING and nothing else happens.** It used to
        end by enqueuing `organizations.process_verification`, a KYC stand-in
        whose own docstring says it "always approves" — and with
        `QUEUE_BACKEND=local` that task runs INLINE, in the same process,
        milliseconds later. So every organization on this platform verified
        itself: four verification records, every one approved between 16 and
        79 milliseconds after it was created, zero human decisions in the audit
        log, and an operator queue that was permanently empty because no row
        ever stayed `pending` long enough to appear in it.

        An approval nobody granted is worse than no approval at all: it is the
        gate reporting green. The task stays REGISTERED (it is the seam a real
        KYC provider plugs into, and it has its own tests) — it is simply not
        fired from the organizer's submit path. `decide_verification` below is
        now the only thing that can set `verified_level = VERIFIED`.

        Deliberately NOT put behind an `ORGANIZATION_AUTO_VERIFY` setting: a
        flag that can be switched on in production reintroduces exactly the
        "looks approved, nobody approved it" failure this removal exists to
        end, and preflight's whole job is to refuse that class of
        configuration.

        It DOES now publish a domain event, which it never used to (the old
        `with UnitOfWork():` bound no `uow` and nothing reached the outbox).
        That is the other half of removing the auto-approval: an organization
        that waits for a human is only better than one that approves itself if
        a human is told it is waiting. `notifications` already has the
        consumer; this is the publish it was waiting for.
        """
        org = self._get_owned_organization(organization_id=organization_id, actor_id=actor_id)
        # Read before the transaction opens: it is one indexed PK lookup and it
        # makes the operator's alert complete (who asked) without the consumer
        # having to re-resolve it on the drain.
        owner = self._users.get_by_id(org.owner_id)

        with UnitOfWork() as uow:
            record = self._organizations.create_verification_record(organization_id=org.id)
            if notes:
                record.notes = notes
                self._organizations.save_verification_record(record)

            org.verified_level = VerifiedLevel.PENDING
            self._organizations.save(org)

            uow.publish(
                ORGANIZATION_VERIFICATION_SUBMITTED,
                {
                    "organization_id": str(org.id),
                    # The per-submission discriminator the alert's dedupe key
                    # uses. Keyed on the organization alone, a re-application
                    # after a rejection would be swallowed as a duplicate of
                    # the first one — silence for the applicant who most needs
                    # an answer.
                    "verification_id": str(record.id),
                    "name": org.name,
                    "owner_email": owner.email if owner else "",
                },
                aggregate_id=str(org.id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="organization.verification_submitted",
                target_type="organization",
                target_id=str(org.id),
            )
            transaction.on_commit(lambda: invalidate_organization_cache(org.id, org.owner_id))

        logger.info(
            "organization_verification_submitted",
            extra={"organization_id": str(org.id), "verification_id": str(record.id)},
        )
        return record

    def get_latest_verification(
        self, *, organization_id: uuid.UUID | str, actor_id: uuid.UUID | str
    ) -> VerificationRecord | None:
        """The owner's view of where their verification stands.

        Read-only and owner-checked in the service, like every other
        object-level check in this module — the alternative is fetching the
        organization twice per request through a DRF object permission.

        Returns None when nothing has ever been submitted, which the view
        turns into a 404. That is a real state (a brand-new organization),
        not an error, and it is what tells the UI to offer the submit form
        rather than a status.
        """
        self._get_owned_organization(organization_id=organization_id, actor_id=actor_id)
        return self._organizations.get_latest_verification(organization_id)

    def decide_verification(
        self,
        *,
        organization_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        approve: bool,
        notes: str = "",
    ) -> VerificationRecord:
        """A PLATFORM OPERATOR's decision on a pending verification.

        Deliberately separate from `submit_verification`, which is the
        organizer's own request, and from the `process_verification` task,
        which is the automated stand-in that always approves. This is the
        human review path the operator console drives, and — since
        `submit_verification` stopped firing that task — the ONLY thing on the
        platform that can set `verified_level = VERIFIED`.

        No OWNERSHIP check: an operator reviewing an organization they do not
        own is the entire point, which is why this does not go through
        `_get_owned_organization` like every other write in this service. But
        it does prove the caller is STAFF for itself rather than trusting the
        console view to have done it — this method is the gate for every
        organizer write the platform gates, so it must not be possible to
        reach it from a caller that never checked.

        Idempotent by state: a record that has already been processed is
        returned untouched, so a double-clicked Approve cannot flip a
        rejection into an approval.
        """
        actor = self._users.get_by_id(actor_id)
        if actor is None or not actor.is_staff or not actor.is_active:
            raise NotPlatformOperatorError()

        org = self._organizations.get_active_by_id(organization_id)
        if org is None:
            raise OrganizationNotFoundError(str(organization_id))

        record = self._organizations.get_latest_pending_verification(org.id)
        if record is None:
            raise NoPendingVerificationError(str(organization_id))

        with UnitOfWork() as uow:
            record.status = VerificationStatus.APPROVED if approve else VerificationStatus.REJECTED
            record.processed_at = timezone.now()
            if notes:
                record.notes = notes
            self._organizations.save_verification_record(record)

            org.verified_level = VerifiedLevel.VERIFIED if approve else VerifiedLevel.UNVERIFIED
            self._organizations.save(org)

            record_audit(
                actor_id=str(actor_id),
                action=(
                    "organization.verification_approved"
                    if approve
                    else "organization.verification_rejected"
                ),
                target_type="organization",
                target_id=str(org.id),
            )
            uow.publish(
                ORGANIZATION_VERIFIED if approve else ORGANIZATION_VERIFICATION_REJECTED,
                {"organization_id": str(org.id), "owner_id": str(org.owner_id), "notes": notes},
                aggregate_id=str(org.id),
            )
            transaction.on_commit(lambda: invalidate_organization_cache(org.id, org.owner_id))

        return record

    def link_payout_account(
        self, *, organization_id: uuid.UUID | str, actor_id: uuid.UUID | str
    ) -> Organization:
        org = self._get_owned_organization(organization_id=organization_id, actor_id=actor_id)
        owner = self._users.get_by_id(actor_id)
        linked_account_id = self._payments.create_linked_account(
            reference_id=str(org.id), name=org.name, email=owner.email if owner else ""
        )

        with UnitOfWork() as uow:
            org.payout_account_id = linked_account_id
            self._organizations.save(org)
            uow.publish(
                PAYOUT_ACCOUNT_LINKED,
                {
                    "organization_id": str(org.id),
                    "payout_account_id": linked_account_id,
                    "owner_email": owner.email if owner else "",
                },
                aggregate_id=str(org.id),
            )
            record_audit(
                actor_id=str(actor_id),
                action="organization.payout_account_linked",
                target_type="organization",
                target_id=str(org.id),
            )
            transaction.on_commit(lambda: invalidate_organization_cache(org.id, org.owner_id))

        return org


@dataclass(frozen=True)
class FollowState:
    """What every follow endpoint answers with — the caller's own state, plus
    the organization's real follower count.

    A structured result rather than a bare bool, mirroring booking's
    `ConfirmResult` and checkin's `VerifyResult`: the frontend renders the
    button (`is_following`), the bell (`notify`) and the count from one shape
    whichever verb it called.
    """

    organization_id: str
    is_following: bool
    notify: bool
    follower_count: int


class OrganizationFollowService:
    """Following an organization, and whether that follow notifies.

    ── WHY THERE IS NO UnitOfWork HERE ──────────────────────────────────

    Every write in this service is ONE row. There is no second write to be
    atomic with, and no domain event: nothing subscribes to "somebody pressed
    Follow", and `core/events.py` is not the place to leave a constant no
    consumer reads. The fan-out that DOES matter reads the rows when an event
    goes live (`OrganizationFollowRepository.follower_user_ids_for_notify`) —
    it is pulled at publish time, not pushed at follow time, so a follow needs
    to reach the outbox no more than a saved event does.

    ── WHY A FOLLOW DOES NOT INVALIDATE THE ORGANIZATION'S CACHE ────────

    `follower_count` rides on the `org:{id}` detail payload, which has a 60s
    TTL, so a follow is visible in the shared count within a minute. Busting
    that key on every follow would make a popular organization's cache useless
    at exactly the moment it earns its keep — a rush of follows after an
    announcement would be one cache miss per follow. The caller's OWN state is
    never served from that cache (it comes from here, `no-store`), so the
    person who pressed the button sees their own action immediately; only the
    crowd-size number is up to a minute behind, which is what a crowd-size
    number is.
    """

    def __init__(
        self,
        *,
        follows: OrganizationFollowRepository,
        organizations: OrganizationRepository,
    ) -> None:
        self._follows = follows
        self._organizations = organizations

    def _get_active_organization(self, organization_id: uuid.UUID | str) -> Organization:
        """Every entry point resolves the organization first: following a
        soft-deleted or non-existent organization is a 404, not a row nobody
        can ever act on. The count annotated on this lookup is free (see
        `OrganizationRepository.get_active_by_id`)."""
        org = self._organizations.get_active_by_id(organization_id)
        if org is None:
            raise OrganizationNotFoundError(str(organization_id))
        return org

    def get_state(
        self, *, user_id: uuid.UUID | str, organization_id: uuid.UUID | str
    ) -> FollowState:
        org = self._get_active_organization(organization_id)
        row = self._follows.get_follow(user_id=user_id, organization_id=org.id)
        return FollowState(
            organization_id=str(org.id),
            is_following=row is not None,
            # Not following means not notified. There is no third state to
            # report: unfollowing takes the row and the flag with it.
            notify=bool(row and row.notify),
            follower_count=getattr(org, "follower_count", 0),
        )

    def follow(
        self,
        *,
        user_id: uuid.UUID | str,
        organization_id: uuid.UUID | str,
        notify: bool | None = None,
    ) -> FollowState:
        """Idempotent: pressing Follow twice leaves one row and one follower."""
        org = self._get_active_organization(organization_id)
        row, created = self._follows.follow(user_id=user_id, organization_id=org.id, notify=notify)
        if created:
            logger.info(
                "organization_followed",
                extra={"organization_id": str(org.id), "user_id": str(user_id)},
            )
        # Re-counted after the write rather than adding one to the annotated
        # count: the annotation was read before the row existed, and a number
        # the platform displays is counted, never derived from arithmetic on a
        # stale read.
        return FollowState(
            organization_id=str(org.id),
            is_following=True,
            notify=row.notify,
            follower_count=self._follows.count_followers(org.id),
        )

    def unfollow(
        self, *, user_id: uuid.UUID | str, organization_id: uuid.UUID | str
    ) -> FollowState:
        """Idempotent: unfollowing something you do not follow is the state the
        caller asked for, so it succeeds rather than 404ing."""
        org = self._get_active_organization(organization_id)
        self._follows.unfollow(user_id=user_id, organization_id=org.id)
        return FollowState(
            organization_id=str(org.id),
            is_following=False,
            notify=False,
            follower_count=self._follows.count_followers(org.id),
        )

    def set_notify(
        self, *, user_id: uuid.UUID | str, organization_id: uuid.UUID | str, notify: bool
    ) -> FollowState:
        """Turn this follow's notifications on or off, keeping the follow."""
        org = self._get_active_organization(organization_id)
        if not self._follows.set_notify(user_id=user_id, organization_id=org.id, notify=notify):
            raise NotFollowingError()
        return FollowState(
            organization_id=str(org.id),
            is_following=True,
            notify=notify,
            # Unchanged by this write, so the count annotated on the lookup
            # above is used as-is — no second COUNT for a number that cannot
            # have moved because of this call.
            follower_count=getattr(org, "follower_count", 0),
        )
