"""Custom user model, email as the login identifier.

A UUID primary key is used across the platform's public-facing models
(starting here) so ids are safe to expose in URLs/tickets/QR codes without
leaking row counts or being sequentially guessable."""

from __future__ import annotations

import uuid
from typing import ClassVar

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models


class UserManager(BaseUserManager["User"]):
    use_in_migrations = True

    def _create_user(self, email: str, password: str | None, **extra_fields: object) -> User:
        if not email:
            raise ValueError("Users must have an email address")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email: str, password: str | None = None, **extra_fields: object) -> User:
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(
        self, email: str, password: str | None = None, **extra_fields: object
    ) -> User:
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        return self._create_user(email, password, **extra_fields)


class Gender(models.TextChoices):
    """How somebody describes themselves, when they want to.

    ── IT INCLUDES A WAY TO SAY NOTHING, AND A WAY TO SAY SOMETHING ELSE ──

    Blank on the column is "never answered" — the state every account starts
    in and a perfectly good one to stay in. `PREFER_NOT_TO_SAY` is different
    and is stored deliberately: it means the question WAS asked and answered,
    so onboarding does not ask again. Conflating the two would re-prompt
    somebody who has already declined, which is the one response that clearly
    means stop asking.

    `SELF_DESCRIBED` pairs with `User.gender_self_described`. An option with
    nowhere to type is worse than no option at all, so the two ship together
    or not at all.
    """

    WOMAN = "woman", "Woman"
    MAN = "man", "Man"
    NON_BINARY = "non_binary", "Non-binary"
    SELF_DESCRIBED = "self_described", "Prefer to self-describe"
    PREFER_NOT_TO_SAY = "prefer_not_to_say", "Prefer not to say"


