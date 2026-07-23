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
        fields = ["id", "email", "full_name", "is_organizer", "date_joined"]
        read_only_fields = fields


class AuthResponseSerializer(serializers.Serializer):
    """Response shape for register/login: the profile plus a fresh token pair."""

    user = UserSerializer()
    tokens = TokenPairSerializer()
