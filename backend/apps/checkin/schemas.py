"""Boundary DTOs for the check-in API.

The QR token carries only ids (no PII); the response summary is likewise
PII-free (a tier name for the gate screen), so nothing sensitive about the
attendee is exposed at the door.
"""

from __future__ import annotations

from rest_framework import serializers


class VerifyRequestSerializer(serializers.Serializer):
    """POST /checkin/verify body. `event_id` is the event this gate is
    stationed for — it drives both the authorization and wrong-event checks."""

    event_id = serializers.UUIDField()
    qr_token = serializers.CharField(max_length=512, trim_whitespace=False)
    gate = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")


class VerifyResultSerializer(serializers.Serializer):
    """The structured gate response — a clean, predictable contract for the
    frontend (mirrors booking's ConfirmResult style)."""

    allowed = serializers.BooleanField()
    reason = serializers.CharField()
    ticket_id = serializers.CharField(allow_null=True)
    event_id = serializers.CharField(allow_null=True)
    ticket_type = serializers.CharField(allow_null=True)
    used_at = serializers.DateTimeField(allow_null=True)
    gate = serializers.CharField(allow_null=True)


class AttendanceSerializer(serializers.Serializer):
    """GET /events/{id}/attendance — admitted vs capacity."""

    event_id = serializers.CharField()
    admitted = serializers.IntegerField()
    capacity = serializers.IntegerField()
