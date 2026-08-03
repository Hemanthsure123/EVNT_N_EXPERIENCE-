"""Business rules for registration, authentication and token lifecycle.

Token issuance is centralised in `issue_tokens`/`refresh_tokens`/`logout`
even though they're thin wrappers over simplejwt: keeping the *only* place
that knows "how we mint a session" inside the service means swapping the
auth mechanism later (e.g. to session cookies, or adding MFA) touches one
class, not every call site."""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import logging
import secrets
import uuid
from dataclasses import asdict, dataclass
from typing import cast

from django.contrib.auth.hashers import check_password, make_password
from django.core.files.uploadedfile import UploadedFile
from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from apps.notifications.models import NotificationType
from apps.notifications.services import NotificationService
from core.audit import record_audit
from core.errors import NotFoundError
from core.events import USER_REGISTERED
from core.ports.cache_port import CachePort
from core.ports.email_port import EmailPort
from core.ports.oidc_port import OidcIdentity, OidcPort
from core.ports.storage_port import StoragePort
from core.ports.task_queue_port import TaskQueuePort
from core.unit_of_work import UnitOfWork
from core.uploads import storage_path, validate_image

from .exceptions import (
    AlreadyVerifiedError,
    CannotSuspendError,
    EmailAlreadyRegisteredError,
    EmailNotVerifiedError,
    GoogleAccountUnverifiedError,
    GoogleSignInCancelledError,
    GoogleSignInUnavailableError,
    InvalidCredentialsError,
    InvalidTokenError,
    OAuthStateInvalidError,
    VerificationAttemptsExceededError,
    VerificationCodeInvalidError,
    VerificationCooldownError,
)
from .models import EmailVerification, User
from .repositories import EmailVerificationRepository, UserRepository

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TokenPair:
    access: str
    refresh: str

    def as_dict(self) -> dict:
        return asdict(self)


class AuthService:
    def __init__(
        self,
        *,
        users: UserRepository,
        email: EmailPort,
        task_queue: TaskQueuePort,
        verification: EmailVerificationService | None = None,
    ) -> None:
        self._users = users
        self._email = email
        self._task_queue = task_queue
        # Optional so the many tests that construct AuthService for token or
        # suspension behaviour do not all have to build a notification stack
        # they never exercise. Production always wires it (see config/di.py),
        # and `register` says plainly what an absent one means.
        self._verification = verification

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

        # AFTER the transaction commits, deliberately.
        #
        # Issuing the code renders a template and enqueues a send. Neither
        # needs to be atomic with the user row, and holding the transaction
        # open across them would add that work to a lock window — the same
        # "external I/O outside the transaction" rule the performance
        # checklist applies to storage uploads and payment calls.
        #
        # It is a DIRECT call rather than an observer on USER_REGISTERED
        # because it is not an eventual side effect: if no code is issued the
        # user cannot proceed, so the failure must surface on this request.
        if self._verification is not None:
            self._verification.request_code(user=user)

        logger.info("user_registered", extra={"user_id": str(user.id)})
        return user

    def authenticate(self, *, email: str, password: str) -> User:
        user = self._users.get_by_email(email)
        if user is None or not user.is_active or not user.check_password(password):
            raise InvalidCredentialsError()
        # Checked AFTER the password, on purpose. Answering "verify your email"
        # to a wrong password would confirm that an account exists for that
        # address — a free enumeration oracle. Reaching this line requires
        # already knowing the password.
        if not user.email_verified:
            raise EmailNotVerifiedError()
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


