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

from django.conf import settings
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


class RefundRequestStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    #: The approval was accepted but the money did not move. A REQUEST is not a
    #: refund, and conflating them would make a failed vendor call look like a
    #: completed one on the customer's screen.
    FAILED = "failed", "Failed"


class RefundRequest(models.Model):
    """A customer ASKING for their money back.

    ── WHY THIS IS NOT `Refund` ───────────────────────────────────────────

    `Refund` is a record of money that has ALREADY been returned —
    `execute_refund` writes one only after the vendor call succeeded, so every
    row in that table is a completed fact. There was therefore no object
    anywhere representing "somebody has asked and nobody has decided yet", and
    no way for a customer to raise one at all: refunds were organizer-initiated
    only, and asking meant an email thread that nothing tracked.

    That is what this table is. It is a REQUEST with a lifecycle
    (pending -> approved | rejected | failed); approving it calls the existing
    `execute_refund`, which writes the `Refund`. The two tables answer
    different questions and both are needed:

        RefundRequest  — did somebody ask, and what did we decide?
        Refund         — did money actually move?

    ── ONE OPEN REQUEST PER BOOKING ───────────────────────────────────────

    A partial UNIQUE constraint on `(booking)` where `status = pending`. Without
    it a frustrated customer pressing the button four times creates four
    requests, an organizer approves two of them, and `execute_refund` is called
    twice for one booking. The second call is idempotent and would no-op — so
    the money is safe — but the QUEUE would show two decisions for one booking
    and the customer would receive two "your refund was approved" emails for
    one refund. Correctness of the ledger is not the only thing worth
    protecting.

    A rejected request does NOT block a new one: circumstances change, and a
    customer whose first request was declined before the line-up changed must
    be able to ask again.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.ForeignKey(
        "booking.Booking", on_delete=models.CASCADE, related_name="refund_requests"
    )
    #: Who asked. Normally the booking's own owner, but kept explicit rather
    #: than derived: an operator raising one on a customer's behalf is a real
    #: case, and `booking.user` would then be the wrong attribution.
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="refund_requests"
    )
    #: What the customer said, in their words. Free text rather than a picklist:
    #: the reason is read by a human deciding, not aggregated into a chart, and
    #: a fixed list would force every case into "other".
    reason = models.TextField(max_length=1000)
    status = models.CharField(
        max_length=20, choices=RefundRequestStatus.choices, default=RefundRequestStatus.PENDING
    )
    #: The organizer or operator who decided. Null while pending.
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="refund_decisions",
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    #: Shown to the CUSTOMER. A rejection without a reason is the thing that
    #: turns a refused refund into a chargeback, so the API requires one.
    decision_note = models.TextField(max_length=1000, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "payments_refund_request"
        constraints = [
            models.UniqueConstraint(
                fields=["booking"],
                condition=models.Q(status="pending"),
                name="one_open_refund_request_per_booking",
            ),
        ]
        indexes = [
            # The organizer's queue: their pending requests, oldest first, so
            # the person who has waited longest is answered first — the same
            # FIFO the moderation queue uses and for the same reason.
            models.Index(fields=["status", "created_at"], name="refundreq_status_created_idx"),
            # "My requests" on the account page, and the per-booking lookup
            # that decides whether to offer the button at all.
            models.Index(fields=["booking", "created_at"], name="refundreq_booking_created_idx"),
            models.Index(fields=["requested_by", "created_at"], name="refundreq_user_created_idx"),
        ]

    def __str__(self) -> str:
        return f"RefundRequest {self.id} ({self.status})"
