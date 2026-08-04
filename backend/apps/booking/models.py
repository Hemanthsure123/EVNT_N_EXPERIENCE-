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
            # The reconciliation job's exact query: bookings the sweeper has
            # already given up on, but only for the short grace window in which
            # a payment may still turn out to have been captured. Partial on
            # both the terminal statuses AND "has an order id", because a
            # booking that never reached the payment step has nothing to
            # reconcile — that pair is most of the table and none of the work.
            models.Index(
                fields=["hold_expires_at"],
                name="booking_reconcile_idx",
                condition=models.Q(status__in=("expired", "cancelled"))
                & ~models.Q(payment_order_id=""),
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
    # THE PRICE THIS LINE WAS BILLED — written from the locked reserve
    # decision, so a later tier re-price (or a sale phase closing) never
    # changes what this order was charged. Every item's
    # `unit_price_minor x quantity` sums to the booking's
    # `total_amount_minor`, which is the figure payments' webhook
    # amount-checks; a line item that disagreed with it would make the
    # invoice and the money two different stories.
    unit_price_minor = models.PositiveIntegerField()
    # WHICH sale phase priced it ("Early bird"), NULL when it billed at the
    # tier's face price. A name, not an FK: phases are replaced wholesale on
    # every schedule edit (CASCADE, no financial record kept), so a reference
    # would dangle while what the buyer needs on their invoice is the label
    # they were shown at checkout. Nothing queries by it, so no index.
    phase_name = models.CharField(max_length=40, null=True, blank=True)
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
    # WHO THIS TICKET ADMITS, when it isn't the buyer. Someone booking ten seats
    # names the other nine people so each gets their own copy of their own
    # ticket, instead of the buyer forwarding one email with ten QR codes.
    #
    # These are columns ON the ticket, not an assignment table, because one
    # ticket admits exactly one person: a separate table would permit two rows
    # for one seat, and "which of these two is the real holder" is precisely the
    # question that must never be askable. Blank is the default and stays
    # permanently valid — it means the buyer is going.
    #
    # No index: nothing queries by attendee. Every read of these reaches them
    # through the booking, which `ticket_booking_created_idx` already covers.
    attendee_name = models.CharField(max_length=120, blank=True, default="")
    attendee_email = models.EmailField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "booking_ticket"
        indexes = [
            # "My active tickets, newest first" without a full scan.
            models.Index(fields=["booking", "created_at"], name="ticket_booking_created_idx"),
        ]

    def __str__(self) -> str:
        return f"Ticket {self.id} ({self.status})"
