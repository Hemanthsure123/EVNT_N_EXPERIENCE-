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


class OrganizationFollow(models.Model):
    """A user following an organization, plus whether they want to be told
    when it puts something new on sale.

    ── ONE ROW WITH A FLAG, NOT TWO MODELS ──────────────────────────────

    Follow and "notify me" are ONE row with a `notify` boolean, not a follow
    table plus a subscription table. Following without notifications is a real
    preference — somebody who wants an organizer in their feed but not in their
    pocket — so the flag has to exist. But two tables could disagree: a
    notification row with no follow behind it, or a follow whose subscription
    row was never written, and every read would then have to decide which one
    was telling the truth. One row cannot contradict itself.

    ── CASCADE ON BOTH SIDES ────────────────────────────────────────────

    A follow means nothing without either side and, unlike a booking, is not a
    financial record anybody must keep. Same reasoning as `events.SavedEvent`.

    ── WHY THERE IS NO `follower_count` COLUMN ──────────────────────────

    The count shown on the organizer tab is COUNTED from these rows (see
    `OrganizationRepository.get_active_by_id`, which annotates it onto the same
    lookup), not maintained as a denormal on `Organization`.

    A denormal earns its place when the count is expensive to compute or read
    far more often than it is written. This is neither: it is one index-backed
    `COUNT` over a narrow index, and the organization detail payload it rides on
    is already cache-aside with a 60s TTL, so it is computed at most once a
    minute per organization however hot the page is. A column would put an
    `UPDATE` on the `Organization` row — the row every event card joins to — in
    the path of every follow and unfollow, and would then have to be kept
    correct across a cascade delete and a concurrent double-follow. That is a
    lot of new ways to display a wrong number in exchange for nothing.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # `db_index=False` on BOTH foreign keys. Django indexes an FK column by
    # default, and here both of those indexes would be redundant: `user` leads
    # `org_follow_user_org_uniq` and `org_follow_user_recent_idx`, `organization`
    # leads `org_follow_org_notify_idx`, so every query AND both cascade deletes
    # (`WHERE user_id = ...` / `WHERE organization_id = ...`) are already covered.
    # This table is almost entirely writes — a follow is one INSERT and two reads
    # — so two duplicate indexes maintained on every row is a cost with no reader.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="organization_follows",
        db_index=False,
    )
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="followers", db_index=False
    )
    # Defaults True: somebody who presses Follow is asking to hear about new
    # events. Turning it off is an explicit, separate choice (PATCH), and it
    # keeps the follow — which is the whole reason this is a flag and not a
    # second table.
    notify = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "organizations_organization_follow"
        constraints = [
            # Following twice is the same fact, and a Follow button can
            # double-fire on a slow connection. The constraint is what makes the
            # second press a no-op rather than a duplicate row — it is also the
            # race guard, since two concurrent presses both pass a
            # check-then-insert.
            #
            # Its index (user, organization) is ALSO the index for "does this
            # user follow this org", which is the per-request read behind the
            # button's state — so that query needs no index of its own.
            models.UniqueConstraint(
                fields=["user", "organization"], name="org_follow_user_org_uniq"
            ),
        ]
        indexes = [
            # THE FAN-OUT: "every notify=True follower of this organization",
            # which `notifications` runs when an event goes live. Leading with
            # `organization` and carrying `user` as the last column makes it an
            # index-only scan — the ids come out of the index without touching
            # the table at all, which matters because this is the one query here
            # that returns thousands of rows.
            #
            # Deliberately NOT a partial index on `notify=True`, even though the
            # fan-out only wants those rows: a partial index cannot answer the
            # follower COUNT (which includes followers who muted), and a second
            # index just for counting is a write cost on every follow. This one
            # index serves both — the count uses the `organization` prefix.
            #
            # Verified with EXPLAIN ANALYZE (6k follows over 40 organizations,
            # after VACUUM ANALYZE): the fan-out is
            #   Index Only Scan using org_follow_org_notify_idx ... Heap Fetches: 0
            # and so is the count. "Does this user follow" is an
            #   Index Scan using org_follow_user_org_uniq
            # — the constraint's own index, as intended.
            models.Index(
                fields=["organization", "notify", "user"], name="org_follow_org_notify_idx"
            ),
            # "my followed organizations, newest first" — GET /me/following.
            # Cursor pagination's WHERE + ORDER BY is only stable and cheap on
            # an index that matches its ordering exactly.
            models.Index(fields=["user", "-created_at"], name="org_follow_user_recent_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} follows {self.organization_id}"


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
