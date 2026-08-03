"""Background handlers for calendar sync.

Every one runs OFF the request path. A booking confirmation must never wait
on Google and must never fail because Google did — the ticket is already
paid for, and a calendar entry is a convenience on top of it.
"""

from __future__ import annotations

import logging
import uuid

from core.tasks import register_task

from .exceptions import (
    CalendarNotConnectedError,
    CalendarReconnectRequiredError,
    InsufficientScopeError,
)
from .services import CANCEL_EVENT_TASK, SYNC_BOOKING_TASK, SYNC_EVENT_TASK

logger = logging.getLogger(__name__)


@register_task(SYNC_BOOKING_TASK)
def sync_booking_to_calendar(payload: dict) -> None:
    """Add one confirmed booking to its owner's calendar.

    The three "the user must act" outcomes are swallowed rather than raised:
    not connected, needs reconnect, and scope withheld are all states no
    retry can change, and letting them propagate would burn the queue's
    retry budget and then dead-letter something that was never broken.
    """
    from config.di import build_calendar_sync_service

    try:
        build_calendar_sync_service().add_booking(
            user_id=uuid.UUID(payload["user_id"]),
            booking_id=uuid.UUID(payload["booking_id"]),
        )
    except (CalendarNotConnectedError, CalendarReconnectRequiredError, InsufficientScopeError):
        # Expected and common: most people have not connected a calendar.
        logger.debug("integrations.sync_skipped", extra={"booking_id": payload.get("booking_id")})


@register_task(SYNC_EVENT_TASK)
def sync_event_changes(payload: dict) -> None:
    """The event moved. Update every entry we created for it."""
    from config.di import build_calendar_sync_service

    build_calendar_sync_service().sync_event_changes(event_id=uuid.UUID(payload["event_id"]))


@register_task(CANCEL_EVENT_TASK)
def cancel_event_in_calendars(payload: dict) -> None:
    """The event was cancelled. Take it out of every calendar we wrote to."""
    from config.di import build_calendar_sync_service

    build_calendar_sync_service().cancel_event_everywhere(event_id=uuid.UUID(payload["event_id"]))
