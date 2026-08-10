from __future__ import annotations

import datetime as dt
import uuid
from collections.abc import Iterable

from django.db.models import F, QuerySet
from django.utils import timezone

from core.base_repository import BaseRepository

from .models import EmailVerification, User


class UserRepository(BaseRepository[User]):
    model = User

    def get_by_email(self, email: str) -> User | None:
        return self.get_queryset().filter(email__iexact=email).first()

    def list_by_ids(self, ids: Iterable[uuid.UUID | str]) -> QuerySet[User]:
        """Fetch many users in ONE query (e.g. all a reminder's recipients),
        so a fan-out never N+1s a lookup per id."""
        return self.get_queryset().filter(id__in=list(ids))

    def email_exists(self, email: str) -> bool:
        return self.get_queryset().filter(email__iexact=email).exists()

    def create_user(self, *, email: str, password: str, full_name: str = "") -> User:
        return User.objects.create_user(email=email, password=password, full_name=full_name)

    def set_active(self, *, user_id: uuid.UUID | str, active: bool) -> bool:
        """Suspend or reinstate an account.

        A conditional UPDATE rather than a read-modify-write, so two operators
        acting at once cannot both believe they made the change. It returns
        False when the row is ALREADY in the requested state, which is what
        lets the service tell "suspended them" apart from "they were already
        suspended" without a second query.
        """
        updated = (
            self.get_queryset()
            .filter(pk=user_id)
            .exclude(is_active=active)
            .update(is_active=active)
        )
        return updated == 1

    def set_avatar_url(self, *, user_id: uuid.UUID | str, url: str) -> bool:
        """Point the profile picture at `url`, or clear it with `""`.

        A targeted UPDATE of the one column rather than `save()` on a loaded
        instance: the caller already holds a `User` deserialized from the JWT
        auth backend, and a full `save()` would write every field on that
        object back — including any that another request changed in between.
        """
        updated = self.get_queryset().filter(pk=user_id).update(avatar_url=url)
        return updated == 1

    def update_profile_fields(self, *, user_id: uuid.UUID | str, **fields) -> bool:
        """Write ONLY the columns the caller supplied.

        A targeted UPDATE for the same reason `set_avatar_url` is one: the
        caller holds a `User` deserialized by the JWT auth backend, and a
        `save()` on that object would write every field back — including any
        another request changed in between, and including `email_verified`,
        which a profile edit must never be able to flip.

        `**fields` is closed by the service, which builds the dict from two
        named parameters. It is not a passthrough of client input.
        """
        if not fields:
            return True
        updated = self.get_queryset().filter(pk=user_id).update(**fields)
        return updated == 1

    def revoke_verification(self, user_id: uuid.UUID | str) -> bool:
        """Untrust the address AND take the account out of service, in ONE
        statement.

        One `UPDATE` rather than two, so there is no window in which the
        address is untrusted but the account is still reachable — in that
        window the verify endpoint would hand out a fresh code and undo the
        operator's decision before they finished reading the confirmation.
        """
        updated = (
            self.get_queryset().filter(pk=user_id).update(email_verified=False, is_active=False)
        )
        return updated == 1

    def mark_email_verified_by_google(self, user_id: uuid.UUID | str) -> bool:
        """Google proved the address, so our own code is moot.

        On `UserRepository` rather than the verification repository because it
        touches the USER row and has nothing to do with a code we issued —
        there may not even be one.
        """
        updated = User.objects.filter(pk=user_id, email_verified=False).update(email_verified=True)
        return updated == 1


class EmailVerificationRepository(BaseRepository[EmailVerification]):
    model = EmailVerification

    def latest_for_user(self, user_id: uuid.UUID | str) -> EmailVerification | None:
        """The most recently issued code, spent or not.

        Deliberately NOT filtered to live codes: the cooldown check needs to
        see the last SEND, and the verify path needs to distinguish "wrong
        code" from "this code is spent" without a second query.
        """
        return EmailVerification.objects.filter(user_id=user_id).order_by("-created_at").first()

    def create_for(
        self, *, user_id: uuid.UUID | str, code_hash: str, expires_at: dt.datetime
    ) -> EmailVerification:
        return EmailVerification.objects.create(
            user_id=user_id, code_hash=code_hash, expires_at=expires_at
        )

    def lock_for_update(self, verification_id: uuid.UUID | str) -> EmailVerification | None:
        """Row lock for the verify decision.

        Two concurrent verifies of the same code must not both succeed, and —
        more importantly — must not both read `attempts` as 4 and each write 5,
        losing a guess from the budget. Same reason ticketing locks a tier row
        before deciding.
        """
        return EmailVerification.objects.select_for_update().filter(pk=verification_id).first()

    def record_attempt(self, verification_id: uuid.UUID | str) -> None:
        EmailVerification.objects.filter(pk=verification_id).update(attempts=F("attempts") + 1)

    def consume(self, verification_id: uuid.UUID | str) -> bool:
        """Mark used. Conditional on not already being used, so a replay of the
        same correct code cannot verify twice."""
        return (
            EmailVerification.objects.filter(pk=verification_id, consumed_at__isnull=True).update(
                consumed_at=timezone.now()
            )
            == 1
        )

    def mark_email_verified(self, user_id: uuid.UUID | str) -> bool:
        updated = User.objects.filter(pk=user_id, email_verified=False).update(email_verified=True)
        return updated == 1
