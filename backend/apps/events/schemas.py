"""Boundary DTOs. Two response shapes on purpose (see CLAUDE.md's
Performance checklist): a tiny `EventCard` for high-volume list/search
responses, and a fuller `EventDetail` for the single-event page. Neither
serializes the whole model.

`from_price` is the cheapest ticket price in **minor units** (paise/cents),
exposed as an integer to avoid float money. It and `tickets_available` are
null until the `ticketing` module populates the denormalized columns behind
them.
"""

from __future__ import annotations

from django.utils import timezone
from rest_framework import serializers

from .models import Event


class CreateEventRequestSerializer(serializers.Serializer):
    organization_id = serializers.UUIDField()
    title = serializers.CharField(max_length=200)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    venue = serializers.CharField(max_length=255)
    city = serializers.CharField(max_length=120)
    starts_at = serializers.DateTimeField()
    ends_at = serializers.DateTimeField(required=False, allow_null=True)
    poster = serializers.FileField(required=False)

    def validate_starts_at(self, value):
        if value <= timezone.now():
            raise serializers.ValidationError("starts_at must be in the future.")
        return value

    def validate(self, attrs: dict) -> dict:
        ends_at = attrs.get("ends_at")
        if ends_at is not None and ends_at <= attrs["starts_at"]:
            raise serializers.ValidationError("ends_at must be after starts_at.")
        return attrs


class UpdateEventRequestSerializer(serializers.Serializer):
    # The optimistic-lock version the client last read; the write fails with
    # 409 stale_event_version if the event has changed since.
    version = serializers.IntegerField(min_value=1)
    title = serializers.CharField(max_length=200, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    venue = serializers.CharField(max_length=255, required=False)
    city = serializers.CharField(max_length=120, required=False)
    starts_at = serializers.DateTimeField(required=False)
    ends_at = serializers.DateTimeField(required=False, allow_null=True)
    poster = serializers.FileField(required=False)

    _EDITABLE = {"title", "description", "venue", "city", "starts_at", "ends_at", "poster"}

    def validate_starts_at(self, value):
        if value <= timezone.now():
            raise serializers.ValidationError("starts_at must be in the future.")
        return value

    def validate(self, attrs: dict) -> dict:
        if not (self._EDITABLE & attrs.keys()):
            raise serializers.ValidationError("Provide at least one field to update.")
        starts_at, ends_at = attrs.get("starts_at"), attrs.get("ends_at")
        if starts_at is not None and ends_at is not None and ends_at <= starts_at:
            raise serializers.ValidationError("ends_at must be after starts_at.")
        return attrs


class EventSearchQuerySerializer(serializers.Serializer):
    """Validates the public browse/search query string at the edge."""

    q = serializers.CharField(required=False, allow_blank=True, trim_whitespace=True)
    city = serializers.CharField(required=False, allow_blank=True)
    starts_after = serializers.DateTimeField(required=False)
    starts_before = serializers.DateTimeField(required=False)


class EventCardSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    from_price = serializers.IntegerField(
        source="from_price_minor", read_only=True, allow_null=True
    )

    class Meta:
        model = Event
        fields = [
            "id",
            "title",
            "venue",
            "city",
            "starts_at",
            "poster_url",
            "from_price",
            "tickets_available",
            "organization_id",
            "organization_name",
        ]
        read_only_fields = fields


class EventDetailSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    from_price = serializers.IntegerField(
        source="from_price_minor", read_only=True, allow_null=True
    )

    class Meta:
        model = Event
        fields = [
            "id",
            "organization_id",
            "organization_name",
            "title",
            "description",
            "venue",
            "city",
            "starts_at",
            "ends_at",
            "status",
            "poster_url",
            "from_price",
            "tickets_available",
            "version",
            "created_at",
        ]
        read_only_fields = fields


class OrganizerEventSummarySerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    from_price = serializers.IntegerField(
        source="from_price_minor", read_only=True, allow_null=True
    )

    class Meta:
        model = Event
        fields = [
            "id",
            "title",
            "city",
            "starts_at",
            "status",
            "poster_url",
            "from_price",
            "organization_id",
            "organization_name",
        ]
        read_only_fields = fields
