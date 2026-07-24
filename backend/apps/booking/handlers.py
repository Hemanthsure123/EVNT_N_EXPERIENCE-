"""Observers for booking's domain events, via the outbox -> event bus. Wired
in apps.py AppConfig.ready(). These run AFTER commit, off the request path."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def handle_booking_created(payload: dict) -> None:
    logger.info("booking.created", extra={"booking_id": payload["booking_id"]})


def handle_booking_confirmed(payload: dict) -> None:
    """Deliver the tickets. A fuller `notifications` module will own rich
    delivery later; for now this emails the buyer that their tickets are ready
    (the ports make it a real send in prod, a console line in dev)."""
    from apps.accounts.repositories import UserRepository
    from config.di import email_port

    user = UserRepository().get_by_id(payload["user_id"])
    if user is not None:
        count = len(payload.get("ticket_ids", []))
        email_port().send(
            to=user.email,
            subject="Your tickets are ready",
            body=f"Your booking is confirmed — {count} ticket(s) issued.",
        )
    logger.info(
        "booking.confirmed",
        extra={"booking_id": payload["booking_id"], "tickets": len(payload.get("ticket_ids", []))},
    )
