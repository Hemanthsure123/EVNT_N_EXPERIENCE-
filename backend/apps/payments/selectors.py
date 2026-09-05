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
        **_settled_refund(booking),
    }


def _settled_refund(booking) -> dict:
    """The `Refund` row for this booking, flattened — or three nulls.

    ── A REQUEST IS NOT A REFUND, AND THE SCREEN HAS TO SAY WHICH ─────────

    `status == "approved"` means a human said yes and the vendor call was
    enqueued. It does NOT mean money moved: `execute_refund` writes a `Refund`
    only after the provider accepted it, which is the one fact a customer
    chasing their bank actually needs. Reading `approved` as "refunded" is the
    single mistake this whole two-table design exists to prevent, so the
    settled facts are separate fields rather than an interpretation of status.

    `reference` is the provider's own refund id — the string a bank asks for
    when somebody rings to say the credit has not landed. It is not a secret
    (it identifies a refund the caller already owns and nothing else), and
    withholding it just means the customer has to open a support ticket to be
    read a number back.

    Null everywhere until the money has genuinely moved. Nothing here is
    inferred from a status.

    Relies on `list_for_user`'s prefetch; a caller that loaded the request
    without it pays two queries here rather than returning something wrong.
    """
    settled = None
    for payment in booking.payments.all():
        for refund in payment.refunds.all():
            if settled is None or refund.created_at > settled.created_at:
                settled = refund
    if settled is None:
        return {"refund_reference": None, "refund_amount_minor": None, "refunded_at": None}
    return {
        "refund_reference": settled.rzp_refund_id,
        "refund_amount_minor": settled.amount_minor,
        "refunded_at": settled.created_at.isoformat(),
    }


def refund_request_payloads(requests) -> list[dict]:
    return [refund_request_payload(request) for request in requests]
