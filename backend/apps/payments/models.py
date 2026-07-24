"""Payment records, the webhook idempotency ledger, and refund records.

Two principles shape this module (see CLAUDE.md):
1. The **signed server-to-server webhook is the only source of truth** — a
   browser redirect never proves payment.
2. **Never take money without delivering a ticket** — if tickets can't be
   issued (the hold lapsed), the payment is automatically refunded.

We store ONLY Razorpay reference ids and amounts — NEVER card data.
"""

from __future__ import annotations

import uuid

from django.db import models


class PaymentStatus(models.TextChoices):
    CREATED = "created", "Created"
    PAID = "paid", "Paid"
    FAILED = "failed", "Failed"
    REFUNDED = "refunded", "Refunded"


class Payment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.ForeignKey(
        "booking.Booking", on_delete=models.PROTECT, related_name="payments"
    )
    # Razorpay reference ids — the order id is our unique handle from the
    # webhook back to a booking; the payment id is the captured payment.
    rzp_order_id = models.CharField(max_length=255, unique=True)
    rzp_payment_id = models.CharField(max_length=255, blank=True, default="")
    amount_minor = models.PositiveIntegerField()
    status = models.CharField(
        max_length=20, choices=PaymentStatus.choices, default=PaymentStatus.CREATED
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "payments_payment"
        indexes = [
            models.Index(fields=["booking", "created_at"], name="payment_booking_created_idx"),
        ]

    def __str__(self) -> str:
        return f"Payment {self.id} ({self.status})"


class ProcessedWebhook(models.Model):
    """The idempotency ledger. Razorpay retries webhooks; a delivery is
    processed at most once by deduping on a key derived from the event. The
    row is written IN THE SAME TRANSACTION as the processing it guards, so if
    processing rolls back the ledger entry does too — a retry then reprocesses
    rather than being silently swallowed."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    dedupe_key = models.CharField(max_length=255, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "payments_processed_webhook"

    def __str__(self) -> str:
        return self.dedupe_key


class Refund(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    payment = models.ForeignKey(Payment, on_delete=models.PROTECT, related_name="refunds")
    rzp_refund_id = models.CharField(max_length=255)
    amount_minor = models.PositiveIntegerField()
    reason = models.CharField(max_length=50, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "payments_refund"

    def __str__(self) -> str:
        return f"Refund {self.id} for {self.payment_id}"
