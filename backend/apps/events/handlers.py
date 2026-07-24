"""Observers reacting to this module's domain events, dispatched via the
outbox -> event bus. Wired up in apps.py AppConfig.ready()."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def handle_event_created(payload: dict) -> None:
    # A created event is a draft — nothing to notify anyone about yet, just an
    # audit-friendly log line. Kept as a subscriber so the wiring exists the
    # moment a real reaction (e.g. indexing) is needed.
    logger.info("events.created", extra={"event_id": payload["event_id"]})


def handle_event_published(payload: dict) -> None:
    from config.di import email_port

    if payload.get("owner_email"):
        email_port().send(
            to=payload["owner_email"],
            subject="Your event is live",
            body=f"'{payload.get('title', 'Your event')}' is now published and discoverable.",
        )
    logger.info("events.published", extra={"event_id": payload["event_id"]})
