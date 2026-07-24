"""Background task handlers for events. Registered via @register_task at
import time; apps.py's AppConfig.ready() imports this module so registration
happens before any request can enqueue a task.

Poster *processing* (resize/thumbnail generation) is deliberately off the
request path: create/edit uploads the original synchronously (it's quick),
then enqueues this task so the heavier derive-a-variant work never makes the
organizer wait. This is a stand-in — there's no real image pipeline yet —
but it proves the async shape end to end: the derived URL lands on the event
and, if the event is public, the detail cache is invalidated so the next read
reflects it.
"""

from __future__ import annotations

import logging

from django.db import transaction

from core.tasks import register_task

from .models import EventStatus
from .repositories import EventRepository
from .selectors import invalidate_event_caches

logger = logging.getLogger(__name__)


def _processed_poster_url(original_url: str) -> str:
    """Stand-in for producing a resized/optimised variant. A real pipeline
    would upload a derivative via StoragePort and return its URL; here we just
    tag the original deterministically so the effect is observable."""
    return f"{original_url}?variant=1280w"


@register_task("events.process_poster")
def process_poster(payload: dict) -> None:
    event_id = payload["event_id"]
    events = EventRepository()

    event = events.get_active_for_write(event_id)
    if event is None:
        logger.warning("events.process_poster.event_missing", extra=payload)
        return

    processed_url = _processed_poster_url(payload["poster_url"])
    applied = events.set_poster_url(event_id=event_id, poster_url=processed_url)
    if not applied:
        logger.warning("events.process_poster.update_skipped", extra=payload)
        return

    # Only a live event has anything cached publicly; skip the churn for drafts.
    if event.status == EventStatus.LIVE:
        transaction.on_commit(lambda: invalidate_event_caches(event_id))

    logger.info("events.process_poster.done", extra={"event_id": event_id})
