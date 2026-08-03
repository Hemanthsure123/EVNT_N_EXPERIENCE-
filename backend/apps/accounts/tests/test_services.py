import pytest

from apps.accounts.exceptions import (
    EmailAlreadyRegisteredError,
    EmailNotVerifiedError,
    InvalidCredentialsError,
    InvalidTokenError,
)
from apps.accounts.models import User
from apps.accounts.repositories import UserRepository
from apps.accounts.services import AuthService
from core.adapters.local.console_email import ConsoleEmailAdapter
from core.adapters.local.sync_task_queue import SyncTaskQueueAdapter
from core.models import OutboxEvent


@pytest.fixture
def auth_service() -> AuthService:
    return AuthService(
        users=UserRepository(), email=ConsoleEmailAdapter(), task_queue=SyncTaskQueueAdapter()
    )


@pytest.mark.django_db
def test_register_creates_an_active_user_with_a_hashed_password(auth_service):
    user = auth_service.register(
        email="new@example.com", password="s3cur3pass", full_name="New User"
    )

    assert user.pk is not None
    assert user.is_active is True
    assert user.full_name == "New User"
    assert user.check_password("s3cur3pass") is True


@pytest.mark.django_db
def test_register_writes_a_user_registered_outbox_event(auth_service):
    user = auth_service.register(email="evented@example.com", password="s3cur3pass")

    event = OutboxEvent.objects.get(event_type="accounts.user_registered")
    assert event.aggregate_id == str(user.id)
    assert event.payload["email"] == "evented@example.com"


@pytest.mark.django_db
def test_register_rejects_a_duplicate_email_case_insensitively(auth_service):
    auth_service.register(email="dup@example.com", password="s3cur3pass")

    with pytest.raises(EmailAlreadyRegisteredError):
        auth_service.register(email="DUP@example.com", password="anotherpass1")


@pytest.mark.django_db
def test_authenticate_returns_the_user_on_correct_credentials(auth_service):
    auth_service.register(email="user@example.com", password="correct-pass")
    # Registration no longer grants access on its own — the address has to be
    # proven first. `test_authenticate_refuses_an_unverified_account` below
    # covers the other side of that.
    User.objects.filter(email="user@example.com").update(email_verified=True)

    user = auth_service.authenticate(email="user@example.com", password="correct-pass")

    assert user.email == "user@example.com"


@pytest.mark.django_db
def test_authenticate_refuses_an_unverified_account(auth_service):
    """Correct password, unproven address — a DISTINCT error so the frontend
    can offer to resend the code instead of claiming the password is wrong."""
    auth_service.register(email="unproven@example.com", password="correct-pass")

    with pytest.raises(EmailNotVerifiedError):
        auth_service.authenticate(email="unproven@example.com", password="correct-pass")


@pytest.mark.django_db
def test_authenticate_rejects_wrong_password(auth_service):
    auth_service.register(email="user2@example.com", password="correct-pass")

    with pytest.raises(InvalidCredentialsError):
        auth_service.authenticate(email="user2@example.com", password="wrong-pass")


@pytest.mark.django_db
def test_authenticate_rejects_unknown_email(auth_service):
    with pytest.raises(InvalidCredentialsError):
        auth_service.authenticate(email="ghost@example.com", password="whatever123")


@pytest.mark.django_db
def test_authenticate_rejects_an_inactive_user(auth_service):
    user = auth_service.register(email="inactive@example.com", password="correct-pass")
    user.is_active = False
    user.save(update_fields=["is_active"])

    with pytest.raises(InvalidCredentialsError):
        auth_service.authenticate(email="inactive@example.com", password="correct-pass")


@pytest.mark.django_db
def test_issue_and_refresh_tokens(auth_service):
    user = auth_service.register(email="tok@example.com", password="correct-pass")

    tokens = auth_service.issue_tokens(user)
    assert tokens.access
    assert tokens.refresh

    refreshed = auth_service.refresh_tokens(tokens.refresh)
    assert refreshed.access


@pytest.mark.django_db
def test_refresh_rejects_a_garbage_token(auth_service):
    with pytest.raises(InvalidTokenError):
        auth_service.refresh_tokens("not-a-real-token")


@pytest.mark.django_db
def test_logout_blacklists_the_refresh_token(auth_service):
    user = auth_service.register(email="logout@example.com", password="correct-pass")
    tokens = auth_service.issue_tokens(user)

    auth_service.logout(user=user, refresh_token=tokens.refresh)

    with pytest.raises(InvalidTokenError):
        auth_service.refresh_tokens(tokens.refresh)


@pytest.mark.django_db
def test_logout_rejects_a_garbage_token(auth_service):
    user = auth_service.register(email="logout2@example.com", password="correct-pass")

    with pytest.raises(InvalidTokenError):
        auth_service.logout(user=user, refresh_token="garbage")
