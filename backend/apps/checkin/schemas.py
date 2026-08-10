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


class LookupRequestSerializer(serializers.Serializer):
    """POST /checkin/lookup body. Same shape as verify minus `gate` — nothing
    is being admitted, so there is no gate to attribute it to."""

    event_id = serializers.UUIDField()
    qr_token = serializers.CharField(max_length=512, trim_whitespace=False)


class LookupResultSerializer(serializers.Serializer):
    """The READ-ONLY resolution of a ticket.

    Deliberately NOT `VerifyResultSerializer`, and the missing field is the
    reason: there is no `allowed` here, because nothing was decided. A client
    that renders this through the gate's admitted/denied component would fail
    to compile rather than silently show a green tick for a ticket nobody
    scanned.

    `would_admit` is the hypothetical — true when the ticket would currently
    pass, which stops being true the moment somebody actually scans it.
    """

    found = serializers.BooleanField()
    reason = serializers.CharField()
    would_admit = serializers.BooleanField()
    ticket_id = serializers.CharField(allow_null=True)
    event_id = serializers.CharField(allow_null=True)
    event_title = serializers.CharField(allow_null=True)
    ticket_type = serializers.CharField(allow_null=True)
    status = serializers.CharField(allow_null=True)
    used_at = serializers.DateTimeField(allow_null=True)
    gate = serializers.CharField(allow_null=True)
    attendee_name = serializers.CharField(allow_null=True)


class AttendanceSerializer(serializers.Serializer):
    """GET /events/{id}/attendance — admitted vs capacity."""

    event_id = serializers.CharField()
    admitted = serializers.IntegerField()
    capacity = serializers.IntegerField()
