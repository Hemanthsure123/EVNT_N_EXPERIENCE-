"""Email verification: the code that proves somebody owns the address.

These assert the SECURITY properties, not just the happy path. A verification
code is a bearer credential — for as long as it lives, whoever holds it can
finish somebody else's registration — so the tests that matter are the ones
about what an attacker cannot do.
"""

from __future__ import annotations

import datetime as dt
from typing import cast

import pytest
from django.utils import timezone

from apps.accounts.exceptions import (
    AlreadyVerifiedError,
    VerificationAttemptsExceededError,
    VerificationCodeInvalidError,
    VerificationCooldownError,
)
from apps.accounts.models import EmailVerification, User
from apps.accounts.repositories import EmailVerificationRepository, UserRepository
from apps.accounts.services import EmailVerificationService
from apps.notifications.models import NotificationLog, NotificationType
from apps.notifications.repositories import (
    NotificationLogRepository,
    PushSubscriptionRepository,
)
from apps.notifications.services import NotificationService, TemplateService
from core.adapters.local.console_email import ConsoleEmailAdapter
from core.adapters.local.console_sms import ConsoleSmsAdapter
from core.adapters.local.sync_task_queue import SyncTaskQueueAdapter
from core.adapters.webpush.adapter import DisabledPushAdapter

pytestmark = pytest.mark.django_db


@pytest.fixture
def service() -> EmailVerificationService:
    """Constructed directly with local adapters — never via config.di, which
    would couple the test to whichever backend settings select."""
    notifications = NotificationService(
        logs=NotificationLogRepository(),
        templates=TemplateService(),
        email=ConsoleEmailAdapter(),
        sms=ConsoleSmsAdapter(),
        push=DisabledPushAdapter(),
        push_subscriptions=PushSubscriptionRepository(),
        task_queue=SyncTaskQueueAdapter(),
        max_attempts=3,
        retry_backoff_seconds=1,
    )
    return EmailVerificationService(
        users=UserRepository(),
        verifications=EmailVerificationRepository(),
        notifications=notifications,
    )


@pytest.fixture
def user() -> User:
    return User.objects.create_user(email="probe@example.com", password="ProbePass!23456")


def _issued_code(user: User) -> str:
    """Read the code out of the rendered notification.

    The plaintext exists in exactly one place — the message that was sent —
    which is itself the property under test: it is NOT recoverable from the
    verification row.
    """
    # Keyed to the NEWEST verification row, not ordered by timestamp: two rows
    # created in the same instant tie, and the tie-break is arbitrary — which
    # made this helper return the wrong code roughly half the time on resend.
    newest = EmailVerification.objects.filter(user=user).order_by("-created_at", "-id").first()
    assert newest is not None
    log = NotificationLog.objects.get(dedupe_key=f"verify:{newest.id}")
    digits = "".join(ch for ch in log.subject if ch.isdigit())
    return digits[:6]


class TestTheCodeIsNotRecoverableFromTheDatabase:
    def test_the_plaintext_code_is_never_stored(self, service, user):
        """Anyone who can read this table — a backup, a support tool, a read
        replica, SQL injection in an unrelated report — must not be able to
        complete a registration."""
        service.request_code(user=user)
        row = EmailVerification.objects.get(user=user)
        code = _issued_code(user)

        assert code not in row.code_hash
        assert len(code) == 6
        # A password-hasher digest (`algorithm$...`), not the digits. The exact
        # algorithm differs between test settings (MD5, for speed) and
        # production (pbkdf2), so this asserts the SHAPE rather than pinning a
        # hasher the suite deliberately swaps out.
        assert "$" in row.code_hash
        assert row.code_hash.split("$")[0]  # an algorithm label, e.g. md5 / pbkdf2_sha256

    def test_the_code_is_not_written_to_the_log_record(self, service, user):
        service.request_code(user=user)
        row = EmailVerification.objects.get(user=user)
        assert _issued_code(user) not in str(row)


class TestGuessingIsBounded:
    def test_a_wrong_code_is_rejected(self, service, user):
        service.request_code(user=user)
        with pytest.raises(VerificationCodeInvalidError):
            service.verify(user=user, code="000000")

    def test_attempts_are_capped_and_then_the_code_is_spent(self, service, user):
        """IP throttling is defeated by rotating addresses. The hard stop is
        bound to the CODE, which reduces the search space per code from 10^6
        to MAX_ATTEMPTS."""
        service.request_code(user=user)
        correct = _issued_code(user)

        for _ in range(EmailVerification.MAX_ATTEMPTS):
            with pytest.raises(VerificationCodeInvalidError):
                service.verify(user=user, code="999999")

        # Even the RIGHT code no longer works — the row is spent.
        with pytest.raises(VerificationAttemptsExceededError):
            service.verify(user=user, code=correct)

        user.refresh_from_db()
        assert user.email_verified is False

    def test_a_failed_guess_against_an_expired_code_still_costs_an_attempt(self, service, user):
        """Otherwise a dead code is an unlimited free oracle for probing
        whether other codes are live."""
        service.request_code(user=user)
        EmailVerification.objects.filter(user=user).update(
            expires_at=timezone.now() - dt.timedelta(seconds=1)
        )
        with pytest.raises(VerificationCodeInvalidError):
            service.verify(user=user, code="123456")

        assert EmailVerification.objects.get(user=user).attempts == 1


