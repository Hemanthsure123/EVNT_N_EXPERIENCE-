"""Explicit input/output shapes at the API boundary.

DRF serializers are used directly as the schema/validation layer rather
than adding a parallel pydantic DTO layer: DRF already owns boundary
parsing + validation for this project, and a second schema layer here
would duplicate that responsibility without earning its place. If a future
module needs validation independent of HTTP (e.g. a CLI import job), that's
when introducing plain dataclass DTOs would pay for itself."""

from __future__ import annotations

import datetime as dt

from django.utils import timezone
from rest_framework import serializers

from .models import Gender, User


class RegisterRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(min_length=8, write_only=True)
    full_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")


class LoginRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)


class RefreshRequestSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class LogoutRequestSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class TokenPairSerializer(serializers.Serializer):
    access = serializers.CharField()
    refresh = serializers.CharField()


#: Below this an account holding an email address needs a guardian's consent
#: under India's DPDP Act, which this platform has no flow for. Refusing the
#: date is the honest position: it is not a judgement about who may use the
#: site, it is an admission of a consent mechanism that does not exist.
MIN_AGE_YEARS = 13
#: A sanity ceiling. Anything past it is a typo in the year field — which is
#: the single most common date-picker mistake there is.
MAX_AGE_YEARS = 120


def _age_on(born: dt.date, today: dt.date) -> int:
    """Whole years, counting the birthday correctly.

    `(today - born).days // 365` is the version everybody writes and it is
    wrong for anybody who has lived through enough leap years. This is the
    standard comparison instead: subtract the years, then take one back if the
    birthday has not come round yet.
    """
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


class UserSerializer(serializers.ModelSerializer):
    #: DERIVED, never stored. See `User.date_of_birth` — an age column is wrong
    #: the day after it is written, and this platform displays age restrictions
    #: ("18+"), so a stale one would be a correctness problem rather than an
    #: untidiness.
    #:
    #: Computed in IST, like every other date on this platform: the events are
    #: in India and somebody's birthday is the day it is where they are, not
    #: where the server happens to be.
    age = serializers.SerializerMethodField()
    #: What to SHOW, resolved once here rather than in every client.
    #:
    #: `self_described` carries its meaning in a second column, and a frontend
    #: that has to know that pairing is a frontend that will get it wrong on
    #: one of the four screens a profile appears on.
    gender_display = serializers.SerializerMethodField()

    def get_age(self, user: User) -> int | None:
        if user.date_of_birth is None:
            return None
        return _age_on(user.date_of_birth, timezone.localdate())

    def get_gender_display(self, user: User) -> str:
        if user.gender == Gender.SELF_DESCRIBED:
            # Falls back to the label rather than to an empty string: a person
            # who chose to self-describe and then cleared the text should read
            # as "prefer to self-describe", not as having answered nothing.
            return user.gender_self_described or Gender.SELF_DESCRIBED.label
        return user.get_gender_display() if user.gender else ""

    class Meta:
        model = User
        # `is_staff` is what gates the operator console. Without it the
        # frontend cannot tell an admin from anyone else, and an admin UI
        # that cannot check its own audience is not an admin UI. It is a
        # role flag, not a secret — the API still enforces every check.
        # `email_verified` is exposed for the same reason `is_staff` is: the
        # frontend has to decide whether to show the verify screen, and it
        # cannot do that from a flag it never receives.
        # `avatar_url` rides on the profile rather than getting a read endpoint
        # of its own: every screen that shows a picture already has the user
        # from `/auth/me`, and a second round trip for one string would be a
        # request per avatar. Empty string means "no picture" — the frontend
        # falls back to initials rather than to a stock silhouette, which is
        # the same refusal-to-invent rule the rest of the platform follows.
        # `phone` is here because `notifications` has been sending SMS — the
        # booking confirmation, the refund confirmation — to a column the owner
        # could neither see nor set. The delivery half was built and the
        # destination was unreachable, and a settings screen cannot offer to
        # change a number it is never told. Blank means "no number, skip SMS",
        # which is a real and supported state rather than an empty field.
        fields = [
            "id",
            "email",
            "full_name",
            "phone",
            "avatar_url",
            # Who they are, when they chose to say. Every one is optional and
            # the frontend omits the row rather than guessing — a default of
            # "Male" or an invented age is exactly the kind of claim nobody
            # made that this codebase refuses to render.
            "date_of_birth",
            "age",
            "gender",
            "gender_self_described",
            "gender_display",
            # Whether the welcome flow has been ANSWERED — filled in or
            # skipped. The frontend needs it to decide whether to open
            # onboarding, and it cannot decide that from a flag it never
            # receives. Null means not yet.
            "onboarding_completed_at",
            "is_organizer",
            "is_staff",
            "email_verified",
            "date_joined",
        ]
        read_only_fields = fields


