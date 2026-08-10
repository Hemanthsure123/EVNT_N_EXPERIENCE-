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


def refund_request_payload(request) -> dict:
    """Flatten one refund request into the row every surface renders.

    Pure reshaping — the relations are already loaded by
    `RefundRequestRepository._ROW_RELATIONS`, so a page of these issues no
    query per row.

    `booking_total_minor` rather than an amount on the request itself: the
    number shown is what would actually be refunded, read from the booking, so
    the queue cannot display a figure the executor would not honour.
    """
    booking = request.booking
    return {
        "id": str(request.id),
        "status": request.status,
        "reason": request.reason,
        "decision_note": request.decision_note,
        "created_at": request.created_at.isoformat(),
        "decided_at": request.decided_at.isoformat() if request.decided_at else None,
        "decided_by_email": request.decided_by.email if request.decided_by_id else None,
        "booking_id": str(request.booking_id),
        "booking_total_minor": booking.total_amount_minor,
        "booking_status": booking.status,
        "requested_by_email": request.requested_by.email,
        "requested_by_name": request.requested_by.full_name,
        "event_id": str(booking.event_id),
        "event_title": booking.event.title,
        "event_starts_at": booking.event.starts_at.isoformat(),
    }


def refund_request_payloads(requests) -> list[dict]:
    return [refund_request_payload(request) for request in requests]
