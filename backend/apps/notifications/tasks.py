"""Background task handlers — the actual sends and the scheduled reminder,
both kept OFF the request path. Registered via @register_task at import time;
apps.py's AppConfig.ready() imports this module so registration always happens
before any request could enqueue a task (see core/tasks.py)."""

from __future__ import annotations

from core.tasks import register_task

from .services import DISPATCH_TASK, EVENT_REMINDER_TASK, SWEEP_STUCK_TASK


@register_task(DISPATCH_TASK)
def dispatch_notification(payload: dict) -> None:
    """Deliver one claimed notification (retry/dead-letter handled inside)."""
    from config.di import build_notification_service

    build_notification_service().dispatch(payload["notification_id"])


@register_task(EVENT_REMINDER_TASK)
def send_event_reminder(payload: dict) -> None:
    """Fan a scheduled reminder out to an event's current ticket holders."""
    from config.di import build_reminder_service

    build_reminder_service().send_event_reminders(payload["event_id"])


@register_task(SWEEP_STUCK_TASK)
def sweep_stuck(payload: dict) -> None:
    """Re-enqueue sends claimed but never dispatched. Scheduler-fired; see
    core/scheduling.py. Idempotent — dispatch re-checks under the row lock."""
    from config.di import build_notification_service

    build_notification_service().sweep_stuck(
        older_than_seconds=int(payload.get("older_than_seconds", 300)),
        limit=int(payload.get("limit", 200)),
    )
