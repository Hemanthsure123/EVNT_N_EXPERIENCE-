"""Background tasks for booking. Registered via @register_task at import time
(apps.py imports this from AppConfig.ready()).

`booking.release_expired` is the auto-release SWEEPER — the reliability
backstop that guarantees held inventory is freed even if a best-effort signal
is missed. In production a scheduler (Cloud Scheduler -> Cloud Tasks) fires it
on a short interval; locally it can be enqueued or invoked directly. It's
safe to run as often as you like: each pass only touches holds that are
genuinely past expiry and still reserved, re-checked under a row lock.
"""

from __future__ import annotations

import logging

from core.tasks import register_task

logger = logging.getLogger(__name__)


@register_task("booking.release_expired")
def release_expired(payload: dict) -> None:
    from config.di import build_booking_service

    limit = int(payload.get("limit", 100))
    released = build_booking_service().release_expired_bookings(limit=limit)
    logger.info("booking.release_expired.done", extra={"released": released})
