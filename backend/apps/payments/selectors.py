"""Read-side of payments. A payment record is sensitive money data → the
detail response is `private, no-store` and never cached."""

from __future__ import annotations

import uuid

from .models import Payment
from .repositories import PaymentRepository


def get_payment_detail(
    payment_id: uuid.UUID | str, *, payments: PaymentRepository | None = None
) -> Payment | None:
    """Payment + booking + user + event + organization in one query, so the
    view can both render it and check owner/organizer access without N+1."""
    payments = payments or PaymentRepository()
    return payments.get_with_event_owner(payment_id)
