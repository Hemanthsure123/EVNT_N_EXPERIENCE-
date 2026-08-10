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
    AccountSuspendedError,
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
from .models import EmailVerification, Gender, User
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
        existing = self._users.get_by_email(email)
        if existing is not None:
            if not existing.is_active:
                # A suspended person's most likely next move is to sign up
                # again with the same address, and "that email is already
                # registered" sends them round the loop once more — to a
                # sign-in that will not work either. This is the one place the
                # dead end has to be named.
                #
                # It reveals that a taken address is suspended, which
                # `EmailAlreadyRegisteredError` did not. That is a real, small
                # disclosure and it is the right trade: the address being taken
                # is already public from this endpoint, and the alternative is
                # a person with no route to the only thing that can help them.
                raise AccountSuspendedError()
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
        if user is None or not user.check_password(password):
            raise InvalidCredentialsError()
        # BOTH of the checks below are AFTER the password, on purpose.
        # Answering "verify your email" or "you are suspended" to a WRONG
        # password would confirm that an account exists for that address — a
        # free enumeration oracle. Reaching this line requires already knowing
        # the password, so naming the real state leaks nothing.
        #
        # Suspension used to be folded into `InvalidCredentialsError` above,
        # which sent a suspended user to reset a password that was never
        # wrong — repeatedly, because there is no self-service way out of a
        # suspension and nothing on screen said so.
        if not user.is_active:
            raise AccountSuspendedError()
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


