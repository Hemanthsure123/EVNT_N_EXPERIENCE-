"""Observer callbacks — the domain events that should touch a calendar.

Each one only ENQUEUES. Nothing here talks to Google: these run inside the
outbox drain, which runs inside the transaction that confirmed a booking or
published an event change. A network call there would hold a database
transaction open across the internet, and a Google outage would roll back a
paid booking.
"""

from __future__ import annotations

import logging
import uuid

logger = logging.getLogger(__name__)


def handle_booking_confirmed(payload: dict) -> None:
    """A ticket was issued -> offer it to the buyer's calendar.

    Automatic when a calendar is already connected, which is what the brief
    calls "automatic calendar creation". Someone who has not connected one
    gets nothing here — and the event page still offers the .ics download and
    the Google-calendar link, neither of which needs an account.
    """
    from config.di import build_calendar_sync_service

    user_id = payload.get("user_id")
    booking_id = payload.get("booking_id")
    if not (user_id and booking_id):
        return
    build_calendar_sync_service().enqueue_booking_sync(
        user_id=uuid.UUID(str(user_id)), booking_id=uuid.UUID(str(booking_id))
    )


def handle_event_updated(payload: dict) -> None:
    """The event changed -> update every entry we created for it.

    Enqueued unconditionally rather than diffing the payload for time/venue
    changes: the sync writes the current state, so a redundant update is a
    no-op write, while a missed one leaves people with the wrong time in
    their diary. The cheap mistake is the right one to make here.
    """
    from config.di import build_calendar_sync_service

    event_id = payload.get("event_id")
    if not event_id:
        return
    build_calendar_sync_service().enqueue_event_sync(event_id=uuid.UUID(str(event_id)))


def handle_event_cancelled(payload: dict) -> None:
    """The event is off -> remove it from every calendar we wrote to.

    The most important of the three. A cancelled event left in an attendee's
    calendar is a person travelling across a city to a locked door.
    """
    from config.di import build_calendar_sync_service

    event_id = payload.get("event_id")
    if not event_id:
        return
    build_calendar_sync_service().enqueue_event_cancellation(event_id=uuid.UUID(str(event_id)))