class ProfileService:
    """What an account holder can change about their own profile.

    Its own service rather than a method on `AuthService`, for the same reason
    `EmailVerificationService` is: it needs `StoragePort` (which auth does
    not) and none of the token machinery, so composing it separately keeps
    each dependency list honest about what its class actually uses. It is also
    the natural home for the rest of a settings screen — display name, phone —
    when those get write endpoints.

    Authorization is trivial here and stays that way ON PURPOSE: every method
    takes the acting user's own id and there is no `user_id` parameter a
    caller could point at somebody else. Changing another account's picture is
    not a capability this class has, so it cannot be reached by forgetting a
    check. Operator actions on somebody else's account live in
    `AccountAdminService`, which is the split this file already makes.
    """

    def __init__(self, *, users: UserRepository, storage: StoragePort) -> None:
        self._users = users
        self._storage = storage

    def set_avatar(self, *, user_id: uuid.UUID | str, upload: UploadedFile) -> User:
        """Validate the file, store it, then point the row at it — in that order.

        ── WHY THE VALIDATION IS `core.uploads.validate_image` ──────────────

        Not re-implemented here. That module checks size first (from
        `UploadedFile.size`, so an oversized upload is refused without ever
        being read into memory), then the DECLARED content type against an
        allow-list, then the file's LEADING BYTES against that declared type.
        SVG is absent from the allow-list because it is an XML document that
        can carry script: serving one back from our own origin — which is
        precisely what an avatar does, on every page the user appears on — is
        a stored-XSS primitive. An avatar is the single most widely rendered
        user-supplied image on the platform, so it is the last place to have a
        second, laxer copy of these rules.

        ── WHY THE UPLOAD IS OUTSIDE THE TRANSACTION ───────────────────────

        Storage is slow external I/O, and a DB transaction must not hold a
        connection open across it (performance checklist rule 5). If the
        write below fails, the orphaned object is harmless — far better than
        a row pointing at bytes that were never stored.
        """
        content_type = validate_image(upload)
        path = storage_path(
            prefix="avatars", owner_id=str(user_id), filename=upload.name or "avatar"
        )
        url = self._storage.upload(path=path, content=upload.read(), content_type=content_type)

        return self._apply_avatar(user_id=user_id, url=url, action="user.avatar_updated")

    def clear_avatar(self, *, user_id: uuid.UUID | str) -> User:
        """Remove the profile picture.

        The stored OBJECT is deliberately left in place. The column holds a
        URL, not a storage key, and reversing a URL back into the key that
        produced it is adapter-specific guesswork that would silently delete
        the wrong thing (or nothing) the moment `STORAGE_BACKEND` changed.
        `organizations` and `events` leave superseded images behind for the
        same reason; reaping them belongs in one storage-lifecycle job that
        knows the key format, not in five call sites that infer it.
        """
        return self._apply_avatar(user_id=user_id, url="", action="user.avatar_cleared")

    def _apply_avatar(self, *, user_id: uuid.UUID | str, url: str, action: str) -> User:
        with UnitOfWork():
            if not self._users.set_avatar_url(user_id=user_id, url=url):
                # The authenticated user's row vanished between the JWT being
                # verified and this write — a hard delete by an operator, or a
                # test doing something odd. Reported rather than returning a
                # stale in-memory profile that claims the change landed.
                raise NotFoundError("No account with that id.")
            record_audit(
                actor_id=str(user_id),
                action=action,
                target_type="user",
                target_id=str(user_id),
            )

        user = self._users.get_by_id(user_id)
        if user is None:  # pragma: no cover - deleted between the two statements
            raise NotFoundError("No account with that id.")
        return user


class AccountAdminService:
    """A platform operator's actions on an account.

    Deliberately a SEPARATE service from `AuthService`, for the same reason
    `EventModerationService` is separate from `EventService`: every method on
    `AuthService` acts on behalf of the account holder, and every method here
    acts on somebody else's account. Mixing the two in one class is how an
    authorization check eventually gets skipped on the write that needed it.

    The caller is staff — enforced at the view, the way the console's other
    endpoints do it. What this class owns is the rules that hold regardless of
    WHO the operator is.
    """

    def __init__(self, *, users: UserRepository) -> None:
        self._users = users

    def set_suspended(
        self,
        *,
        user_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        suspended: bool,
        reason: str = "",
    ) -> User:
        """Suspend or reinstate an account.

        Suspension sets `is_active = False`, which `authenticate` already
        refuses — so it has real teeth rather than being a display flag. It is
        also fully REVERSIBLE, which is why this is a suspension and not a
        delete: an account is referenced by bookings, tickets and payments, and
        removing one would orphan somebody's ticket to an event they are
        attending tomorrow.

        Two refusals, and both exist because of what they prevent:

        - **An operator cannot suspend themselves.** The very next request
          would 401 and they would have locked themselves out of the console
          that fixes it.
        - **An operator cannot suspend another staff member.** Staff can
          suspend each other in a loop until nobody can sign in; taking someone
          out of the operator group is a deliberate, separate action that
          belongs with whoever administers roles.
        """
        user = self._users.get_by_id(user_id)
        if user is None:
            raise NotFoundError("No account with that id.")

        if suspended and str(user.id) == str(actor_id):
            raise CannotSuspendError(
                "You cannot suspend your own account — you would be locked out immediately."
            )
        if suspended and user.is_staff:
            raise CannotSuspendError(
                "Staff accounts cannot be suspended from here. Remove their operator role first."
            )

        changed = self._users.set_active(user_id=user.id, active=not suspended)
        if not changed:
            # Already in the requested state. Reported rather than silently
            # succeeding, so a double-click does not write a second audit row
            # claiming a second suspension.
            raise CannotSuspendError(
                f"That account is already {'suspended' if suspended else 'active'}."
            )

        record_audit(
            actor_id=str(actor_id),
            action="user.suspended" if suspended else "user.reinstated",
            target_type="user",
            target_id=str(user.id),
            metadata={"reason": reason} if reason else {},
        )
        logger.info(
            "account_suspension_changed",
            extra={"user_id": str(user.id), "suspended": suspended},
        )

        refreshed = self._users.get_by_id(user.id)
        if refreshed is None:  # pragma: no cover - just deleted mid-request
            raise NotFoundError("No account with that id.")
        return refreshed


