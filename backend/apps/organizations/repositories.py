"""ORM access for organizations. `.only(...)` everywhere a lean read is
possible — see CLAUDE.md's Performance checklist: selectors must never
over-fetch, and there are no FK traversals here (owner_id is read directly
off the row) so select_related isn't needed for anything in this module
yet."""

from __future__ import annotations

import uuid

from django.db import IntegrityError
from django.db.models import Count, QuerySet

from core.base_repository import BaseRepository

from .models import Organization, OrganizationFollow, VerificationRecord, VerificationStatus

_DETAIL_FIELDS = (
    "id",
    "owner_id",
    "name",
    "verified_level",
    "payout_account_id",
    "logo_url",
    "created_at",
)
# `payout_account_id` is LOADED but never PUBLISHED. The summary serializer
# turns it into a boolean (`payout_account_linked`), and computing that from a
# deferred column would cost one extra query per organization in the list — the
# N+1 the `.only()` here exists to prevent. Loading a column and serializing it
# are different decisions; this is the one place they differ on purpose.
_SUMMARY_FIELDS = (
    "id",
    "name",
    "verified_level",
    "payout_account_id",
    "logo_url",
    "created_at",
)
# What a followed organization shows on the "following" list: enough to draw
# the card and link to it, nothing more. Reached through one JOIN
# (select_related), so a list of twenty is one query, not twenty-one.
_FOLLOWED_ORG_FIELDS = (
    "id",
    "notify",
    "created_at",
    "organization__id",
    "organization__name",
    "organization__verified_level",
    "organization__logo_url",
)


