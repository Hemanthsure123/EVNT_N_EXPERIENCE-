"""Settlement records — closing the money loop.

One Settlement per event holds the running reconciliation (gross / platform_fee
/ refunds / net) and the payout lifecycle. The governing rule (see CLAUDE.md):

> The running totals are for fast DISPLAY. At RELEASE time `net` is RECOMPUTED
> AUTHORITATIVELY from the actual payment records under a row lock — the cached
> totals never get to be the source of truth.

Money is integer minor units (paise) everywhere; `net` is a signed integer (it
can be computed negative when refunds exceed gross − fee, which the release
guard treats as nothing-to-pay).

Financial integrity: an organizer is paid the RIGHT amount, EXACTLY ONCE, ONLY
after the event and its refund window — never double-paid, never before the
event, never on money that was refunded.
"""

from __future__ import annotations

import uuid

from django.db import models


class SettlementStatus(models.TextChoices):
    PENDING = "pending", "Pending"  # owed, not yet released
    PAID = "paid", "Paid"  # payout released to the organizer
    FAILED = "failed", "Failed"  # dead-lettered after exhausting retries (still owed)


class PayoutAttemptStatus(models.TextChoices):
    SUCCESS = "success", "Success"
    FAILED = "failed", "Failed"
    ADJUSTMENT = "adjustment", "Adjustment"  # e.g. a refund arriving after payout


class Settlement(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # One settlement per event (unique). PROTECT: a settled event can't be
    # deleted out from under its financial record.
    event = models.OneToOneField(
        "events.Event", on_delete=models.PROTECT, related_name="settlement"
    )
    gross = models.PositiveIntegerField(default=0)
    platform_fee = models.PositiveIntegerField(default=0)
    # Charity money captured with these bookings. Its own column, not folded
    # into `platform_fee`: a financial record that describes a donation as a
    # platform fee is wrong about where money went, even though the net comes
    # out the same.
    donations = models.PositiveIntegerField(default=0)
    refunds = models.PositiveIntegerField(default=0)
    # gross - platform_fee - donations - refunds (may be < 0 pre-guard)
    net = models.IntegerField(default=0)
    status = models.CharField(
        max_length=16, choices=SettlementStatus.choices, default=SettlementStatus.PENDING
    )
    # event end + refund window — the earliest the payout may be released. The
    # scheduled job filters on this (denormalized from the event so the scan is
    # an index range, not a join); the release step re-verifies authoritatively.
    releasable_at = models.DateTimeField(null=True, blank=True)
    payout_at = models.DateTimeField(null=True, blank=True)
    provider_ref = models.CharField(max_length=255, blank=True, default="")
    attempts = models.PositiveIntegerField(default=0)
    error = models.CharField(
        max_length=500, blank=True, default=""
    )  # last failure, for dead-letter
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "settlements_settlement"
        indexes = [
            # The release job's exact query: pending settlements past their
            # release time. Partial on status keeps the index tiny.
            models.Index(
                fields=["releasable_at"],
                name="settlement_release_scan_idx",
                condition=models.Q(status="pending"),
            ),
        ]

    def __str__(self) -> str:
        return f"Settlement {self.id} for event {self.event_id} ({self.status})"


class PayoutAttempt(models.Model):
    """Append-only audit trail of every payout attempt (and any post-payout
    refund adjustment) — the financial record behind each settlement."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    settlement = models.ForeignKey(
        Settlement, on_delete=models.CASCADE, related_name="payout_attempts"
    )
    amount_minor = models.IntegerField()
    status = models.CharField(max_length=16, choices=PayoutAttemptStatus.choices)
    provider_ref = models.CharField(max_length=255, blank=True, default="")
    error = models.CharField(max_length=500, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "settlements_payout_attempt"
        indexes = [
            models.Index(fields=["settlement", "created_at"], name="payoutattempt_settle_idx"),
        ]

    def __str__(self) -> str:
        return f"PayoutAttempt {self.id} ({self.status})"
