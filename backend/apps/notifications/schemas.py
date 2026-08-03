"""Boundary DTO for a NotificationLog — used by the admin and tests. The
module has no public HTTP endpoints (it's event- and job-driven), so this
serializer is not wired to a view."""

from __future__ import annotations

from rest_framework import serializers

from .models import NotificationLog, PushSubscription


class NotificationLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationLog
        fields = [
            "id",
            "dedupe_key",
            "type",
            "channel",
            "recipient",
            "status",
            "provider_ref",
            "attempts",
            "created_at",
            "sent_at",
        ]
        read_only_fields = fields


class PushConfigSerializer(serializers.Serializer):
    """Whether this deployment can send push, and the key to subscribe with."""

    enabled = serializers.BooleanField()
    public_key = serializers.CharField(allow_blank=True)


class PushSubscriptionRequestSerializer(serializers.Serializer):
    """Exactly what `PushSubscription.toJSON()` gives the browser.

    `endpoint` is a `CharField`, not a `URLField`: push endpoints are opaque
    URLs chosen by the browser's own push service, and validating their shape
    would be this server second-guessing Chrome about what Chrome's own URLs
    look like. The scheme is checked because an endpoint we would refuse to
    call is worth rejecting at the boundary rather than storing.
    """

    endpoint = serializers.CharField(max_length=2000)
    p256dh = serializers.CharField(max_length=255)
    auth = serializers.CharField(max_length=255)

    def validate_endpoint(self, value: str) -> str:
        if not value.startswith("https://"):
            raise serializers.ValidationError("A push endpoint must be an https URL.")
        return value


class PushSubscriptionSerializer(serializers.ModelSerializer):
    """A device, as its owner sees it.

    `p256dh` and `auth` are deliberately ABSENT. They are the keys payloads are
    encrypted to, and nothing in the UI needs them — echoing them back would
    put the one secret in this row into a response for no reason.
    """

    class Meta:
        model = PushSubscription
        fields = ["id", "user_agent", "created_at", "last_used_at"]
        read_only_fields = fields


class PushRotateRequestSerializer(PushSubscriptionRequestSerializer):
    """A rotation: the new subscription, plus the old endpoint as evidence.

    See `PushRotateView` for why knowing the old endpoint is sufficient
    authorisation, and for the three things this can therefore not do.
    """

    old_endpoint = serializers.CharField(max_length=2000)
