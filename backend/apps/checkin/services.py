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


@dataclass(frozen=True)
class LookupResult:
    """What a READ-ONLY resolution of a QR token returns.

    Deliberately a different shape from `VerifyResult`, and the difference is
    the point: there is no `allowed` field, because nothing was decided. A
    caller cannot mistake a lookup for an admission, and a lookup response can
    never be rendered by the gate screen's "admitted / denied" component.

    `would_admit` is the closest thing, and it is named as a HYPOTHETICAL on
    purpose — it answers "if this were scanned right now, would it get in?"
    without that being true a moment later. It is a support tool, not a
    decision.
    """

    found: bool
    reason: str  # a ScanResult value, or ALLOWED when it would currently admit
    would_admit: bool = False
    ticket_id: str | None = None
    event_id: str | None = None
    event_title: str | None = None
    ticket_type: str | None = None
    status: str | None = None
    used_at: datetime | None = None
    gate: str | None = None
    attendee_name: str | None = None


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
        if not self._within_window(event, ticket):
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

    # --- LookupTicket (the read-only twin of verify) ------------------------

    def lookup_ticket(
        self,
        *,
        event_id: uuid.UUID | str,
        qr_token: str,
        actor_id: uuid.UUID | str,
        is_admin: bool = False,
    ) -> LookupResult:
        """Resolve a QR token to a ticket WITHOUT admitting it.

        ── WHY THIS HAD TO EXIST ──────────────────────────────────────────

        `verify_and_mark_used` was the ONLY way to read a ticket, and it marks
        the ticket used under a row lock as its whole purpose. So the single
        most common support question a ticketing platform gets — "is this
        person's ticket real, and have they already gone in?" — could only be
        answered by an operation that **burned the ticket**. An agent checking
        on a customer's behalf would have admitted them from a desk, and the
        customer would then be refused at the actual door with
        `denied_already_used`. There was no safe way to look.

        This is that read. Same signature verification, same authorization,
        same reason vocabulary — and **no writes at all**: no `mark_used`, no
        `ScanLog` row, no outbox event, no cache bump, no transaction.

        ── WHY IT WRITES NO AUDIT ROW EITHER ──────────────────────────────

        `ScanLog` is documented as one row per scan that reached a real ticket,
        append-only, and it is the count that must agree with the used-ticket
        total. A lookup is not a scan. Writing one would inflate the audit
        trail with events that never happened at a gate and would break the
        reconciliation `count_allowed_for_event` exists for. If operator
        lookups need auditing later that is `core.audit`'s job, not ScanLog's.

        ── `would_admit` IS A HYPOTHETICAL, AND SAYS SO ───────────────────

        It answers "would this get in if scanned right now" — which stops being
        true the instant somebody scans it, or the scan window closes. It is
        deliberately not called `allowed`, and `LookupResult` has no `allowed`
        field at all, so no caller can render a lookup as an admission.
        """
        # 1) SIGNATURE first, exactly as the gate does — a forged token costs
        #    no database access here either.
        payload = verify_ticket_token(qr_token, secret=self._qr_secret)
        if payload is None:
            return LookupResult(found=False, reason=ScanResult.DENIED_INVALID)

        # 2) AUTHORIZATION — identical rule to the gate. A lookup exposes the
        #    attendee's name, so it cannot be laxer than the scan it stands in
        #    for; an operator who may not check tickets for this event may not
        #    read them either.
        event = self._events.get_for_checkin(event_id)
        if event is None:
            raise EventNotFoundForCheckinError(str(event_id))
        if not is_admin and str(event.organization.owner_id) != str(actor_id):
            raise NotEventCheckerError()

        ticket = self._tickets.get_for_lookup(payload.ticket_id)
        if ticket is None:
            return LookupResult(found=False, reason=ScanResult.DENIED_INVALID)

        # 3) Evaluate the SAME ladder the gate walks, in the same order, and
        #    report where it would stop. Kept parallel to `verify_and_mark_used`
        #    on purpose: if the two disagreed, a support agent would confidently
        #    tell somebody they were fine and the door would refuse them.
        if str(ticket.booking.event_id) != str(event_id):
            reason = ScanResult.DENIED_WRONG_EVENT
        elif ticket.status == TicketStatus.USED:
            reason = ScanResult.DENIED_ALREADY_USED
        elif ticket.status != TicketStatus.ACTIVE:
            reason = ScanResult.DENIED_NOT_ACTIVE
        elif not self._within_window(event, ticket):
            reason = ScanResult.DENIED_OUT_OF_WINDOW
        else:
            reason = ScanResult.ALLOWED

        return LookupResult(
            found=True,
            reason=reason,
            would_admit=reason == ScanResult.ALLOWED,
            ticket_id=str(ticket.id),
            event_id=str(ticket.booking.event_id),
            event_title=ticket.booking.event.title,
            ticket_type=_summary(ticket),
            status=ticket.status,
            used_at=ticket.used_at,
            # Empty string is the stored default and means "the buyer is
            # going" — normalised to null so the client renders the buyer's own
            # name rather than an empty row labelled "Attendee".
            gate=ticket.gate or None,
            attendee_name=ticket.attendee_name or None,
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

    def _within_window(self, event, ticket=None) -> bool:
        """Is now inside the configurable scan window? Opens a few hours before
        start and closes a grace period after the event ends (or after start if
        no end time is set). A scan well outside this is denied — a ticket
        can't be used days early or long after the event.

        THE WINDOW BELONGS TO THE SESSION, not to the event, whenever the
        ticket's tier sells one. `Event.starts_at` on a multi-session event is
        the FIRST show — deriving the window from it would open the 21:00 door
        at 17:00, and the whole point of selling sessions separately is that
        those are different rooms of people. A single-session event has no slot
        and falls through to exactly the old behaviour.
        """
        slot = getattr(getattr(ticket, "ticket_type", None), "slot", None)
        starts_at = slot.starts_at if slot else event.starts_at
        # A slot's end is optional, and a session with none is not the same as
        # a session ending when the EVENT does — the event's end is the last
        # show's. Falling back to the start keeps the grace period attached to
        # the right hour.
        ends_at = (slot.ends_at or slot.starts_at) if slot else (event.ends_at or event.starts_at)

        now = timezone.now()
        opens = starts_at - timedelta(minutes=self._window_opens_before)
        closes = ends_at + timedelta(minutes=self._window_grace_after)
        return opens <= now <= closes


def _summary(ticket) -> str:
    """A tiny, PII-free display hint for the gate screen: the tier name, and
    the session where there is one. The token carries only ids, so no attendee
    data is ever exposed here.

    The session matters at the door precisely because two tiers on a
    multi-session event are usually called the same thing — "GA" at 18:00 and
    "GA" at 21:00 — and a steward reading the screen has no other way to tell
    a ticket for the wrong show from a ticket for this one.
    """
    slot = getattr(ticket.ticket_type, "slot", None)
    if slot is None:
        return ticket.ticket_type.name
    return f"{ticket.ticket_type.name} · {slot.label or _slot_when(slot.starts_at)}"


def _slot_when(starts_at) -> str:
    """ "7 Mar, 6:30 PM" — a session with no label, named by its time.

    Built by hand rather than with strftime's `%-d`/`%-I`: those are a glibc
    extension and raise on Windows, where this codebase is also developed.
    """
    local = timezone.localtime(starts_at)
    return f"{local.day} {local:%b}, {local.hour % 12 or 12}:{local:%M %p}"
