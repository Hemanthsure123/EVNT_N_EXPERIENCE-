"""Boundary DTOs for ticket tiers.

`price` is money in **minor units** (paise/cents) as an integer — the API
mirror of the model's `price_minor`, kept integer end-to-end to avoid float
money. `available` (quantity − sold − reserved) and `is_on_sale` are
computed for display; the authoritative availability decision is made under
a row lock at reserve time, not from these numbers.
"""

from __future__ import annotations

from django.utils import timezone
from rest_framework import serializers

from .models import TicketType


class CreateTicketTypeRequestSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    price = serializers.IntegerField(min_value=0)  # minor units
    quantity = serializers.IntegerField(min_value=1)
    sale_start = serializers.DateTimeField(required=False, allow_null=True)
    sale_end = serializers.DateTimeField(required=False, allow_null=True)
    max_per_order = serializers.IntegerField(min_value=1, default=10)

    def validate(self, attrs: dict) -> dict:
        start, end = attrs.get("sale_start"), attrs.get("sale_end")
        if start is not None and end is not None and end <= start:
            raise serializers.ValidationError("sale_end must be after sale_start.")
        return attrs


class UpdateTicketTypeRequestSerializer(serializers.Serializer):
    # Optimistic-lock version the client last read; 409 if the tier changed since.
    version = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=100, required=False)
    price = serializers.IntegerField(min_value=0, required=False)  # minor units
    quantity = serializers.IntegerField(min_value=1, required=False)
    sale_start = serializers.DateTimeField(required=False, allow_null=True)
    sale_end = serializers.DateTimeField(required=False, allow_null=True)
    max_per_order = serializers.IntegerField(min_value=1, required=False)

    _EDITABLE = {"name", "price", "quantity", "sale_start", "sale_end", "max_per_order"}

    def validate(self, attrs: dict) -> dict:
        if not (self._EDITABLE & attrs.keys()):
            raise serializers.ValidationError("Provide at least one field to update.")
        start, end = attrs.get("sale_start"), attrs.get("sale_end")
        if start is not None and end is not None and end <= start:
            raise serializers.ValidationError("sale_end must be after sale_start.")
        return attrs


class TicketTypeSerializer(serializers.ModelSerializer):
    price = serializers.IntegerField(source="price_minor", read_only=True)
    available = serializers.SerializerMethodField()
    is_on_sale = serializers.SerializerMethodField()

    class Meta:
        model = TicketType
        fields = [
            "id",
            "event_id",
            "name",
            "price",
            "quantity",
            "sold",
            "available",
            "sale_start",
            "sale_end",
            "max_per_order",
            "is_on_sale",
            "version",
            "created_at",
        ]
        read_only_fields = fields

    def get_available(self, obj: TicketType) -> int:
        return obj.available

    def get_is_on_sale(self, obj: TicketType) -> bool:
        if obj.available <= 0:
            return False
        now = timezone.now()
        if obj.sale_start is not None and now < obj.sale_start:
            return False
        return not (obj.sale_end is not None and now > obj.sale_end)
