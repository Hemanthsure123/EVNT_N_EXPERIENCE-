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
    # Web Push. Unlike the other two, its `recipient` is a USER ID rather than
    # an address: one person may have this site open on a laptop and a phone,
    # and the reminder they should receive is one reminder, not one per device.
    # Fan-out to that user's live subscriptions happens at dispatch.
    PUSH = "push", "Web Push"


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
    # ONE ticket, sent to the person it admits — a guest the buyer named, who
    # very likely has no account here. Its own type rather than a reuse of
    # TICKET_DELIVERY because the audience is different in the way that matters:
    # this reader did not pay, cannot see the booking, and must not be shown the
    # order total or the other guests' codes. Different content, different
    # dedupe key, different recipient.
    ATTENDEE_TICKET = "attendee_ticket", "Attendee ticket email"
    BOOKING_CONFIRMATION_SMS = "booking_confirmation_sms", "Booking confirmation SMS"
    # The buyer sending a RECEIPT to whoever they booked for. Its own type, and
    # deliberately not a reuse of TICKET_DELIVERY or ATTENDEE_TICKET: those two
    # carry a scannable code, and this reader must not get one. See
    # `apps.booking.receipt_pdf` for why that is a security decision rather
    # than a content preference.
    BOOKING_RECEIPT_SHARED = "booking_receipt_shared", "Shared booking receipt"
    REFUND_CONFIRMATION = "refund_confirmation", "Refund confirmation email"
    # An operator removed an event. Two audiences, two messages: the ATTENDEE
    # is told their booking is cancelled and their money is coming back; the
    # ORGANIZER is told their event was removed and why. Neither is the other's
    # message with a word changed.
    EVENT_CANCELLED_ATTENDEE = "event_cancelled_attendee", "Event cancelled (attendee)"
    EVENT_DELETED_ORGANIZER = "event_deleted_organizer", "Event removed (organizer)"
    # ── The refund REQUEST lifecycle ────────────────────────────────────
    # Three types, because three different people need to be told three
    # different things — and none of them is "your refund happened", which is
    # what REFUND_CONFIRMATION above already says once money has actually
    # moved. A request is a conversation; a refund is a fact.
    #
    # REFUND_REQUEST_RECEIVED goes to the ORGANIZER: somebody is waiting on
    # them. Without it a request sits in a queue nobody knows to open, which is
    # the exact failure the model was added to fix.
    REFUND_REQUEST_RECEIVED = "refund_request_received", "Refund request received (organizer)"
    # ...and these two to the CUSTOMER. The rejection carries the organizer's
    # note, which is the only part of a refusal anybody reads.
    REFUND_REQUEST_APPROVED = "refund_request_approved", "Refund request approved"
    REFUND_REQUEST_REJECTED = "refund_request_rejected", "Refund request rejected"
    REFUND_CONFIRMATION_SMS = "refund_confirmation_sms", "Refund confirmation SMS"
    OTP = "otp", "OTP SMS"
    # Email address ownership proof at registration. SEPARATE from OTP
    # above, which is the SMS channel for phone sign-in: the channel is
    # derived from the type, so one type cannot serve both.
    EMAIL_VERIFICATION = "email_verification", "Email verification code"
    EVENT_REMINDER = "event_reminder", "Event reminder email"
    EVENT_REMINDER_PUSH = "event_reminder_push", "Event reminder push"
    # The confirmation, on the lock screen. A THIRD logical message alongside
    # the ticket email and the SMS, not a copy of either: its own type, channel,
    # template and dedupe key, so somebody with no subscribed device is exactly
    # as well served as they were before push existed.
    BOOKING_CONFIRMED_PUSH = "booking_confirmed_push", "Booking confirmed push"
    PAYOUT_RELEASED = "payout_released", "Payout released email"
    # --- operator alerts: something is waiting for a human decision --------
    # These go to PLATFORM_ADMIN_EMAILS, not to a customer or an organizer.
    # Each is its own type rather than one "admin alert" with a subject
    # built at the call site: the channel, the template and the dedupe key
    # are all derived from the type here, and a single generic type would
    # make all three the caller's problem again.
    ADMIN_EVENT_REVIEW = "admin_event_review", "Admin: event awaiting review"
    ADMIN_ORG_VERIFICATION = "admin_org_verification", "Admin: organization awaiting verification"
    ADMIN_PERFORMER_REVIEW = "admin_performer_review", "Admin: performer awaiting review"
    ADMIN_HIRE_ENQUIRY = "admin_hire_enquiry", "Admin: hire enquiry received"
    HIRE_ENQUIRY_RECEIVED = "hire_enquiry_received", "Hire enquiry received"


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
    #: The rendered HTML alternative, stored for the same reason `body` is:
    #: dispatch is a pure send of what was decided at claim time, and the log
    #: is the record of what actually left the building. Blank for SMS/push
    #: and for email types that are text-only.
    html_body = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=16, choices=NotificationStatus.choices, default=NotificationStatus.PENDING
    )
    provider_ref = models.CharField(max_length=255, blank=True, default="")
    attempts = models.PositiveIntegerField(default=0)
    error = models.CharField(
        max_length=500, blank=True, default=""
    )  # last failure, for dead-letter
    #: Where tapping a push notification should land. Rendered at claim time
    #: with everything else, so dispatch stays a pure send.
    context_url = models.CharField(max_length=500, blank=True, default="")
    #: Email attachments, base64, as `[{"filename", "content_type", "b64"}]`.
    #:
    #: STORED rather than rebuilt at send time, so `dispatch` remains a pure
    #: send of what was decided at claim — the same guarantee `body` and
    #: `html_body` already provide. Rebuilding instead would let a template
    #: change alter a message that had already been claimed, and would make a
    #: retry send something different from the original attempt.
    #:
    #: Only the ticket delivery email populates it, at a few KB. It carries no
    #: exposure this row did not already have: `body` lists the same QR tokens
    #: in plain text.
    attachments_json = models.JSONField(default=list, blank=True)
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


