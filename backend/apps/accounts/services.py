"""Business rules for registration, authentication and token lifecycle.

Token issuance is centralised in `issue_tokens`/`refresh_tokens`/`logout`
even though they're thin wrappers over simplejwt: keeping the *only* place
that knows "how we mint a session" inside the service means swapping the
auth mechanism later (e.g. to session cookies, or adding MFA) touches one
class, not every call site."""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from typing import cast

from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from core.audit import record_audit
from core.events import USER_REGISTERED
from core.ports.email_port import EmailPort
from core.ports.task_queue_port import TaskQueuePort
from core.unit_of_work import UnitOfWork

from .exceptions import EmailAlreadyRegisteredError, InvalidCredentialsError, InvalidTokenError
from .models import User
from .repositories import UserRepository

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TokenPair:
    access: str
    refresh: str

    def as_dict(self) -> dict:
        return asdict(self)


class AuthService:
    def __init__(
        self, *, users: UserRepository, email: EmailPort, task_queue: TaskQueuePort
    ) -> None:
        self._users = users
        self._email = email
        self._task_queue = task_queue

    def register(self, *, email: str, password: str, full_name: str = "") -> User:
        if self._users.email_exists(email):
            raise EmailAlreadyRegisteredError(email)

        with UnitOfWork() as uow:
            user = self._users.create_user(email=email, password=password, full_name=full_name)
            uow.publish(
                USER_REGISTERED,
                {"user_id": str(user.id), "email": user.email, "full_name": user.full_name},
                aggregate_id=str(user.id),
            )
            record_audit(
                actor_id=str(user.id),
                action="user.registered",
                target_type="user",
                target_id=str(user.id),
            )

        logger.info("user_registered", extra={"user_id": str(user.id)})
        return user

    def authenticate(self, *, email: str, password: str) -> User:
        user = self._users.get_by_email(email)
        if user is None or not user.is_active or not user.check_password(password):
            raise InvalidCredentialsError()
        record_audit(
            actor_id=str(user.id), action="user.login", target_type="user", target_id=str(user.id)
        )
        return user

    def issue_tokens(self, user: User) -> TokenPair:
        # simplejwt's own type hints are inaccurate here: for_user() is
        # annotated to return the base `Token`, and Token.__init__ is
        # annotated to take another `Token` — but its body decodes `token`
        # as an encoded JWT string, which is the real, documented contract.
        refresh = cast(RefreshToken, RefreshToken.for_user(user))
        return TokenPair(access=str(refresh.access_token), refresh=str(refresh))

    def refresh_tokens(self, refresh_token: str) -> TokenPair:
        try:
            refresh = RefreshToken(refresh_token)  # type: ignore[arg-type]
            access = refresh.access_token
        except TokenError as exc:
            raise InvalidTokenError() from exc
        return TokenPair(access=str(access), refresh=str(refresh))

    def logout(self, *, user: User, refresh_token: str) -> None:
        try:
            RefreshToken(refresh_token).blacklist()  # type: ignore[arg-type]
        except TokenError as exc:
            raise InvalidTokenError() from exc
        record_audit(
            actor_id=str(user.id), action="user.logout", target_type="user", target_id=str(user.id)
        )
