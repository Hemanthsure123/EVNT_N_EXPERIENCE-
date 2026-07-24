"""Observers for payments' domain events, via the outbox -> event bus. Wired
in apps.py AppConfig.ready(). Log-only for now; richer reactions (receipts,
settlement reconciliation) belong to notifications/settlements later."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def handle_payment_confirmed(payload: dict) -> None:
    logger.info("payments.confirmed", extra={"payment_id": payload["payment_id"]})


def handle_payment_failed(payload: dict) -> None:
    logger.info(
        "payments.failed",
        extra={"payment_id": payload["payment_id"], "reason": payload.get("reason", "")},
    )


def handle_payment_refunded(payload: dict) -> None:
    logger.info(
        "payments.refunded",
        extra={"payment_id": payload["payment_id"], "reason": payload.get("reason", "")},
    )
