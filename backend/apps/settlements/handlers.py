"""Observers that keep each event's settlement totals current from the money
path's domain events (via the outbox → event bus; wired in apps.py). These
update the fast DISPLAY figures only — the authoritative net is recomputed from
the payment records at release time.

Settlements is the downstream consumer of payments/events, so reading those rows
here is a permitted one-way dependency."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def handle_payment_confirmed(payload: dict) -> None:
    """PaymentConfirmed → gross += amount, platform_fee += fee for the event."""
    from apps.payments.repositories import PaymentRepository
    from config.di import build_settlement_service

    payment = PaymentRepository().get_with_event_owner(payload["payment_id"])
    if payment is None:
        logger.warning("settlements.confirmed.payment_missing", extra=payload)
        return
    booking = payment.booking
    build_settlement_service().apply_confirmed(
        event=booking.event,
        amount=payment.amount_minor,
        fee=booking.platform_fee_minor,
        donation=booking.donation_amount_minor,
    )


def handle_payment_refunded(payload: dict) -> None:
    """PaymentRefunded → refunds += amount, net -= amount for the event.

    The amount comes off the EVENT, not off `payment.amount_minor`. A refund is
    no longer necessarily the whole payment — a donation stays with the platform
    when a real ticket is refunded — so re-deriving it here would subtract money
    from the organizer's net that the customer never got back. The fallback
    keeps an outbox row written before this field existed replayable.
    """
    from apps.payments.repositories import PaymentRepository
    from config.di import build_settlement_service

    payment = PaymentRepository().get_with_event_owner(payload["payment_id"])
    if payment is None:
        logger.warning("settlements.refunded.payment_missing", extra=payload)
        return
    build_settlement_service().apply_refund(
        event=payment.booking.event,
        amount=int(payload.get("amount_minor") or payment.amount_minor),
    )
