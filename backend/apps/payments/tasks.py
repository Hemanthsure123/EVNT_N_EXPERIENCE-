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

    request_id = payload.get("refund_request_id")
    try:
        refunded = build_payment_service().execute_refund(
            payment_id=payload["payment_id"], reason=payload.get("reason", "")
        )
    except Exception:
        # A REQUEST is not a refund. Leaving an approved-but-unpaid request
        # reading "approved" tells the customer their money is on its way when
        # nothing was sent — so the request is moved to `failed` and the
        # exception is re-raised so the queue still retries and dead-letters it.
        #
        # `mark_failed` is conditional on `status=approved`, so a retry that
        # eventually succeeds cannot be undone by a late failure marker, and a
        # rejection can never be overwritten by one.
        if request_id:
            _mark_request_failed(request_id, "The refund could not be completed. We are on it.")
        raise

    # `refunded == False` is DELIBERATELY not treated as a failure.
    #
    # `execute_refund` returns False for several unrelated reasons, and they do
    # not share an outcome: the payment was already refunded (this task is a
    # retry, and the money DID move), a concurrent refund recorded it first
    # (likewise), or the payment was never captured (it did not). Marking the
    # request `failed` on all of them would tell a customer whose refund
    # succeeded that it had not, every time the queue retried a task that had
    # already done its job — turning at-least-once delivery into a false alarm.
    #
    # The one case that genuinely needs catching — an approval standing against
    # a payment that cannot be refunded — is already refused at DECISION time:
    # `RefundRequestService.decide` looks up the captured payment first and
    # raises `PaymentNotRefundableError` rather than approving. So the only way
    # to reach here with nothing refunded is a benign replay.
    logger.info(
        "payments.process_refund.done",
        extra={
            "payment_id": payload["payment_id"],
            "refunded": refunded,
            "refund_request_id": request_id,
        },
    )


def _mark_request_failed(request_id: str, note: str) -> None:
    from apps.payments.repositories import RefundRequestRepository

    RefundRequestRepository().mark_failed(request_id, note=note)
    logger.warning("payments.refund_request_failed", extra={"refund_request_id": request_id})


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
