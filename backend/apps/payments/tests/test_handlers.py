from __future__ import annotations

from apps.payments import handlers


def test_handlers_do_not_raise():
    handlers.handle_payment_confirmed({"payment_id": "p1"})
    handlers.handle_payment_failed({"payment_id": "p1", "reason": "hold_expired"})
    handlers.handle_payment_refunded({"payment_id": "p1", "reason": "organizer_refund"})
