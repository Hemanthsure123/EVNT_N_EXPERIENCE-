"""Background tasks — the scheduled payout release, kept OFF the request path.
Registered via @register_task at import time; apps.py's ready() imports this so
registration happens before any request could enqueue a task."""

from __future__ import annotations

from core.tasks import register_task

from .services import RELEASE_DUE_TASK, RELEASE_TASK


@register_task(RELEASE_TASK)
def release_payout(payload: dict) -> None:
    """Release one settlement's payout (idempotent + locked + retry inside)."""
    from config.di import build_settlement_service

    build_settlement_service().release_payout(payload["settlement_id"])


@register_task(RELEASE_DUE_TASK)
def release_due(payload: dict) -> None:
    """Scan for settlements whose event ended + refund window closed and enqueue
    each for release. Scheduler-fired in prod (e.g. hourly)."""
    from config.di import build_settlement_service

    build_settlement_service().release_due_payouts()
