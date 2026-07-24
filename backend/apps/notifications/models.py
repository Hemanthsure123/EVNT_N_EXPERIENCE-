"""The NotificationLog — this module's audit trail AND idempotency ledger.

One row per logical notification, keyed by a stable, unique `dedupe_key`. That
uniqueness is the backbone of exactly-once delivery: the SAME logical message
(same event + type + channel + recipient) can be claimed only once, so even
under at-least-once event delivery and worker retries it is never sent twice.

The row is CLAIMED (`pending`) before any send, carries the fully-rendered
content so dispatch is a pure send, and records the outcome (`sent` +
`provider_ref`, or `failed` after exhausting retries — the dead-letter state).
"""

from __future__ import annotations

import uuid

from django.db import models


class NotificationChannel(models.TextChoices):
    EMAIL = "email", "Email"
    SMS = "sms", "SMS"


class NotificationStatus(models.TextChoices):
    PENDING = "pending", "Pending"  # claimed, not yet delivered
    SENT = "sent", "Sent"  # delivered; provider_ref stored
    FAILED = "failed", "Failed"  # dead-lettered after exhausting retries


class NotificationType(models.TextChoices):
    """The notification kinds this module knows how to render + route. The
    channel and (for SMS) the DLT template are derived from the type — see
    templates.py."""

    WELCOME = "welcome", "Welcome email"
    TICKET_DELIVERY = "ticket_delivery", "Ticket delivery email"
    BOOKING_CONFIRMATION_SMS = "booking_confirmation_sms", "Booking confirmation SMS"
    REFUND_CONFIRMATION = "refund_confirmation", "Refund confirmation email"
    REFUND_CONFIRMATION_SMS = "refund_confirmation_sms", "Refund confirmation SMS"
    OTP = "otp", "OTP SMS"
    EVENT_REMINDER = "event_reminder", "Event reminder email"
    PAYOUT_RELEASED = "payout_released", "Payout released email"


class NotificationLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # The idempotency key: stable across retries/redeliveries of the same
    # logical notification. UNIQUE — the DB-level guarantee behind exactly-once.
    dedupe_key = models.CharField(max_length=255, unique=True)
    type = models.CharField(max_length=64, choices=NotificationType.choices)
    channel = models.CharField(max_length=16, choices=NotificationChannel.choices)
    recipient = models.CharField(max_length=255)  # email address or phone number
    # Rendered at claim time (a missing template fails loudly THEN, not silently
    # at send time), so dispatch is a pure send of stored content.
    subject = models.CharField(max_length=255, blank=True, default="")  # email only
    body = models.TextField()
    status = models.CharField(
        max_length=16, choices=NotificationStatus.choices, default=NotificationStatus.PENDING
    )
    provider_ref = models.CharField(max_length=255, blank=True, default="")
    attempts = models.PositiveIntegerField(default=0)
    error = models.CharField(
        max_length=500, blank=True, default=""
    )  # last failure, for dead-letter
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "notifications_notification_log"
        indexes = [
            # Ops queries: scan the dead-letter / pending backlog by status,
            # newest first. dedupe_key is already covered by its unique index.
            models.Index(fields=["status", "created_at"], name="notiflog_status_created_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.type} -> {self.recipient} ({self.status})"
