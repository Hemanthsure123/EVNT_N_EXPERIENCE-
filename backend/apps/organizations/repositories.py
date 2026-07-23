"""ORM access for organizations. `.only(...)` everywhere a lean read is
possible — see CLAUDE.md's Performance checklist: selectors must never
over-fetch, and there are no FK traversals here (owner_id is read directly
off the row) so select_related isn't needed for anything in this module
yet."""

from __future__ import annotations

import uuid

from django.db.models import QuerySet

from core.base_repository import BaseRepository

from .models import Organization, VerificationRecord

_DETAIL_FIELDS = (
    "id",
    "owner_id",
    "name",
    "verified_level",
    "payout_account_id",
    "logo_url",
    "created_at",
)
_SUMMARY_FIELDS = ("id", "name", "verified_level", "logo_url", "created_at")


class OrganizationRepository(BaseRepository[Organization]):
    model = Organization

    def get_active_by_id(self, organization_id: uuid.UUID | str) -> Organization | None:
        return (
            self.get_queryset()
            .filter(pk=organization_id, deleted_at__isnull=True)
            .only(*_DETAIL_FIELDS)
            .first()
        )

    def list_active_by_owner(self, owner_id: uuid.UUID | str) -> QuerySet[Organization]:
        # django-stubs types the owner_id= lookup as User | UUID | None only —
        # a plain str (as callers may pass) works fine at runtime for a UUID
        # field, the stub is just narrower than what Django actually accepts.
        return (
            self.get_queryset()
            .filter(owner_id=owner_id, deleted_at__isnull=True)  # type: ignore[misc]
            .only(*_SUMMARY_FIELDS)
            .order_by("-created_at")
        )

    def create(
        self,
        *,
        owner_id: uuid.UUID | str,
        name: str,
        logo_url: str = "",
        id: uuid.UUID | None = None,
    ) -> Organization:
        kwargs = {"owner_id": owner_id, "name": name, "logo_url": logo_url}
        if id is not None:
            kwargs["id"] = id
        return Organization.objects.create(**kwargs)

    def create_verification_record(self, *, organization_id: uuid.UUID | str) -> VerificationRecord:
        return VerificationRecord.objects.create(organization_id=organization_id)

    def get_verification_record(
        self, verification_id: uuid.UUID | str
    ) -> VerificationRecord | None:
        return VerificationRecord.objects.filter(pk=verification_id).first()

    def save_verification_record(self, record: VerificationRecord) -> VerificationRecord:
        record.save()
        return record
