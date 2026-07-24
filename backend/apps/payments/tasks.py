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