class PushSubscription(models.Model):
    """One browser, on one device, that agreed to receive notifications.

    Everything here comes from the browser's own `PushSubscription.toJSON()`.
    We store it; we do not mint it.

    ── WHY `endpoint` IS THE UNIQUE KEY, NOT `(user, device)` ────────────────

    The endpoint IS the identity of a subscription — it is the URL of a
    mailbox the browser opened at its own push service. Re-subscribing on the
    same browser returns the same endpoint, so uniqueness on it makes the save
    naturally idempotent: a page that subscribes on every visit writes one
    row, not one per visit. There is no stable "device id" to key on instead,
    and inventing one from a user agent would merge two browsers on one laptop.

    It is hashed into a separate lookup column because a push endpoint is a URL
    with no length bound — Chrome's run past 200 characters and nothing
    promises they will not grow — and Postgres cannot index an unbounded text
    column for equality as cheaply as a fixed-width digest.

    ── IT BELONGS TO A USER, AND SURVIVES THEM LEAVING ──────────────────────

    `on_delete=CASCADE`: a deleted account's push subscriptions must go with
    it. Continuing to push to a device whose account no longer exists is the
    worst kind of orphaned side effect — the person cannot even unsubscribe
    through us any more.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="push_subscriptions"
    )
    endpoint = models.TextField()
    #: SHA-256 of `endpoint`. The indexed, unique lookup key — see the docstring.
    endpoint_hash = models.CharField(max_length=64, unique=True)
    #: The browser's own encryption keys. The payload is encrypted TO these, so
    #: the push service in the middle relays ciphertext it cannot read.
    p256dh = models.CharField(max_length=255)
    auth = models.CharField(max_length=255)
    #: Purely so a person can recognise their own devices in a settings list.
    #: Truncated, never parsed — this is a label, not a fingerprint.
    user_agent = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    #: Last time a push to this row actually succeeded. A subscription that has
    #: not worked in months is a device that is gone; the push service usually
    #: tells us with a 410 first, and this is the backstop for when it does not.
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "notifications_push_subscription"
        indexes = [
            # The dispatch query: every live subscription for one user.
            models.Index(fields=["user", "created_at"], name="pushsub_user_created_idx"),
        ]

    def __str__(self) -> str:
        return f"push:{self.user_id} ({self.user_agent[:40]})"
