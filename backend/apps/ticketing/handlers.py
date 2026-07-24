"""Observers for ticketing's own domain events, dispatched via the outbox ->
event bus. Wired in apps.py AppConfig.ready()."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def handle_ticket_type_added(payload: dict) -> None:
    logger.info("ticketing.ticket_type_added", extra={"ticket_type_id": payload["ticket_type_id"]})


def handle_ticket_type_sold_out(payload: dict) -> None:
    # A real system might alert the organizer or flip a "sold out" badge here.
    # For now it's an audit-friendly log line; the wiring exists so adding a
    # reaction later is a one-liner.
    logger.info(
        "ticketing.ticket_type_sold_out",
        extra={"ticket_type_id": payload["ticket_type_id"], "event_id": payload["event_id"]},
    )
