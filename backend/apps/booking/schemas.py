"""Boundary DTOs. All money fields are integer **minor units** (paise),
consistent with events/ticketing. `qr_token` is the signed, PII-free ticket
token (checkin verifies it later)."""

from __future__ import annotations

from rest_framework import serializers

from .models import Booking, BookingItem, Ticket


class BookingItemRequestSerializer(serializers.Serializer):
    ticket_type_id = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=1)


class CreateBookingRequestSerializer(serializers.Serializer):
    event_id = serializers.UUIDField()
    items = BookingItemRequestSerializer(many=True, allow_empty=False)


class BookingItemSerializer(serializers.ModelSerializer):
    ticket_type_name = serializers.CharField(source="ticket_type.name", read_only=True)
    unit_price = serializers.IntegerField(source="unit_price_minor", read_only=True)

    class Meta:
        model = BookingItem
        fields = ["ticket_type_id", "ticket_type_name", "quantity", "unit_price"]
        read_only_fields = fields


class BookingSummarySerializer(serializers.ModelSerializer):
    total_amount = serializers.IntegerField(source="total_amount_minor", read_only=True)
    platform_fee = serializers.IntegerField(source="platform_fee_minor", read_only=True)

    class Meta:
        model = Booking
        fields = [
            "id",
            "event_id",
            "status",
            "total_amount",
            "platform_fee",
            "hold_expires_at",
            "payment_order_id",
            "created_at",
        ]
        read_only_fields = fields


class BookingDetailSerializer(serializers.ModelSerializer):
    event_title = serializers.CharField(source="event.title", read_only=True)
    total_amount = serializers.IntegerField(source="total_amount_minor", read_only=True)
    platform_fee = serializers.IntegerField(source="platform_fee_minor", read_only=True)
    items = BookingItemSerializer(many=True, read_only=True)

    class Meta:
        model = Booking
        fields = [
            "id",
            "event_id",
            "event_title",
            "status",
            "total_amount",
            "platform_fee",
            "hold_expires_at",
            "payment_order_id",
            "items",
            "created_at",
        ]
        read_only_fields = fields


class TicketSerializer(serializers.ModelSerializer):
    event_id = serializers.UUIDField(source="booking.event_id", read_only=True)
    event_title = serializers.CharField(source="booking.event.title", read_only=True)
    ticket_type_name = serializers.CharField(source="ticket_type.name", read_only=True)

    class Meta:
        model = Ticket
        fields = [
            "id",
            "event_id",
            "event_title",
            "ticket_type_id",
            "ticket_type_name",
            "status",
            "qr_token",
            "created_at",
        ]
        read_only_fields = fields
