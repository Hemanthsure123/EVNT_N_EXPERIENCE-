"""Check-in business rules — fast, correct, one-scan entry at the gate.

Two things matter equally and neither may be sacrificed:

1. **Latency.** People are physically queuing, so a scan must be quick: a
   constant-time signature check (no DB for a forged token) followed by one
   short locked transaction. Nothing slow runs inside the lock; the live-count
   increment and the domain event happen after commit.
2. **Correctness.** The same ticket must NEVER admit two people — even if it's
   scanned at two gates in the same millisecond. The admit decision is made
   under a per-ticket `SELECT ... FOR UPDATE` row lock (the door analog of
   ticketing's no-oversell lock): two concurrent scans serialise on the row,
   exactly one finds the ticket un-used and admits, the other is denied. The
   mark-used write IS the idempotency guard, so a re-scan (or a screenshot of
   an admitted ticket) is always denied.

`checkin` reuses booking's signed-token verifier (`verify_ticket_token`, same
HMAC key) and booking's Ticket record — it never mints tokens or tickets.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from django.utils import timezone

from apps.booking.models import TicketStatus
from apps.booking.qr import verify_ticket_token
from apps.booking.repositories import TicketRepository
from apps.events.repositories import EventRepository
from apps.ticketing.repositories import TicketTypeRepository
from core.events import TICKET_CHECKED_IN
from core.ports.cache_port import CachePort
from core.unit_of_work import UnitOfWork

from .exceptions import EventNotFoundForCheckinError, NotEventCheckerError
from .models import ScanResult
from .repositories import ScanLogRepository
from .selectors import AttendancePayload, bump_attendance
from .selectors import get_attendance as _get_attendance_payload

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class VerifyResult:
    """The gate's response contract — mirrors booking's ConfirmResult so the
    frontend has one clean, predictable shape. `reason` is a ScanResult value.
    """

    allowed: bool
    reason: str  # one of ScanResult.values
    ticket_id: str | None = None
    event_id: str | None = None
    ticket_type: str | None = None
    used_at: datetime | None = None
    gate: str | None = None


class CheckinService:
    def __init__(
        self,
        *,
        scans: ScanLogRepository,
        tickets: TicketRepository,
        ticket_types: TicketTypeRepository,
        events: EventRepository,
        cache: CachePort,
        qr_secret: str,
        window_opens_before_minutes: int,
        window_grace_after_minutes: int,
    ) -> None:
        self._scans = scans
        self._tickets = tickets
        self._ticket_types = ticket_types
        self._events = events
        self._cache = cache
        self._qr_secret = qr_secret
        self._window_opens_before = window_opens_before_minutes
        self._window_grace_after = window_grace_after_minutes

    # --- VerifyAndMarkUsed (the command) -----------------------------------

    def verify_and_mark_used(
        self,
        *,
        event_id: uuid.UUID | str,
        qr_token: str,
        gate: str,
        scanned_by_id: uuid.UUID | str,
        is_admin: bool = False,
    ) -> VerifyResult:
        """Verify a QR at `event_id`'s gate and admit the ticket exactly once.

        `event_id` is the event this gate is stationed for — it drives both the
        authorization check (only that event's organizer may verify for it) and
        the wrong-event check (a ticket for another event is denied here).
        """
        # 1) SIGNATURE — the only proof the token is genuine. A forged/tampered
        #    token is rejected WITHOUT touching the DB (constant-time compare
        #    inside verify_ticket_token; it never raises).
        payload = verify_ticket_token(qr_token, secret=self._qr_secret)
        if payload is None:
            logger.info("checkin.denied_invalid", extra={"event_id": str(event_id), "gate": gate})
            return VerifyResult(allowed=False, reason=ScanResult.DENIED_INVALID)

        # 2) AUTHORIZATION — only the event's organizer (or an admin) may verify
        #    for this event. Events are public, so a missing event is a plain 404.
        event = self._events.get_for_checkin(event_id)
        if event is None:
            raise EventNotFoundForCheckinError(str(event_id))
        if not is_admin and str(event.organization.owner_id) != str(scanned_by_id):
            raise NotEventCheckerError()

        # 3) Load the ticket (no lock) for the cheap, lock-free denials.
        ticket = self._tickets.get_for_checkin(payload.ticket_id)
        if ticket is None:
            # Correctly signed but no such ticket (deleted?) — nothing to admit
            # and nothing to attribute an audit row to.
            logger.info("checkin.denied_invalid_unknown_ticket", extra={"event_id": str(event_id)})
            return VerifyResult(allowed=False, reason=ScanResult.DENIED_INVALID)

        summary = _summary(ticket)
        if str(ticket.booking.event_id) != str(event_id):
            return self._deny(
                ScanResult.DENIED_WRONG_EVENT, ticket, event_id, scanned_by_id, gate, summary
            )
        # Already admitted (a re-scan or a screenshot of a used ticket) — denied
        # fast, no lock needed: a used ticket is terminal, so there's no race to
        # guard here (the lock guards the ACTIVE -> used transition only).
        if ticket.status == TicketStatus.USED:
            return self._already_used(ticket, event_id, scanned_by_id, gate, summary)
        if ticket.status != TicketStatus.ACTIVE:  # void / refunded
            return self._deny(
                ScanResult.DENIED_NOT_ACTIVE, ticket, event_id, scanned_by_id, gate, summary
            )
        if not self._within_window(event):
            return self._deny(
                ScanResult.DENIED_OUT_OF_WINDOW, ticket, event_id, scanned_by_id, gate, summary
            )

        # 4) The authoritative admit decision, under the per-ticket row lock.
        return self._admit_under_lock(
            ticket_id=payload.ticket_id,
            event_id=event_id,
            scanned_by_id=scanned_by_id,
            gate=gate,
            summary=summary,
        )

    # --- get_attendance (the selector, gated by ownership) -----------------

    def get_attendance(
        self,
        *,
        event_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        is_admin: bool = False,
    ) -> AttendancePayload:
        """Live attendance for an event, restricted to its organizer (or an
        admin). The fast/cached read itself lives in the selector — this just
        enforces the same per-event authorization the verify path uses."""
        event = self._events.get_for_checkin(event_id)
        if event is None:
            raise EventNotFoundForCheckinError(str(event_id))
        if not is_admin and str(event.organization.owner_id) != str(actor_id):
            raise NotEventCheckerError()
        return _get_attendance_payload(
            event_id,
            tickets=self._tickets,
            ticket_types=self._ticket_types,
            cache=self._cache,
        )

    def _admit_under_lock(
        self,
        *,
        ticket_id: str,
        event_id: uuid.UUID | str,
        scanned_by_id: uuid.UUID | str,
        gate: str,
        summary: str,
    ) -> VerifyResult:
        # Lock -> re-check -> mark -> log -> commit. Nothing slow inside; the
        # whole critical section is a single-row lock plus two small writes.
        with UnitOfWork() as uow:
            ticket = self._tickets.lock_for_update(ticket_id)
            if ticket is None:  # pragma: no cover — vanished between load and lock
                return VerifyResult(allowed=False, reason=ScanResult.DENIED_INVALID)

            # Re-read the status under the lock — this closes every race:
            # a concurrent scan that admitted first (USED), or a refund that
            # voided it between the pre-check and here (not ACTIVE).
            if ticket.status == TicketStatus.USED:
                # The race loser: a simultaneous scan admitted this ticket first.
                return self._already_used(ticket, event_id, scanned_by_id, gate, summary)
            if ticket.status != TicketStatus.ACTIVE:
                self._scans.record(
                    ticket_id=ticket_id,
                    event_id=event_id,
                    scanned_by_id=scanned_by_id,
                    gate=gate,
                    result=ScanResult.DENIED_NOT_ACTIVE,
                )
                return VerifyResult(
                    allowed=False,
                    reason=ScanResult.DENIED_NOT_ACTIVE,
                    ticket_id=ticket_id,
                    event_id=str(event_id),
                    ticket_type=summary,
                )

            used_at = timezone.now()
            self._tickets.mark_used(ticket, used_at=used_at, gate=gate)
            self._scans.record(
                ticket_id=ticket_id,
                event_id=event_id,
                scanned_by_id=scanned_by_id,
                gate=gate,
                result=ScanResult.ALLOWED,
            )
            uow.publish(
                TICKET_CHECKED_IN,
                {"ticket_id": ticket_id, "event_id": str(event_id), "gate": gate},
                aggregate_id=ticket_id,
            )

        # AFTER commit: bump the live-count fast path (best effort, display
        # only — the DB used-ticket count remains the source of truth).
        bump_attendance(event_id, cache=self._cache)
        logger.info("checkin.allowed", extra={"ticket_id": ticket_id, "gate": gate})
        return VerifyResult(
            allowed=True,
            reason=ScanResult.ALLOWED,
            ticket_id=ticket_id,
            event_id=str(event_id),
            ticket_type=summary,
            used_at=used_at,
            gate=gate,
        )

    def _deny(
        self,
        result: str,
        ticket,
        event_id: uuid.UUID | str,
        scanned_by_id: uuid.UUID | str,
        gate: str,
        summary: str,
    ) -> VerifyResult:
        """Record a denial (fast single insert) and return it."""
        self._scans.record(
            ticket_id=ticket.id,
            event_id=event_id,
            scanned_by_id=scanned_by_id,
            gate=gate,
            result=result,
        )
        return VerifyResult(
            allowed=False,
            reason=result,
            ticket_id=str(ticket.id),
            event_id=str(event_id),
            ticket_type=summary,
        )

    def _already_used(
        self,
        ticket,
        event_id: uuid.UUID | str,
        scanned_by_id: uuid.UUID | str,
        gate: str,
        summary: str,
    ) -> VerifyResult:
        """Record and return a denied_already_used result, carrying the ORIGINAL
        admit's used_at/gate so the gate screen can show when/where it entered.
        Used by both the fast pre-lock re-scan path and the race-loser under the
        lock."""
        self._scans.record(
            ticket_id=ticket.id,
            event_id=event_id,
            scanned_by_id=scanned_by_id,
            gate=gate,
            result=ScanResult.DENIED_ALREADY_USED,
        )
        return VerifyResult(
            allowed=False,
            reason=ScanResult.DENIED_ALREADY_USED,
            ticket_id=str(ticket.id),
            event_id=str(event_id),
            ticket_type=summary,
            used_at=ticket.used_at,
            gate=ticket.gate,
        )

    def _within_window(self, event) -> bool:
        """Is now inside the configurable scan window? Opens a few hours before
        start and closes a grace period after the event ends (or after start if
        no end time is set). A scan well outside this is denied — a ticket
        can't be used days early or long after the event."""
        now = timezone.now()
        opens = event.starts_at - timedelta(minutes=self._window_opens_before)
        closes = (event.ends_at or event.starts_at) + timedelta(minutes=self._window_grace_after)
        return opens <= now <= closes


def _summary(ticket) -> str:
    """A tiny, PII-free display hint for the gate screen: the tier name. The
    token carries only ids, so no attendee data is ever exposed here."""
    return ticket.ticket_type.name
