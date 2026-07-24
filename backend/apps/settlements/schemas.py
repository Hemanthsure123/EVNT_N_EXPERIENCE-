"""Boundary DTO for a Settlement. All money fields are integer minor units
(paise), consistent with the rest of the platform."""

from __future__ import annotations

from rest_framework import serializers

from .models import Settlement


class SettlementSerializer(serializers.ModelSerializer):
    event_title = serializers.CharField(source="event.title", read_only=True)

    class Meta:
        model = Settlement
        fields = [
            "id",
            "event_id",
            "event_title",
            "gross",
            "platform_fee",
            "refunds",
            "net",
            "status",
            "payout_at",
            "provider_ref",
            "created_at",
        ]
        read_only_fields = fields
