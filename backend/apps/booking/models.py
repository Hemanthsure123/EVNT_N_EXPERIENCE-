"""Booking, its line items, and the issued Tickets — the money-path core.

Lifecycle invariant: every reserved ticket ends up EITHER paid (a Ticket is
issued and the tier's `reserved` becomes `sold`) OR released (the tier's
`reserved` is freed) — never stuck, never leaked, never double-issued.

The **authoritative hold** is the database: a booking holds inventory while
`status == reserved AND hold_expires_at` is in the future. A Redis hold key
was deliberately NOT added — confirm/cancel/sweep already read the booking
row, so a cache hint would earn nothing, and the sweeper (a DB query) is the
reliability backstop that guarantees inventory is freed even if any
best-effort signal is missed.

Money is integer minor units (paise) everywhere — never a float.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class BookingStatus(models.TextChoices):
    RESERVED = "reserved", "Reserved"  # holding inventory, awaiting payment
    PAID = "paid", "Paid"  # confirmed; tickets issued
    CANCELLED = "cancelled", "Cancelled"  # released by the user
    EXPIRED = "expired", "Expired"  # released by the sweeper (hold lapsed)


class TicketStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    USED = "used", "Used"  # scanned at the gate (checkin, later)
    VOID = "void", "Void"


class Booking(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="bookings"
    )
    event = models.ForeignKey("events.Event", on_delete=models.PROTECT, related_name="bookings")
    status = models.CharField(
        max_length=20, choices=BookingStatus.choices, default=BookingStatus.RESERVED
    )
    hold_expires_at = models.DateTimeField()
    total_amount_minor = models.PositiveIntegerField()
    platform_fee_minor = models.PositiveIntegerField()
    # Set after commit, outside the reserve transaction (the external payment
    # order call must never happen under a DB lock).
    payment_order_id = models.CharField(max_length=255, blank=True, default="")
    # The verified payment reference confirm() was called with; the idempotency
    # key for ticket issuance (a webhook can fire twice).
    payment_ref = models.CharField(max_length=255, blank=True, default="")
    # Client-supplied Idempotency-Key: a retry/double-click with the same key
    # returns the original booking instead of reserving again. NULL = no key.
    idempotency_key = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "booking_booking"
        constraints = [
            # Scope idempotency to the user: two different users may coincidentally
            # send the same key string. NULLs are distinct in Postgres, so
            # keyless bookings never collide.
            models.UniqueConstraint(
                fields=["user", "idempotency_key"], name="booking_user_idempotency_key_uniq"
            ),
        ]
        indexes = [
            # The sweeper's exact query: reserved holds whose window has lapsed.
            # Partial on status keeps the index tiny (paid/cancelled/expired
            # bookings never enter it).
            models.Index(
                fields=["hold_expires_at"],
                name="booking_expiry_sweep_idx",
                condition=models.Q(status="reserved"),
            ),
        ]

    def __str__(self) -> str:
        return f"Booking {self.id} ({self.status})"


class BookingItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.ForeignKey(Booking, on_delete=models.CASCADE, related_name="items")
    ticket_type = models.ForeignKey(
        "ticketing.TicketType", on_delete=models.PROTECT, related_name="booking_items"
    )
    quantity = models.PositiveIntegerField()
    # Price captured at purchase time, so a later tier re-price never changes
    # what this order was billed.
    unit_price_minor = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "booking_booking_item"

    def __str__(self) -> str:
        return f"{self.quantity} x {self.ticket_type_id}"


class Ticket(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.ForeignKey(Booking, on_delete=models.CASCADE, related_name="tickets")
    ticket_type = models.ForeignKey(
        "ticketing.TicketType", on_delete=models.PROTECT, related_name="tickets"
    )
    # Signed HMAC token carrying only ids (no PII), unique per ticket. checkin
    # verifies it at the gate.
    qr_token = models.CharField(max_length=512, unique=True)
    status = models.CharField(
        max_length=20, choices=TicketStatus.choices, default=TicketStatus.ACTIVE
    )
    used_at = models.DateTimeField(null=True, blank=True)
    gate = models.CharField(max_length=100, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "booking_ticket"
        indexes = [
            # "My active tickets, newest first" without a full scan.
            models.Index(fields=["booking", "created_at"], name="ticket_booking_created_idx"),
        ]

    def __str__(self) -> str:
        return f"Ticket {self.id} ({self.status})"
