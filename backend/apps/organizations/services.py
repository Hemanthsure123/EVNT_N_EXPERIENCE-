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

from django.core.files.uploadedfile import UploadedFile
from django.db import transaction

from apps.accounts.repositories import UserRepository
from core.audit import record_audit
from core.events import ORGANIZATION_CREATED, PAYOUT_ACCOUNT_LINKED
from core.ports.payment_port import PaymentPort
from core.ports.storage_port import StoragePort
from core.ports.task_queue_port import TaskQueuePort
from core.unit_of_work import UnitOfWork

from .exceptions import NotOrganizationOwnerError, OrganizationNotFoundError
from .models import Organization, VerificationRecord, VerifiedLevel
from .repositories import OrganizationRepository
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
        org = self._get_owned_organization(organization_id=organization_id, actor_id=actor_id)

        with UnitOfWork():
            record = self._organizations.create_verification_record(organization_id=org.id)
            if notes:
                record.notes = notes
                self._organizations.save_verification_record(record)

            org.verified_level = VerifiedLevel.PENDING
            self._organizations.save(org)

            record_audit(
                actor_id=str(actor_id),
                action="organization.verification_submitted",
                target_type="organization",
                target_id=str(org.id),
            )
            transaction.on_commit(lambda: invalidate_organization_cache(org.id, org.owner_id))
            transaction.on_commit(
                lambda: self._task_queue.enqueue(
                    "organizations.process_verification",
                    {"organization_id": str(org.id), "verification_id": str(record.id)},
                )
            )

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
