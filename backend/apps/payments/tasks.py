"""Background tasks for payments. Registered via @register_task at import time
(apps.py imports this from AppConfig.ready()).

`payments.process_refund` runs the external refund OFF the webhook path so the
webhook returns fast. It's idempotent (see PaymentService.execute_refund), so
the task queue's retry + dead-letter (Cloud Tasks in prod) can safely re-run it
— a refund is never issued twice.
"""

from __future__ import annotations

import logging

from core.tasks import register_task

logger = logging.getLogger(__name__)


@register_task("payments.process_refund")
def process_refund(payload: dict) -> None:
    from config.di import build_payment_service

    refunded = build_payment_service().execute_refund(
        payment_id=payload["payment_id"], reason=payload.get("reason", "")
    )
    logger.info(
        "payments.process_refund.done",
        extra={"payment_id": payload["payment_id"], "refunded": refunded},
    )


@register_task("payments.reconcile_pending")
def reconcile_pending(payload: dict) -> None:
    """The money path's backstop: ask the provider about bookings that are
    holding a payment order nothing has resolved.

    Registered here rather than in `booking` because the question it asks is a
    payments question ("did the provider capture this order?"), and the answer
    goes through `PaymentService`'s ledger. Scheduled in `core/scheduling.py` —
    a task that is only "meant to run periodically" in a comment is a task that
    does not run at all, which is the exact failure this one exists to catch.
    """
    from config.di import build_payment_service

    stats = build_payment_service().reconcile_pending(limit=int(payload.get("limit", 100)))
    logger.info("payments.reconcile_pending.done", extra=stats)
