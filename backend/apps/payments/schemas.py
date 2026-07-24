"""Boundary DTOs. `amount` is integer minor units (paise). Only Razorpay
reference ids are exposed — never any card data (none is ever stored)."""

from __future__ import annotations

from rest_framework import serializers

from .models import Payment


class PaymentSerializer(serializers.ModelSerializer):
    amount = serializers.IntegerField(source="amount_minor", read_only=True)

    class Meta:
        model = Payment
        fields = [
            "id",
            "booking_id",
            "rzp_order_id",
            "rzp_payment_id",
            "amount",
            "status",
            "created_at",
        ]
        read_only_fields = fields
