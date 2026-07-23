"""Background task handlers for this module — the first real
TaskQueuePort consumer (see core/tasks.py for why the registry didn't
exist before now). Registered via @register_task at import time;
apps.py's AppConfig.ready() imports this module so registration always
happens before any request could enqueue a task."""

from __future__ import annotations

import logging

from django.db import transaction
from django.utils import timezone

from apps.accounts.repositories import UserRepository
from core.audit import record_audit
from core.events import ORGANIZATION_VERIFIED
from core.tasks import register_task
from core.unit_of_work import UnitOfWork

from .models import VerificationStatus, VerifiedLevel
from .repositories import OrganizationRepository
from .selectors import invalidate_organization_cache

logger = logging.getLogger(__name__)


@register_task("organizations.process_verification")
def process_verification(payload: dict) -> None:
    """Stand-in for a real verification/KYC provider call — the actual
    slow work this task exists to keep off the request path. Always
    approves; there's no real verification backend to integrate with yet.
    This proves the async-processing shape, not real KYC logic."""
    organizations = OrganizationRepository()
    org = organizations.get_active_by_id(payload["organization_id"])
    if org is None:
        logger.warning("organizations.process_verification.org_missing", extra=payload)
        return

    record = organizations.get_verification_record(payload["verification_id"])
    if record is None:
        logger.warning("organizations.process_verification.record_missing", extra=payload)
        return

    owner = UserRepository().get_by_id(org.owner_id)

    with UnitOfWork() as uow:
        record.status = VerificationStatus.APPROVED
        record.processed_at = timezone.now()
        organizations.save_verification_record(record)

        org.verified_level = VerifiedLevel.VERIFIED
        organizations.save(org)

        uow.publish(
            ORGANIZATION_VERIFIED,
            {"organization_id": str(org.id), "owner_email": owner.email if owner else ""},
            aggregate_id=str(org.id),
        )
        record_audit(
            actor_id="system",
            action="organization.verified",
            target_type="organization",
            target_id=str(org.id),
        )
        transaction.on_commit(lambda: invalidate_organization_cache(org.id, org.owner_id))

    logger.info(
        "organizations.process_verification.approved", extra={"organization_id": str(org.id)}
    )
