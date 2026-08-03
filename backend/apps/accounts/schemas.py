"""Explicit input/output shapes at the API boundary.

DRF serializers are used directly as the schema/validation layer rather
than adding a parallel pydantic DTO layer: DRF already owns boundary
parsing + validation for this project, and a second schema layer here
would duplicate that responsibility without earning its place. If a future
module needs validation independent of HTTP (e.g. a CLI import job), that's
when introducing plain dataclass DTOs would pay for itself."""

from __future__ import annotations

from rest_framework import serializers

from .models import User


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


class UserSerializer(serializers.ModelSerializer):
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
        fields = [
            "id",
            "email",
            "full_name",
            "avatar_url",
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
