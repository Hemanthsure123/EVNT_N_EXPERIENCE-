"""Check-in scan records — the append-only audit trail of every gate scan.

`checkin` does NOT mint tickets or tokens (booking owns those). It verifies a
signed QR at the gate, marks the ticket used exactly once (updating booking's
Ticket), and records EVERY scan here — allowed or denied — so the door has a
complete, tamper-evident history.

The governing rule (see CLAUDE.md): availability *display* (the live
attendance count) is cached and fast, but the admit *decision* is always made
under a per-ticket row lock, never from a cache — one ticket can admit exactly
one person, even under two simultaneous scans.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class ScanResult(models.TextChoices):
    ALLOWED = "allowed", "Allowed"
    DENIED_ALREADY_USED = "denied_already_used", "Denied — already used"
    DENIED_INVALID = "denied_invalid", "Denied — invalid token"
    DENIED_WRONG_EVENT = "denied_wrong_event", "Denied — wrong event"
    DENIED_NOT_ACTIVE = "denied_not_active", "Denied — ticket not active"
    DENIED_OUT_OF_WINDOW = "denied_out_of_window", "Denied — outside scan window"


class ScanLog(models.Model):
    """One row per scan attempt that reached a real ticket. Append-only: rows
    are never updated or deleted, so the audit trail is immutable.

    A forged/tampered token is rejected before any DB access (there's no
    trustworthy ticket to attribute it to), so it is logged to the application
    log only, never here — every ScanLog references a genuine issued ticket.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Ticket is owned by booking; PROTECT so a scanned ticket can't be deleted
    # out from under its audit history.
    ticket = models.ForeignKey("booking.Ticket", on_delete=models.PROTECT, related_name="scan_logs")
    # The event this gate is checking in for (the scan's context). For a
    # denied_wrong_event scan this is the gate's event, not the ticket's.
    event = models.ForeignKey("events.Event", on_delete=models.PROTECT, related_name="scan_logs")
    # The gate staff / organizer who performed the scan.
    scanned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="scans"
    )
    scanned_at = models.DateTimeField(auto_now_add=True)
    gate = models.CharField(max_length=100, blank=True, default="")
    result = models.CharField(max_length=32, choices=ScanResult.choices)

    class Meta:
        db_table = "checkin_scan_log"
        indexes = [
            # Attendance/audit reads for an event, newest first — the exact
            # WHERE event=? [+ result=?] ORDER BY scanned_at of the read path.
            models.Index(fields=["event", "scanned_at"], name="scanlog_event_scanned_idx"),
            # A single ticket's full scan history (audit lookups by ticket).
            models.Index(fields=["ticket"], name="scanlog_ticket_idx"),
        ]

    def __str__(self) -> str:
        return f"Scan {self.id} ({self.result})"
