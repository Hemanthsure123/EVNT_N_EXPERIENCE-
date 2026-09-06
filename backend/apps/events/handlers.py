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


def handle_booking_confirmed(payload: dict) -> None:
    """Somebody bought. Take them off this event's waiting list.

    ── WHY THIS IS AN OBSERVER AND NOT A CALL FROM `booking` ────────────

    `events` must not import `booking` — the dependency runs the other way, and
    `booking` already publishes this fact to the outbox in the same transaction
    as the sale. Reacting to it keeps the direction intact and costs nothing:
    the outbox is drained after commit either way.

    ── AND WHY IT MATTERS ───────────────────────────────────────────────

    Somebody who joined a waiting list and then bought — a hold lapsed under
    them and they refreshed, or a friend sent them a link — stays on the list
    UN-NOTIFIED, because `notified_at` is only set by the sweeper. Days later
    they are emailed "tickets are available" for an event they already hold a
    ticket to, which reads as the platform not knowing what it sold.

    Deleting the row rather than marking it notified is deliberate: they are no
    longer waiting, and a row that says "told" would misreport the organizer's
    demand figure as interest that was served by a notification it never sent.
    """
    from config.di import build_waitlist_service

    user_id = payload.get("user_id")
    event_id = payload.get("event_id")
    if not user_id or not event_id:
        return
    if build_waitlist_service().forget_for_booking(user_id=user_id, event_id=event_id):
        logger.info(
            "events.waitlist_cleared_by_booking",
            extra={"event_id": str(event_id), "user_id": str(user_id)},
        )
