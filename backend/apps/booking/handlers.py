"""Observers for booking's domain events, via the outbox -> event bus. Wired
in apps.py AppConfig.ready(). These run AFTER commit, off the request path."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def handle_booking_created(payload: dict) -> None:
    logger.info("booking.created", extra={"booking_id": payload["booking_id"]})


def handle_booking_confirmed(payload: dict) -> None:
    """Log-only observer. Ticket DELIVERY (the email with the QR + an SMS
    confirmation) is owned by the `notifications` module, which subscribes to
    BOOKING_CONFIRMED independently — booking just records the domain fact."""
    logger.info(
        "booking.confirmed",
        extra={"booking_id": payload["booking_id"], "tickets": len(payload.get("ticket_ids", []))},
    )