class AuthResponseSerializer(serializers.Serializer):
    """Response shape for register/login: the profile plus a fresh token pair."""

    user = UserSerializer()
    tokens = TokenPairSerializer()


class VerifyEmailRequestSerializer(serializers.Serializer):
    """Address plus the six digits from the email."""

    email = serializers.EmailField()
    # Exactly six digits, validated at the boundary so a malformed code never
    # reaches the service and never costs the user one of their attempts.
    code = serializers.RegexField(r"^\d{6}$", trim_whitespace=True)


class ResendVerificationRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class RegistrationResponseSerializer(serializers.Serializer):
    """Register's response: a profile, and NO tokens.

    Registration deliberately does not sign anybody in. The account exists but
    is unproven, so handing out a session here would make the verification
    step optional in practice — anyone could simply keep the token and never
    open the email.
    """

    user = UserSerializer()
    verification_required = serializers.BooleanField()
    message = serializers.CharField()


class GoogleSignInConfigSerializer(serializers.Serializer):
    """Whether the button should render at all."""

    available = serializers.BooleanField()


class GoogleSignInRedeemSerializer(serializers.Serializer):
    handoff = serializers.CharField(max_length=128)


class UpdateProfileSerializer(serializers.Serializer):
    """PATCH /auth/me — the display name and the phone number.

    Both `required=False`, and the view forwards ONLY what was actually sent.
    That is what makes this a real PATCH: omitting a field leaves it alone,
    while sending an empty string clears it. Conflating the two would make
    removing a phone number impossible, and removing it is how somebody opts
    out of SMS.

    NO EMAIL FIELD, deliberately. The address is the sign-in identity and the
    ticket destination, so changing it is a re-verification flow rather than a
    profile edit — allowing it here would let an account be moved to an address
    the holder does not control, which is precisely what `EmailVerification`
    exists to prevent.
    """

    full_name = serializers.CharField(
        max_length=150, required=False, allow_blank=True, trim_whitespace=True
    )
    #: Loose on purpose. Indian numbers arrive with and without +91, with
    #: spaces, and occasionally with a leading 0. A strict regex here would
    #: reject real numbers, and the SMS adapter is the layer that knows the
    #: provider's expected format — normalising at the boundary would mean the
    #: value read back is not the value typed.
    phone = serializers.CharField(
        max_length=20, required=False, allow_blank=True, trim_whitespace=True
    )
    #: `allow_null` because null is a REAL value here — "remove my date of
    #: birth" — unlike every other field on this serializer, whose empty value
    #: is the empty string. The service uses a sentinel for the same reason.
    date_of_birth = serializers.DateField(required=False, allow_null=True)
    #: Blank CLEARS the answer back to "never said", which is different from
    #: `prefer_not_to_say` ("asked, and declined"). Both are supported because
    #: they are different states — see `Gender`.
    gender = serializers.ChoiceField(choices=Gender.choices, required=False, allow_blank=True)
    gender_self_described = serializers.CharField(
        max_length=60, required=False, allow_blank=True, trim_whitespace=True
    )

    def validate_date_of_birth(self, value):
        if value is None:
            return None
        today = timezone.localdate()
        if value > today:
            # Not "invalid": naming the actual problem is what lets somebody
            # spot that they typed 2026 instead of 1996.
            raise serializers.ValidationError("That date is in the future.")
        age = _age_on(value, today)
        if age > MAX_AGE_YEARS:
            raise serializers.ValidationError("Check the year — that is over a century ago.")
        if age < MIN_AGE_YEARS:
            raise serializers.ValidationError(
                f"You need to be at least {MIN_AGE_YEARS} to have an account here."
            )
        return value

    def validate(self, attrs: dict) -> dict:
        """Self-describe needs something to describe.

        Checked here rather than in the service because it is a shape rule
        about two fields arriving together, which is what a boundary is for.
        The service still clears the text when the answer moves away from
        self-describe — that one is a data rule and belongs there.
        """
        if (
            attrs.get("gender") == Gender.SELF_DESCRIBED
            and "gender_self_described" in attrs
            and not attrs["gender_self_described"].strip()
        ):
            raise serializers.ValidationError(
                {"gender_self_described": "Tell us how you would like to be described."}
            )
        return attrs
