"""Organizations/brands. The owner (a User) becomes an organizer on
creation (see services.py). Membership/teams (more than one organizer per
organization) is a later module — deliberately not modeled here yet; a
single `owner` FK is all the ownership model needed until then."""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class VerifiedLevel(models.TextChoices):
    UNVERIFIED = "unverified", "Unverified"
    PENDING = "pending", "Pending"
    VERIFIED = "verified", "Verified"


class VerificationStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"


class Organization(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # PROTECT: a user who still owns an organization can't be deleted out
    # from under it. Reassigning/deleting organizations is a later concern.
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="organizations"
    )
    name = models.CharField(max_length=200)
    verified_level = models.CharField(
        max_length=20, choices=VerifiedLevel.choices, default=VerifiedLevel.UNVERIFIED
    )
    payout_account_id = models.CharField(max_length=255, blank=True, default="")
    logo_url = models.CharField(max_length=500, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "organizations_organization"
        indexes = [
            # Supports "my active organizations, newest first" (the GET
            # /organizations list endpoint) as a single index scan instead
            # of a full-table filter + sort.
            models.Index(
                fields=["owner", "created_at"],
                name="org_owner_created_idx",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]

    def __str__(self) -> str:
        return self.name


class VerificationRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="verification_records"
    )
    status = models.CharField(
        max_length=20, choices=VerificationStatus.choices, default=VerificationStatus.PENDING
    )
    notes = models.CharField(max_length=500, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "organizations_verification_record"
        indexes = [models.Index(fields=["organization", "created_at"])]

    def __str__(self) -> str:
        return f"{self.organization_id} ({self.status})"
