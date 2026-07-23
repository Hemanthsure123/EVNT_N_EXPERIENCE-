from __future__ import annotations

from core.errors import AuthenticationError, ConflictError


class EmailAlreadyRegisteredError(ConflictError):
    """An account with this email already exists."""

    code = "email_already_registered"

    def __init__(self, email: str) -> None:
        super().__init__(f"An account with email '{email}' already exists.")


class InvalidCredentialsError(AuthenticationError):
    """Email/password did not match an active account."""

    code = "invalid_credentials"

    def __init__(self) -> None:
        super().__init__("Invalid email or password.")


class InvalidTokenError(AuthenticationError):
    """A refresh token was missing, expired, blacklisted, or malformed."""

    code = "invalid_token"

    def __init__(self) -> None:
        super().__init__("The provided token is invalid or expired.")
