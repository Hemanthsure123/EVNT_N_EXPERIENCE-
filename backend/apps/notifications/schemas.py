"""Boundary DTO for a NotificationLog — used by the admin and tests. The
module has no public HTTP endpoints (it's event- and job-driven), so this
serializer is not wired to a view."""

from __future__ import annotations

from rest_framework import serializers

from .models import NotificationLog


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