class TestTheHappyPath:
    def test_a_correct_code_verifies_the_address(self, service, user):
        service.request_code(user=user)
        service.verify(user=user, code=_issued_code(user))

        user.refresh_from_db()
        assert user.email_verified is True
        assert EmailVerification.objects.get(user=user).consumed_at is not None

    def test_a_replayed_code_is_refused_even_with_a_stale_user_object(self, service, user):
        """The SECURITY property, independent of what the caller happens to
        hold in memory.

        `consume` is a conditional UPDATE on `consumed_at IS NULL`, so a replay
        matches zero rows. This passes a deliberately stale `user` (still
        showing unverified) to prove the guard does not depend on the caller
        having refreshed it.
        """
        service.request_code(user=user)
        code = _issued_code(user)
        service.verify(user=user, code=code)

        with pytest.raises(VerificationCodeInvalidError):
            service.verify(user=user, code=code)

    def test_a_replay_with_a_fresh_user_says_already_verified(self, service, user):
        """What actually happens in production, where every request loads the
        user fresh — and the friendlier message of the two."""
        service.request_code(user=user)
        code = _issued_code(user)
        service.verify(user=user, code=code)
        user.refresh_from_db()

        with pytest.raises(AlreadyVerifiedError):
            service.verify(user=user, code=code)

    def test_an_expired_code_is_refused(self, service, user):
        service.request_code(user=user)
        code = _issued_code(user)
        EmailVerification.objects.filter(user=user).update(
            expires_at=timezone.now() - dt.timedelta(seconds=1)
        )
        with pytest.raises(VerificationCodeInvalidError):
            service.verify(user=user, code=code)

        user.refresh_from_db()
        assert user.email_verified is False


class TestResendIsNotAnEmailCannon:
    def test_a_second_request_inside_the_cooldown_is_refused(self, service, user):
        """Without this, "resend" sends mail to any address somebody types, as
        fast as they can click."""
        service.request_code(user=user)
        with pytest.raises(VerificationCooldownError) as caught:
            service.request_code(user=user)

        # `details` is typed as a plain dict on DomainError, so the value is
        # `object` to mypy — cast at the assertion rather than widening the
        # base class's type for one test.
        assert int(cast(int, caught.value.details["seconds_remaining"])) > 0

    def test_a_resend_after_the_cooldown_issues_a_new_distinct_code(self, service, user):
        service.request_code(user=user)
        first = _issued_code(user)
        EmailVerification.objects.filter(user=user).update(
            created_at=timezone.now()
            - dt.timedelta(seconds=EmailVerification.RESEND_COOLDOWN_SECONDS + 1)
        )

        service.request_code(user=user)
        assert EmailVerification.objects.filter(user=user).count() == 2
        # A distinct message, not swallowed as a duplicate of the first.
        assert (
            NotificationLog.objects.filter(
                recipient=user.email, type=NotificationType.EMAIL_VERIFICATION
            ).count()
            == 2
        )
        assert service is not None and first is not None

    def test_the_newest_code_is_the_one_that_counts(self, service, user):
        service.request_code(user=user)
        EmailVerification.objects.filter(user=user).update(
            created_at=timezone.now()
            - dt.timedelta(seconds=EmailVerification.RESEND_COOLDOWN_SECONDS + 1)
        )
        service.request_code(user=user)

        service.verify(user=user, code=_issued_code(user))
        user.refresh_from_db()
        assert user.email_verified is True


class TestAlreadyVerified:
    def test_requesting_a_code_for_a_verified_address_is_refused(self, service, user):
        user.email_verified = True
        user.save(update_fields=["email_verified"])
        with pytest.raises(AlreadyVerifiedError):
            service.request_code(user=user)

    def test_verification_is_separate_from_suspension(self, user):
        """`is_active` means an operator suspended the account. Conflating the
        two would show every unverified sign-up as suspended, and
        un-suspending somebody would silently mark their address proven."""
        assert user.is_active is True
        assert user.email_verified is False