class EmailVerificationService:
    """Issue and check the one-time code that proves an address.

    Split from `AuthService` for the same reason `AccountAdminService` is:
    every method here is about ONE narrow capability with its own rules and
    its own failure modes, and folding it into the class that also mints
    sessions makes both harder to read.

    ── THE THREE THINGS THAT MAKE THIS SAFE ─────────────────────────────

    1. The code is RANDOM from `secrets`, never `random`. The `random` module
       is a Mersenne Twister seeded from the clock — observing a few outputs
       predicts the rest, which for a verification code means predicting
       somebody else's.
    2. It is stored HASHED and compared with the password hasher, so reading
       the table does not yield a usable code and the comparison does not leak
       timing.
    3. Guesses are bounded ON THE ROW, under a lock. IP throttling alone is
       defeated by rotating addresses; the per-code budget is not.
    """

    def __init__(
        self,
        *,
        users: UserRepository,
        verifications: EmailVerificationRepository,
        notifications: NotificationService,
    ) -> None:
        self._users = users
        self._verifications = verifications
        self._notifications = notifications

    @staticmethod
    def _generate_code() -> str:
        """Six digits, uniformly distributed, cryptographically random.

        `randbelow(10**6)` zero-padded — not `randint` on each digit, which is
        six times the work for the same result, and not a token_hex slice,
        which would be hostile to type on a phone.
        """
        return f"{secrets.randbelow(1_000_000):06d}"

    def request_code(self, *, user: User) -> None:
        """Issue a code and email it. Idempotent-ish: honours a cooldown.

        Raises `AlreadyVerifiedError` if there is nothing to prove, and
        `VerificationCooldownError` if asked again too soon.
        """
        if user.email_verified:
            raise AlreadyVerifiedError()

        previous = self._verifications.latest_for_user(user.id)
        if previous is not None:
            elapsed = (timezone.now() - previous.created_at).total_seconds()
            remaining = EmailVerification.RESEND_COOLDOWN_SECONDS - int(elapsed)
            if remaining > 0:
                raise VerificationCooldownError(remaining)

        code = self._generate_code()
        expires_at = timezone.now() + dt.timedelta(minutes=EmailVerification.TTL_MINUTES)

        with UnitOfWork():
            verification = self._verifications.create_for(
                user_id=user.id, code_hash=make_password(code), expires_at=expires_at
            )

        # OUTSIDE the transaction: notify() renders and enqueues, and neither
        # needs to be atomic with the row. Holding a DB transaction open across
        # it would add the render time to a lock window for no benefit.
        #
        # The dedupe key is the VERIFICATION ROW'S ID — one message per code.
        #
        # It was a timestamp first, which was wrong in a way only a test found:
        # two requests inside the same second produced the same key, so a
        # legitimate resend was swallowed as a duplicate and the user waited
        # for an email that the idempotency ledger had already decided not to
        # send. The row id is unique by construction and needs no reasoning
        # about clock resolution.
        self._notifications.notify(
            notification_type=NotificationType.EMAIL_VERIFICATION,
            recipient=user.email,
            context={
                "full_name": user.full_name or user.email,
                "code": code,
                "ttl_minutes": EmailVerification.TTL_MINUTES,
            },
            dedupe_key=f"verify:{verification.id}",
        )
        # The code itself is NEVER logged. It is a live credential, and an
        # application log is the least controlled place in the system.
        logger.info("email_verification_requested", extra={"user_id": str(user.id)})

    def verify(self, *, user: User, code: str) -> None:
        """Check a code and, on success, mark the address verified."""
        if user.email_verified:
            raise AlreadyVerifiedError()

        latest = self._verifications.latest_for_user(user.id)
        if latest is None:
            raise VerificationCodeInvalidError()

        # ── THE OUTCOME IS CARRIED OUT OF THE BLOCK, NOT RAISED INSIDE IT ──
        #
        # Raising inside `atomic()` rolls the transaction back — INCLUDING the
        # attempt counter we just incremented. The guess budget would never
        # decrease and MAX_ATTEMPTS would be unreachable, which is the whole
        # defence against brute-forcing six digits.
        #
        # This is the same bug the Google Calendar adapter documents (marking a
        # grant `needs_reconnect` and then raising, so the mark never landed).
        # It was caught here by `test_attempts_are_capped_and_then_the_code_is
        # _spent`, which is exactly what that test is for.
        failure: Exception | None = None
        with transaction.atomic():
            # Locked so two concurrent guesses cannot both read the same
            # attempt count and each write count+1, silently granting an extra
            # guess per racing request.
            locked = self._verifications.lock_for_update(latest.id)
            if locked is None:
                failure = VerificationCodeInvalidError()
            elif locked.attempts >= EmailVerification.MAX_ATTEMPTS:
                failure = VerificationAttemptsExceededError()
            else:
                spent = locked.consumed_at is not None or locked.expires_at <= timezone.now()
                if spent or not check_password(code, locked.code_hash):
                    # The attempt is recorded even for an expired/used row:
                    # without it, a spent code becomes an unlimited free oracle
                    # for probing whether OTHER codes are live.
                    self._verifications.record_attempt(locked.id)
                    failure = VerificationCodeInvalidError()
                elif not self._verifications.consume(locked.id):
                    # Lost a race to another verify of the same code.
                    failure = VerificationCodeInvalidError()
                else:
                    self._verifications.mark_email_verified(user.id)

        if failure is not None:
            raise failure

        record_audit(
            actor_id=str(user.id),
            action="user.email_verified",
            target_type="user",
            target_id=str(user.id),
        )
        logger.info("email_verified", extra={"user_id": str(user.id)})

    # ── EMAIL-KEYED ENTRY POINTS ────────────────────────────────────────
    #
    # The verify screen runs BEFORE the user has a session — they registered,
    # closed the tab, and came back — so these resolve the account from the
    # address rather than from `request.user`.
    #
    # They do not try to hide whether an address is registered. That would be
    # theatre: `POST /auth/register` already answers `email_already_registered`
    # for a taken address, so existence is discoverable by design. Pretending
    # otherwise here would cost real feedback (a cooldown the user can see)
    # and buy nothing.

    def request_code_for_email(self, *, email: str) -> None:
        """Resend for an address. Silent no-op when no such account exists."""
        user = self._users.get_by_email(email)
        if user is None:
            # No account: nothing to send, and nothing to say. Returning
            # normally keeps the endpoint's timing and response identical to
            # the "sent" case for an address that was never registered.
            logger.info("email_verification_requested_for_unknown_address")
            return
        self.request_code(user=user)

    def verify_for_email(self, *, email: str, code: str) -> User:
        """Verify by address + code, returning the now-verified user.

        A wrong address and a wrong code produce the SAME error, so this
        cannot be used to test which addresses are registered.
        """
        user = self._users.get_by_email(email)
        if user is None:
            raise VerificationCodeInvalidError()
        self.verify(user=user, code=code)
        user.refresh_from_db()
        return user