#: "Not supplied" for a field whose empty value is `None`.
#:
#: `update_profile` is partial BY OMISSION, and `date_of_birth` is the one
#: field where null is a real answer ("remove it") rather than an absence — so
#: it needs a sentinel that no caller could send. Every other field there uses
#: `None` for absent because their empty value is `""`.
_UNSET: object = object()


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

    def complete_onboarding(self, *, user_id: uuid.UUID | str) -> User:
        """Mark the welcome flow answered, whether it was filled in or skipped.

        ── SKIPPING SETS IT, AND THAT IS THE POINT ────────────────────────

        A person who declined has ANSWERED the question. Re-prompting them on
        the next visit is nagging, and nagging on the way to a ticket is how a
        product loses the people who only ever wanted a ticket. So the flow is
        never a wall: it can be walked past, and walking past it counts.

        Idempotent, and it keeps the FIRST timestamp. A second call is a
        double-submit or a redelivery, and rewriting the mark would make
        "finished onboarding in July" quietly become today — losing the one
        piece of information a timestamp has over a boolean.
        """
        user = self._users.get_by_id(user_id)
        if user is None:
            raise NotFoundError("No account with that id.")
        if user.onboarding_completed_at is not None:
            return user

        with UnitOfWork():
            self._users.update_profile_fields(
                user_id=user_id, onboarding_completed_at=timezone.now()
            )
            record_audit(
                actor_id=str(user_id),
                action="user.onboarding_completed",
                target_type="user",
                target_id=str(user_id),
            )

        refreshed = self._users.get_by_id(user_id)
        if refreshed is None:  # pragma: no cover — just deleted mid-request
            raise NotFoundError("No account with that id.")
        return refreshed

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

    def update_profile(
        self,
        *,
        user_id: uuid.UUID | str,
        full_name: str | None = None,
        phone: str | None = None,
        date_of_birth=_UNSET,
        gender: str | None = None,
        gender_self_described: str | None = None,
    ) -> User:
        """Change the display name and/or the phone number.

        ── WHY THIS EXISTS, AND WHY PHONE IS THE POINT ─────────────────────

        `/auth/me` was GET-only and `phone` was on no serializer at all, which
        left two real holes. A ticket is issued in the name on the account and
        there was no way to fix a typo in it before issuance. And
        `notifications` has sent SMS — the booking confirmation, the refund
        confirmation — since that module shipped, routed through India DLT
        templates, to a column **nothing could ever populate**. The delivery
        half was built and the destination was unreachable.

        ── PARTIAL BY OMISSION, NOT BY BLANK ──────────────────────────────

        `None` means "not supplied, leave it alone"; an empty string is a real
        value meaning "remove it". They cannot be conflated: clearing a phone
        number is a legitimate thing to want (it is how you opt out of SMS),
        and treating blank as absent would make that impossible. The serializer
        marks both fields `required=False` and the view passes through only
        what was actually sent.

        ── NO EMAIL HERE ──────────────────────────────────────────────────

        Deliberately. The email address is the sign-in identity AND the address
        every ticket is delivered to, so changing it is a re-verification flow
        (prove the new one before it takes effect), not a profile field. Adding
        it to this method would let somebody move an account to an address they
        do not control — the exact thing `EmailVerification` exists to prevent.
        """
        fields: dict = {}
        if full_name is not None:
            fields["full_name"] = full_name.strip()
        if date_of_birth is not _UNSET:
            # A SENTINEL rather than `None`, because null is a real value here:
            # it means "remove my date of birth", which somebody is entitled to
            # do. Every other field on this method uses `None` for absent
            # because their empty value is the empty STRING; this one cannot.
            fields["date_of_birth"] = date_of_birth
        if gender is not None:
            fields["gender"] = gender
            # A stale self-description sitting behind a changed answer is a
            # value the owner believes they removed. So the pair moves
            # together: choosing anything but "self-describe" clears the text,
            # whether or not the client remembered to send it.
            if gender != Gender.SELF_DESCRIBED:
                fields["gender_self_described"] = ""
            elif gender_self_described is not None:
                fields["gender_self_described"] = gender_self_described.strip()
        elif gender_self_described is not None:
            fields["gender_self_described"] = gender_self_described.strip()
        if phone is not None:
            # Stored as given, minus surrounding space. No normalisation to
            # E.164 here: the SMS adapter is what knows the provider's expected
            # format, and rewriting a number at the boundary would mean the
            # value a user reads back is not the value they typed.
            fields["phone"] = phone.strip()
        if not fields:
            # Nothing to do — return the current profile rather than writing an
            # audit row for a request that changed nothing.
            user = self._users.get_by_id(user_id)
            if user is None:
                raise NotFoundError("No account with that id.")
            return user

        with UnitOfWork():
            if not self._users.update_profile_fields(user_id=user_id, **fields):
                raise NotFoundError("No account with that id.")
            record_audit(
                actor_id=str(user_id),
                action="user.profile_updated",
                target_type="user",
                target_id=str(user_id),
                metadata={"fields": sorted(fields)},
            )
        user = self._users.get_by_id(user_id)
        if user is None:  # pragma: no cover — written above, must exist
            raise NotFoundError("No account with that id.")
        return user

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

    def set_operator(
        self,
        *,
        user_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        is_operator: bool,
        reason: str = "",
    ) -> User:
        """Grant or remove the operator role.

        ── ONE REFUSAL, AND IT IS THE IMPORTANT ONE ───────────────────────

        **An operator cannot remove their OWN role.** The console is the only
        place this endpoint exists, so somebody who demoted themselves would
        lose the screen that could put it back — and if they were the last
        operator, nobody could restore it without a database shell.

        Demoting somebody ELSE is allowed, and deliberately: it is the action
        `set_suspended` already points at when it refuses to suspend a staff
        member and says "remove their operator role first". Until this method
        existed, that instruction named an endpoint that was not there.

        There is no "last operator" guard beyond the self-check. Counting
        operators to refuse the second-to-last demotion sounds prudent and is
        not: it is a race (two operators demoting each other concurrently both
        pass the count), and the self-check already prevents the only version
        of this that cannot be undone from the product.

        Granting requires a VERIFIED address. An operator can suspend accounts,
        release payouts and delete events, and handing that to an address
        nobody proved belongs to its holder is the one thing this platform's
        verification flow exists to prevent.
        """
        user = self._users.get_by_id(user_id)
        if user is None:
            raise NotFoundError("No account with that id.")

        if not is_operator and user.is_superuser:
            # THE PRIMARY ACCOUNT IS NOT DEMOTABLE, BY ANYBODY.
            #
            # The self-check below stops you locking yourself out. It does not
            # stop the case that actually loses a platform: a newly promoted
            # operator demoting the founding account, either by mistake or on
            # purpose. There is no console path back from that — `is_superuser`
            # is set by `manage.py ensure_admin` or a shell, and if the last
            # superuser has been stripped of `is_staff`, restoring it needs
            # exactly the shell access the console exists to avoid.
            #
            # So the rule is a property of the ACCOUNT rather than of who is
            # asking: a superuser's operator role is fixed. Making somebody an
            # operator is still ordinary; taking it from the one account that
            # can always put it back is not.
            raise CannotSuspendError(
                "This is the platform's primary account. Its operator role cannot be "
                "removed from the console — that is what guarantees somebody can always "
                "get back in."
            )
        if not is_operator and str(user.id) == str(actor_id):
            raise CannotSuspendError(
                "You cannot remove your own operator role — you would lose the console "
                "that could put it back."
            )
        if is_operator and not user.email_verified:
            raise CannotSuspendError(
                "That address has not been verified. An operator can suspend accounts and "
                "release payouts, so the account has to prove its address first."
            )
        if is_operator and not user.is_active:
            raise CannotSuspendError(
                "That account is suspended. Reinstate it before making it an operator."
            )
        if user.is_staff == is_operator:
            # Reported rather than silently succeeding, so a double-click does
            # not write a second audit row claiming a second grant.
            raise CannotSuspendError(
                f"That account is already {'an operator' if is_operator else 'not an operator'}."
            )

        with UnitOfWork():
            self._users.update_profile_fields(user_id=user.id, is_staff=is_operator)
            record_audit(
                actor_id=str(actor_id),
                action="user.operator_granted" if is_operator else "user.operator_revoked",
                target_type="user",
                target_id=str(user.id),
                metadata={"reason": reason} if reason else {},
            )
        logger.info(
            "account_operator_changed",
            extra={"user_id": str(user.id), "is_operator": is_operator},
        )

        refreshed = self._users.get_by_id(user.id)
        if refreshed is None:  # pragma: no cover — just deleted mid-request
            raise NotFoundError("No account with that id.")
        return refreshed

    def revoke_verification(
        self,
        *,
        user_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        reason: str = "",
    ) -> User:
        """Withdraw an operator's trust in a PROVEN address.

        ── WHY THIS ALSO SUSPENDS, RATHER THAN ONLY CLEARING THE FLAG ─────

        `email_verified = False` on its own is not a decision — it is an
        invitation. The verify endpoint would happily issue a fresh code to
        the same inbox and the account would be back inside a minute, having
        proven exactly what the operator just decided was not good enough.

        So the two writes go together and are one action: the address is no
        longer trusted AND the account is out of service until a human says
        otherwise. That is what an operator means when they revoke a
        verification, and modelling it as two independent switches would leave
        the useless half reachable on its own.

        The flags stay SEPARATE columns, though. `is_active` is "an operator
        stopped this account" and `email_verified` is "this address was
        proven" — conflating them would show every unverified sign-up as
        suspended and make reinstating somebody silently re-assert an address
        nobody re-checked.

        The same two refusals as suspension, for the same reasons: an operator
        cannot do this to themselves, or to another operator.
        """
        user = self._users.get_by_id(user_id)
        if user is None:
            raise NotFoundError("No account with that id.")
        if str(user.id) == str(actor_id):
            raise CannotSuspendError(
                "You cannot revoke your own verification — you would be locked out immediately."
            )
        if user.is_staff:
            raise CannotSuspendError(
                "Operator accounts cannot be revoked from here. Remove their operator role first."
            )
        if not user.email_verified and not user.is_active:
            raise CannotSuspendError("That account is already revoked.")

        self._users.revoke_verification(user_id=user.id)

        record_audit(
            actor_id=str(actor_id),
            action="user.verification_revoked",
            target_type="user",
            target_id=str(user.id),
            metadata={"reason": reason} if reason else {},
        )
        logger.info("account_verification_revoked", extra={"user_id": str(user.id)})

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
                # route in, not just the password one. Named rather than
                # disguised for the same reason as the password route: Google
                # has just proven this person owns the address, so there is
                # nothing left to conceal from them.
                raise AccountSuspendedError()
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
