"""ORM access for check-in scan logs — the only place ScanLog queries live.

Reads for the live-attendance display come from the *authoritative* sources
(booking's used-ticket count and ticketing's capacity, via those modules'
repositories); this repository owns only the append-only scan audit trail.
"""

from __future__ import annotations

import uuid

from core.base_repository import BaseRepository

from .models import ScanLog, ScanResult


class ScanLogRepository(BaseRepository[ScanLog]):
    model = ScanLog

    def record(
        self,
        *,
        ticket_id: uuid.UUID | str,
        event_id: uuid.UUID | str,
        scanned_by_id: uuid.UUID | str,
        gate: str,
        result: str,
    ) -> ScanLog:
        """Append one scan row (allowed or denied). The single, fast insert
        that makes every gate scan auditable."""
        return ScanLog.objects.create(
            ticket_id=ticket_id,
            event_id=event_id,
            scanned_by_id=scanned_by_id,
            gate=gate,
            result=result,
        )

    def count_allowed_for_event(self, event_id: uuid.UUID | str) -> int:
        """Admitted count derived from the scan trail. The live display's
        source of truth is booking's used-ticket count (the mark-used write IS
        the idempotency guard); this parallel count exists for audit
        reconciliation — the two must always agree."""
        return ScanLog.objects.filter(event_id=event_id, result=ScanResult.ALLOWED).count()
