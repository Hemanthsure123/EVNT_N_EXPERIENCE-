"""Observers for check-in domain events, via the outbox -> event bus. Wired in
apps.py AppConfig.ready(). Log-only for now; the later `notifications` module
will react to TICKET_CHECKED_IN (e.g. a "you're in" push, or live organizer
analytics) without check-in needing to know about it."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def handle_ticket_checked_in(payload: dict) -> None:
    logger.info(
        "checkin.ticket_checked_in",
        extra={"ticket_id": payload["ticket_id"], "event_id": payload.get("event_id", "")},
    )
