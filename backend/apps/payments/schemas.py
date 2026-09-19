"""Boundary DTOs. `amount` is integer minor units (paise). Only Razorpay
reference ids are exposed — never any card data (none is ever stored)."""

from __future__ import annotations

from rest_framework import serializers

from .models import Payment


class VerifyPaymentRequestSerializer(serializers.Serializer):
    """What the browser may say after the provider's checkout closes.

    TWO IDS, AND NOTHING ELSE. Not an amount, not a status — every one of
    those is read back from the provider inside the service. A request body
    that could carry "amount" would be a request body somebody could carry a
    *different* amount in.

    ── WHY THE ORDER ID JOINED IT, AND WHY IT IS STILL NOT A CLAIM ──────────

    Cashfree addresses a payment only within its order, so a bare payment id
    cannot be looked up at all there. The order id also selects WHICH provider
    to ask, since the booking behind it names the gateway that took the money.

    Neither of those is trust. The id is a lookup key: it decides whom to ask
    and what to ask about, and every figure that follows comes from the
    provider's answer. Somebody who posts another customer's order gets a
    payment whose order resolves to that customer's booking — already paid, so
    it dedupes and issues nothing. There is still no id that makes this
    endpoint grant a ticket nobody paid for.

    Optional, because the Razorpay path has only ever had the payment id and
    must keep working unchanged.
    """

    razorpay_payment_id = serializers.CharField(
        max_length=64, required=False, allow_blank=True, default="", trim_whitespace=True
    )
    order_id = serializers.CharField(
        max_length=255, required=False, allow_blank=True, default="", trim_whitespace=True
    )

    def validate(self, attrs: dict) -> dict:
        """At least one id, or there is nothing to ask the provider about.

        Both are optional individually because the two gateways hand the
        browser different things — Razorpay a payment id, Cashfree the order it
        opened — and requiring either one specifically would break the other.
        An empty body is still a client bug and is named as one rather than
        quietly answering "ignored", which would look identical to a payment
        the provider had never heard of.
        """
        if not (attrs.get("razorpay_payment_id") or attrs.get("order_id")):
            raise serializers.ValidationError("Provide razorpay_payment_id or order_id.")
        return attrs


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


class RefundRequestCreateSerializer(serializers.Serializer):
    """What a customer sends to ask for their money back.

    ONE field, and it is prose. No `amount_minor`: approving a request refunds
    the payment in full because `execute_refund` refunds `payment.amount_minor`
    and nothing else, so an amount here would be a number the executor ignores
    — a field that silently discards what was typed, which is exactly what this
    codebase refuses everywhere else. Partial refunds need `execute_refund` to
    accept an amount first.

    A `min_length` because "refund" is not a reason and the organizer reading it
    has to decide something. Twenty characters is roughly one honest sentence.
    """

    reason = serializers.CharField(max_length=1000, min_length=20, trim_whitespace=True)


class RefundDecisionSerializer(serializers.Serializer):
    """Approve or reject.

    `note` is optional at the schema level and REQUIRED for a rejection by the
    service (`RefundDecisionNoteRequiredError`). The rule lives there rather
    than in a conditional serializer validator because it is a business rule
    about what a refusal must contain, and it holds no matter which of the
    three surfaces — customer-facing, organizer, or console — is asking.
    """

    approve = serializers.BooleanField()
    note = serializers.CharField(
        max_length=1000, required=False, allow_blank=True, default="", trim_whitespace=True
    )


class RefundRequestSerializer(serializers.Serializer):
    """One request, as every surface renders it.

    Deliberately ONE serializer for the customer, the organizer and the
    operator. The fields are the same facts, and three near-identical
    serializers is how the customer's view and the organizer's view end up
    disagreeing about what was decided.

    It carries no amount of its own — `booking_total_minor` is what would be
    refunded, read from the booking, so the number shown is the number that
    would actually move.
    """

    id = serializers.CharField()
    status = serializers.CharField()
    reason = serializers.CharField()
    decision_note = serializers.CharField(allow_blank=True)
    created_at = serializers.CharField()
    decided_at = serializers.CharField(allow_null=True)
    decided_by_email = serializers.CharField(allow_null=True)
    booking_id = serializers.CharField()
    booking_total_minor = serializers.IntegerField()
    booking_status = serializers.CharField()
    requested_by_email = serializers.CharField()
    requested_by_name = serializers.CharField(allow_blank=True)
    event_id = serializers.CharField()
    event_title = serializers.CharField()
    event_starts_at = serializers.CharField()
    #: Set ONLY once a `Refund` row exists — i.e. the provider accepted the
    #: refund and money genuinely moved. `status == "approved"` is a decision,
    #: not a transfer; see `_settled_refund` in selectors.py.
    refund_reference = serializers.CharField(allow_null=True)
    refund_amount_minor = serializers.IntegerField(allow_null=True)
    refunded_at = serializers.CharField(allow_null=True)
