"""Boundary DTOs. `amount` is integer minor units (paise). Only Razorpay
reference ids are exposed — never any card data (none is ever stored)."""

from __future__ import annotations

from rest_framework import serializers

from .models import Payment


class VerifyPaymentRequestSerializer(serializers.Serializer):
    """What the browser may say after the provider's checkout closes.

    ONE FIELD, and it is an id. Not an amount, not a status, not an order —
    every one of those is read back from the provider inside the service. A
    request body that could carry "amount" would be a request body somebody
    could carry a *different* amount in.
    """

    razorpay_payment_id = serializers.CharField(max_length=64, trim_whitespace=True)


class SimulatePaymentRequestSerializer(serializers.Serializer):
    """What the browser may say to simulate a payment on a demo deployment.

    ONE FIELD, and it is the id of a booking the caller already owns. No
    amount (it is read off the booking row), no payment id (the fake provider
    issues it), no status (`verify_and_confirm` asks the provider). The demo
    path has exactly as little trust in the client as the real one.
    """

    booking_id = serializers.UUIDField()


class VerifyPaymentResponseSerializer(serializers.Serializer):
    #: The service's own outcome vocabulary, passed through unchanged so the
    #: client can tell "confirmed" from "still authorising" from "we have
    #: never heard of this payment".
    status = serializers.CharField()


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