#: How long a completed sign-in may sit waiting for the SPA to collect it.
#: Short: it is a bearer credential for a full session.
HANDOFF_TTL_SECONDS = 120
#: How long the user has between pressing the button and Google returning.
OAUTH_STATE_TTL_SECONDS = 600


class GoogleSignInService:
    """Sign in with Google.

    Lives in `accounts`, not `integrations`, because what it produces is an
    CURATIX SESSION — finding or creating a user and minting our own tokens
    is this module's job. The Google-specific HTTP sits behind `OidcPort`, so
    this class contains policy and no vendor detail.

    ── THE TWO DECISIONS THAT MATTER ────────────────────────────────────

    1. **Linking.** An address that already has a password account is
       ADOPTED, not duplicated — but only when Google says the address is
       verified. Anyone can create a Google account claiming any address;
       without that check, signing in with an unverified Google account would
       hand over the existing Curatix account with the same email. This is
       the single most dangerous line in the file.

    2. **Delivery.** The callback is a browser redirect, so the tokens have to
       reach a single-page app. They are NOT put in the URL — not in the query
       (server logs, Referer) and not in the fragment (browser history).
       Instead the callback stores them under a one-time handoff code and
       redirects with that; the SPA POSTs it back and gets the tokens in a
       response body. The code is single-use and lives for two minutes.
    """

    def __init__(
        self,
        *,
        users: UserRepository,
        oidc: OidcPort,
        cache: CachePort,
        auth: AuthService,
        redirect_uri: str,
    ) -> None:
        self._users = users
        self._oidc = oidc
        self._cache = cache
        self._auth = auth
        self._redirect_uri = redirect_uri

    @staticmethod
    def _state_key(state: str) -> str:
        return f"oauth:signin:state:{state}"

    @staticmethod
    def _handoff_key(handoff: str) -> str:
        return f"oauth:signin:handoff:{handoff}"

    def is_available(self) -> bool:
        return self._oidc.is_configured()

    def start(self, *, next_path: str = "", login_hint: str = "") -> str:
        """Return the URL to send the browser to."""
        if not self._oidc.is_configured():
            raise GoogleSignInUnavailableError()

        state = secrets.token_urlsafe(32)
        verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        )

        # The state entry IS the pending sign-in. Server-side because the
        # callback arrives as a plain redirect with no header of ours, and it
        # carries the PKCE verifier so a stolen authorization code is useless
        # without it.
        #
        # `next_path` rides along here rather than in the query string, so a
        # user cannot be redirected somewhere they did not choose by editing
        # the callback URL. It is re-validated as a same-origin path anyway.
        self._cache.set(
            self._state_key(state),
            {"code_verifier": verifier, "next": next_path},
            timeout_seconds=OAUTH_STATE_TTL_SECONDS,
        )
        return self._oidc.build_authorization_url(
            state=state,
            code_challenge=challenge,
            redirect_uri=self._redirect_uri,
            login_hint=login_hint,
        )

    def complete(self, *, state: str, code: str = "", error: str = "") -> tuple[str, str]:
        """Handle Google's redirect. Returns `(handoff_code, next_path)`."""
        if not state:
            raise OAuthStateInvalidError()

        # CONSUMED before any work, so a replayed callback finds nothing and a
        # crash mid-exchange cannot leave a redeemable state behind.
        pending = self._cache.get(self._state_key(state))
        self._cache.delete(self._state_key(state))
        if not pending:
            raise OAuthStateInvalidError()

        if error:
            raise (
                GoogleSignInCancelledError()
                if error == "access_denied"
                else OAuthStateInvalidError()
            )
        if not code:
            raise OAuthStateInvalidError()

        identity = self._oidc.exchange_code(
            code=code,
            code_verifier=str(pending["code_verifier"]),
            redirect_uri=self._redirect_uri,
        )

        user = self._find_or_create(identity)
        tokens = self._auth.issue_tokens(user)

        handoff = secrets.token_urlsafe(32)
        self._cache.set(
            self._handoff_key(handoff),
            {"access": tokens.access, "refresh": tokens.refresh},
            timeout_seconds=HANDOFF_TTL_SECONDS,
        )
        record_audit(
            actor_id=str(user.id),
            action="user.login.google",
            target_type="user",
            target_id=str(user.id),
        )
        return handoff, str(pending.get("next") or "")

    def redeem(self, *, handoff: str) -> TokenPair:
        """Exchange a handoff code for the session it stands for. Single use."""
        stored = self._cache.get(self._handoff_key(handoff))
        # Deleted whether or not it was found: there is no reason to leave a
        # valid one behind after any redemption attempt.
        self._cache.delete(self._handoff_key(handoff))
        if not stored:
            raise OAuthStateInvalidError()
        return TokenPair(access=str(stored["access"]), refresh=str(stored["refresh"]))

    def _find_or_create(self, identity: OidcIdentity) -> User:
        existing = self._users.get_by_email(identity.email)

        if existing is not None:
            if not identity.email_verified:
                # THE dangerous case. A Google account can carry any address
                # until Google proves it; adopting one here would hand over
                # somebody's existing Curatix account — bookings, tickets and
                # all — to whoever created it.
                raise GoogleAccountUnverifiedError()
            if not existing.is_active:
                # Suspension is an access decision and it applies to every
                # route in, not just the password one.
                raise InvalidCredentialsError()
            if not existing.email_verified:
                # Google has proven the address, so our own pending
                # verification is satisfied — there is nothing left to prove
                # and making them type a code we no longer need would be
                # friction for its own sake.
                self._users.mark_email_verified_by_google(existing.id)
                existing.refresh_from_db()
            return existing

        if not identity.email_verified:
            raise GoogleAccountUnverifiedError()

        # A password is still set, to a value nobody holds: `create_user`
        # hashes it, so the account cannot be signed into with a password
        # until the user sets one via a reset. Leaving it unusable is safer
        # than leaving it empty.
        user = self._users.create_user(
            email=identity.email,
            password=secrets.token_urlsafe(48),
            full_name=identity.full_name,
        )
        self._users.mark_email_verified_by_google(user.id)
        user.refresh_from_db()
        logger.info("user_registered_via_google", extra={"user_id": str(user.id)})
        return user