class User(AbstractBaseUser, PermissionsMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=150, blank=True)
    # Optional destination for SMS notifications (booking confirmation, OTP).
    # Blank when unknown — SMS sends are skipped cleanly rather than failing.
    # A phone-based sign-in flow that populates/verifies this is a later concern.
    phone = models.CharField(max_length=20, blank=True, default="")
    # The profile picture, stored as a URL rather than a FileField.
    #
    # Every image on this platform goes through `StoragePort` and lands as a
    # URL on the row (`Organization.logo_url`, `EventMedia.url`,
    # `PerformerMedia.url`) — a `FileField` would bind the column to Django's
    # own storage backend and to a `MEDIA_ROOT` that does not survive a
    # container redeploy, which is exactly what the S3-shaped adapter exists to
    # avoid. Blank means "no picture"; the frontend falls back to initials.
    #
    # NO INDEX, deliberately. Nothing filters or sorts by it — the only read is
    # by primary key on the caller's own row (`/auth/me`), which the PK already
    # serves. The performance checklist asks for the index the query actually
    # issues, not one added speculatively.
    avatar_url = models.CharField(max_length=500, blank=True, default="")

    # --- who they are, when they choose to say -----------------------------

    #: The DATE, never the age.
    #:
    #: An age is wrong the day after it is stored, and on THIS platform that is
    #: a correctness problem rather than an untidiness: `Event.age_restriction`
    #: carries "18+", so an age column would let somebody who was 17 when they
    #: signed up walk an adult gate a year later. A date is a fact that stays
    #: true, and the age is derived at the moment it is asked for.
    #:
    #: Null is the norm. Nobody is required to give it, and the platform does
    #: not gate anything on it today — the age restriction is displayed and
    #: enforced at the door, not by this column.
    date_of_birth = models.DateField(null=True, blank=True)
    #: Blank means never answered; `prefer_not_to_say` means answered. See
    #: `Gender` for why those are different states.
    gender = models.CharField(max_length=20, choices=Gender.choices, blank=True, default="")
    #: Only meaningful when `gender == SELF_DESCRIBED`, and cleared by the
    #: service when it is not — a stale self-description sitting behind a
    #: changed answer is a value the owner believes they removed.
    gender_self_described = models.CharField(max_length=60, blank=True, default="")

    #: WHEN they finished the welcome flow, not whether.
    #:
    #: A timestamp is strictly more information than a boolean for the same
    #: storage, and the extra information is the useful kind: "signed up in
    #: March and finished onboarding in July" is a real pattern worth being
    #: able to see, and a boolean throws it away.
    #:
    #: Null means the flow has not been finished — either never started, or
    #: skipped. Skipping SETS it, because a person who declined has answered
    #: the question and asking again on their next visit is nagging.
    onboarding_completed_at = models.DateTimeField(null=True, blank=True)

    is_active = models.BooleanField(default=True)
    # Whether the address has been PROVEN to belong to whoever registered it.
    #
    # A SEPARATE flag from `is_active`, deliberately. `is_active` means "an
    # operator suspended this account" (apps/console's suspension endpoint, which
    # AuthService.authenticate already refuses on). Reusing it for "has not
    # confirmed their email yet" would conflate two unrelated states: every
    # unverified sign-up would appear suspended in the admin, and un-suspending
    # somebody would silently mark their address verified.
    email_verified = models.BooleanField(default=False)
    is_staff = models.BooleanField(default=False)
    # Granted the moment a user creates their first organization (see
    # apps.organizations.services.OrganizationService.create_organization).
    # Membership/teams (multiple organizers per org) are a later module —
    # this single flag is all "organizer" means until then.
    is_organizer = models.BooleanField(default=False)
    date_joined = models.DateTimeField(auto_now_add=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: ClassVar[list[str]] = []

    class Meta:
        db_table = "accounts_user"

    def __str__(self) -> str:
        return self.email


class EmailVerification(models.Model):
    """A one-time code proving somebody controls the address they registered.

    ── WHY THE CODE IS NEVER STORED ──────────────────────────────────────

    `code_hash` holds a password-hasher digest, not the six digits. A verify
    code is a bearer credential for the duration of its life: anyone who can
    read this table — a backup, a support tool, a read replica, an SQL
    injection in some unrelated report — could otherwise complete somebody
    else's registration. Hashing costs one comparison per attempt and removes
    the entire class.

    ── WHY THE ATTEMPT COUNTER IS ON THE ROW ─────────────────────────────

    Six digits is a million possibilities, which sounds like a lot and is not:
    at a few hundred requests a second an unthrottled attacker expects to hit
    it in under an hour. Rate limiting by IP (`OtpThrottle`) raises the cost
    but is defeated by rotating addresses, so the hard stop lives HERE, bound
    to the code itself — after `MAX_ATTEMPTS` the row is spent and a new code
    must be requested. That makes the search space per code 5, not 10^6.
    """

    #: A code is dead this long after it is issued. Long enough to walk to
    #: another device and read an email; short enough that a code sitting in an
    #: unattended inbox is not a standing key to the account.
    TTL_MINUTES = 10
    #: Wrong guesses before the code is spent.
    MAX_ATTEMPTS = 5
    #: Minimum gap between sends, so "resend" cannot be used to flood an inbox
    #: somebody else owns.
    RESEND_COOLDOWN_SECONDS = 60

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="verifications"
    )
    code_hash = models.CharField(max_length=255)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    #: Set when the code is successfully used. A consumed row is kept rather
    #: than deleted so the audit trail shows WHEN an address was proven.
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "accounts_email_verification"
        # Plain assignment, NOT `ClassVar[list[models.Index]]`. Annotating a
        # model `Meta` attribute makes django-stubs' plugin degrade quietly and
        # lose `Model.objects` across the whole project — 75 errors in 19
        # unrelated files, none of them here. CLAUDE.md documents this exact
        # trap from `cms/models.py`; it was reintroduced here.
        indexes = [
            # The only query on the read path: the newest live code for a user.
            models.Index(fields=["user", "-created_at"], name="email_verif_user_recent"),
        ]

    def __str__(self) -> str:
        return f"verification for {self.user_id}"