class OrganizationRepository(BaseRepository[Organization]):
    model = Organization

    def get_active_by_id(self, organization_id: uuid.UUID | str) -> Organization | None:
        """The detail row, with its REAL follower count annotated on.

        The count rides on this same lookup as a LEFT JOIN + GROUP BY rather
        than a second round trip: a PK filter joined against
        `org_follow_org_notify_idx` is a nested loop over one organization's
        rows, so the detail read stays ONE query and the query budget CLAUDE.md
        records for this module does not move. A separate `COUNT` would have
        doubled the cheapest read on the platform to add a display number.

        Every caller gets the annotation, including the ownership checks in
        services.py that do not need it — one join on a single-row lookup is
        cheaper than a second repository method whose only difference is
        whether a number is present, and which would make the count silently
        absent from whichever response forgot to use it.
        """
        return (
            self.get_queryset()
            .filter(pk=organization_id, deleted_at__isnull=True)
            .annotate(follower_count=Count("followers"))
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

    def get_latest_pending_verification(
        self, organization_id: uuid.UUID | str
    ) -> VerificationRecord | None:
        """The request an operator is actually deciding on. Ordered newest
        first: an organization may have been rejected and re-submitted, and
        the open one is the only one still awaiting a decision."""
        return (
            VerificationRecord.objects.filter(
                organization_id=organization_id, status=VerificationStatus.PENDING
            )
            .order_by("-created_at")
            .first()
        )

    def get_latest_verification(
        self, organization_id: uuid.UUID | str
    ) -> VerificationRecord | None:
        """The most recent record whatever its status — what the OWNER sees.

        Distinct from `get_latest_pending_verification`, which answers the
        operator's question ("what am I deciding on"). An organizer whose
        submission was REJECTED has no pending record, and that is exactly
        when they most need to be told why.
        """
        return (
            VerificationRecord.objects.filter(organization_id=organization_id)
            .order_by("-created_at")
            .first()
        )

    def save_verification_record(self, record: VerificationRecord) -> VerificationRecord:
        record.save()
        return record


class OrganizationFollowRepository(BaseRepository[OrganizationFollow]):
    """The follow relationship: one row per (user, organization).

    Four queries live here and each has an index behind it — see
    `OrganizationFollow.Meta`.
    """

    model = OrganizationFollow

    def get_follow(
        self, *, user_id: uuid.UUID | str, organization_id: uuid.UUID | str
    ) -> OrganizationFollow | None:
        """Does this user follow this organization, and do they want to hear
        about it — the read behind the button's state. A unique-index lookup
        (`org_follow_user_org_uniq`, confirmed by EXPLAIN)."""
        return (
            self.get_queryset()
            .filter(user_id=user_id, organization_id=organization_id)
            .only("id", "notify", "created_at")
            .first()
        )

    def follow(
        self, *, user_id: uuid.UUID | str, organization_id: uuid.UUID | str, notify: bool | None
    ) -> tuple[OrganizationFollow, bool]:
        """Idempotent follow. Returns (row, created).

        `get_or_create` rather than a check-then-insert: two presses of the
        button landing at once both pass a check, and only the unique constraint
        can settle it. Django wraps the INSERT in its own savepoint and re-reads
        on `IntegrityError`, so the loser of a follow/follow race returns the
        winner's row instead of raising.

        That single re-read isn't enough against a concurrent `unfollow()`,
        though: if the row it re-reads for was deleted in the gap between the
        failed INSERT and the re-read `SELECT`, Django's retry hits
        `DoesNotExist` and re-raises the original `IntegrityError` rather than
        trying again. A bounded retry loop here covers that case — the next
        attempt either finds a fresh row (another follow won) or the slot is
        genuinely empty (create succeeds).

        `notify=None` means the caller did not express a preference: it defaults
        to True on a NEW follow and leaves an EXISTING one alone. A repeat press
        of Follow must not quietly re-enable notifications somebody turned off.
        """
        last_error: IntegrityError | None = None
        for _ in range(5):
            try:
                row, created = OrganizationFollow.objects.get_or_create(
                    user_id=user_id,
                    organization_id=organization_id,
                    defaults={"notify": True if notify is None else notify},
                )
            except IntegrityError as exc:
                last_error = exc
                continue
            if not created and notify is not None and row.notify != notify:
                row.notify = notify
                row.save(update_fields=["notify"])
            return row, created
        assert last_error is not None
        raise last_error

    def unfollow(self, *, user_id: uuid.UUID | str, organization_id: uuid.UUID | str) -> bool:
        """Idempotent. Returns True when a row was actually removed."""
        deleted, _ = OrganizationFollow.objects.filter(
            user_id=user_id, organization_id=organization_id
        ).delete()
        return bool(deleted)

    def set_notify(
        self, *, user_id: uuid.UUID | str, organization_id: uuid.UUID | str, notify: bool
    ) -> bool:
        """Flip the flag on an existing follow. Returns False if there is none.

        One conditional `UPDATE`, not read-modify-write: the row is found and
        written in a single statement, so a concurrent unfollow either happens
        before it (0 rows matched, and the caller is told) or after it, never
        in between.
        """
        updated = OrganizationFollow.objects.filter(
            user_id=user_id, organization_id=organization_id
        ).update(notify=notify)
        return bool(updated)

    def count_followers(self, organization_id: uuid.UUID | str) -> int:
        """The real number on the organizer tab. Uses the `organization` prefix
        of `org_follow_org_notify_idx`; counts muted followers too, because
        somebody who follows without notifications is still a follower."""
        return OrganizationFollow.objects.filter(organization_id=organization_id).count()

    def follower_user_ids_for_notify(self, organization_id: uuid.UUID | str) -> list[uuid.UUID]:
        """THE FAN-OUT. Every user to notify when this organization publishes
        something, in ONE query, ids only.

        `notifications` calls this and resolves whatever it needs per user
        itself. Nothing else is loaded here on purpose: this is the hot path of
        a fan-out that can be thousands of rows wide, and
        `org_follow_org_notify_idx` carries `user` as its last column precisely
        so this comes out of the index without reading a single table row.
        """
        return list(
            OrganizationFollow.objects.filter(
                organization_id=organization_id, notify=True
            ).values_list("user_id", flat=True)
        )

    def list_following(self, user_id: uuid.UUID | str) -> QuerySet[OrganizationFollow]:
        """A user's followed organizations, newest first.

        `select_related` + `.only(...)`: the card fields come back in the same
        query as the follow row, so a page of twenty is one query rather than
        twenty-one.

        Soft-deleted organizations are excluded. Unlike a saved event that has
        been cancelled — which `events` keeps on the list marked unavailable, so
        the save does not look lost — a soft-deleted organization has no page
        left to link to, so a row for it could only ever be a dead end.
        """
        return (
            self.get_queryset()
            .filter(user_id=user_id, organization__deleted_at__isnull=True)
            .select_related("organization")
            .only(*_FOLLOWED_ORG_FIELDS)
            .order_by("-created_at")
        )
