from __future__ import annotations

from core.errors import (
    AuthenticationError,
    ConflictError,
    DomainError,
    InvalidInputError,
)


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


class CannotSuspendError(ConflictError):
    """A suspension was refused for a reason the operator needs to read."""

    code = "cannot_suspend"


class InvalidTokenError(AuthenticationError):
    """A refresh token was missing, expired, blacklisted, or malformed."""

    code = "invalid_token"

    def __init__(self) -> None:
        super().__init__("The provided token is invalid or expired.")


class EmailNotVerifiedError(AuthenticationError):
    """Correct password, but the address has never been proven.

    A DISTINCT error from `invalid_credentials` on purpose. The frontend has
    to do something different here — offer to resend the code, not tell
    somebody their password is wrong — and it can only do that if the API
    says which of the two happened.

    This does not leak anything an attacker does not already have: reaching
    it requires the correct password.
    """

    code = "email_not_verified"

    def __init__(self) -> None:
        super().__init__("Verify your email address to sign in. We can send you a new code.")


class AccountSuspendedError(AuthenticationError):
    """An operator has taken this account out of service.

    ── WHY THIS IS SAFE TO SAY OUT LOUD ──────────────────────────────────

    It is raised only AFTER the credential has been proven — the password
    checked, or Google having asserted the address. Anyone who reaches this
    line already knows the account exists, so naming its state leaks nothing
    an enumeration attack could use. The same reasoning orders the
    `email_not_verified` check after the password.

    Answering a suspended sign-in with "invalid credentials" — which is what
    this replaced — sends somebody to the password-reset flow to fix a
    password that was never wrong, and they will do that repeatedly. There is
    no self-service route out of a suspension, so the message has to name the
    one route there is.
    """

    code = "account_suspended"

    def __init__(self, message: str = "") -> None:
        super().__init__(
            message
            or (
                "This account has been suspended by an administrator. "
                "Contact support to have it reviewed."
            )
        )


class VerificationCodeInvalidError(InvalidInputError):
    """Wrong code, or a code that has expired or already been used.

    ONE error for all three, deliberately. Telling a caller that a code was
    "expired" rather than "wrong" confirms the code was once valid, which is a
    free oracle for anyone guessing.
    """

    code = "verification_code_invalid"

    def __init__(self) -> None:
        super().__init__("That code is not valid. Request a new one and try again.")


class VerificationAttemptsExceededError(InvalidInputError):
    """The code was guessed at too many times and is now spent."""

    code = "verification_attempts_exceeded"

    def __init__(self) -> None:
        super().__init__("Too many incorrect attempts. Request a new code.")


class VerificationCooldownError(InvalidInputError):
    """A resend was asked for before the cooldown elapsed.

    Without this, "resend" is a button that sends mail to any address somebody
    types, as fast as they can click it.
    """

    code = "verification_cooldown"

    def __init__(self, seconds_remaining: int) -> None:
        super().__init__(f"Please wait {seconds_remaining}s before requesting another code.")
        self.details = {"seconds_remaining": seconds_remaining}


class AlreadyVerifiedError(ConflictError):
    """The address is already verified; there is nothing to confirm."""

    code = "already_verified"

    def __init__(self) -> None:
        super().__init__("This email address is already verified.")


class GoogleSignInUnavailableError(DomainError):
    """No Google credentials on this deployment.

    503, not 400: nothing the caller sent is wrong. The UI asks
    `GET /auth/oauth/google/config` first and hides the button, so reaching
    this means a misconfiguration rather than a user error.
    """

    code = "google_sign_in_unavailable"
    status_code = 503

    def __init__(self) -> None:
        super().__init__("Google sign-in is not configured on this deployment.")


class GoogleSignInCancelledError(InvalidInputError):
    """The user pressed Cancel on Google's consent screen.

    A legitimate choice, reported as such. The frontend returns them to the
    sign-in page without an alarming error.
    """

    code = "google_sign_in_cancelled"

    def __init__(self) -> None:
        super().__init__("Google sign-in was cancelled.")


class GoogleAccountUnverifiedError(AuthenticationError):
    """Google has not proven the address on that Google account.

    Refused because anyone can create a Google account claiming any address.
    Honouring it would let somebody take over an existing Curatix account
    with the same email — bookings, tickets and all.
    """

    code = "google_account_unverified"

    def __init__(self) -> None:
        super().__init__(
            "That Google account's email address is not verified with Google, "
            "so it cannot be used to sign in. Verify it with Google, or sign in "
            "with your password."
        )


class OAuthStateInvalidError(AuthenticationError):
    """The sign-in link expired, was already used, or did not come from us.

    One error for all three, deliberately: distinguishing them would tell an
    attacker which of their guesses was closest.
    """

    code = "oauth_state_invalid"

    def __init__(self) -> None:
        super().__init__("That sign-in link has expired or was already used. Try again.")
