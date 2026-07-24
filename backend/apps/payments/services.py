"""Payments business rules — the trust core of the money path.

Two rules, absolute:
1. **The signed webhook is the only source of truth.** Every webhook's HMAC
   signature is verified before anything else; an unsigned/forged one is
   rejected (400) and nothing happens. A browser redirect is never proof.
2. **Never take money without delivering a ticket.** If a captured payment
   can't be fulfilled (the hold expired, or the amount was tampered), the
   payment is AUTOMATICALLY refunded — the platform never keeps money for a
   ticket it didn't issue.

Idempotency is layered: a `ProcessedWebhook` ledger dedupes webhook
deliveries (Razorpay retries), AND booking's `confirm_booking` is itself
idempotent — so a ticket is never double-issued and a refund never
double-runs. External calls (refunds) happen OUTSIDE any DB transaction/lock
and are offloaded to the task queue so the webhook returns fast.
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass

from django.db import IntegrityError, transaction

from apps.booking.repositories import BookingRepository
from apps.booking.services import BookingService
from core.audit import record_audit
from core.events import PAYMENT_CONFIRMED, PAYMENT_FAILED, PAYMENT_REFUNDED
from core.ports.payment_port import PaymentPort
from core.ports.task_queue_port import TaskQueuePort
from core.unit_of_work import UnitOfWork

from .exceptions import (
    InvalidWebhookSignatureError,
    MalformedWebhookError,
    NotAllowedToRefundError,
    PaymentNotFoundError,
    PaymentNotRefundableError,
)
from .models import Payment, PaymentStatus
from .repositories import PaymentRepository, ProcessedWebhookRepository, RefundRepository

logger = logging.getLogger(__name__)

_REFUND_TASK = "payments.process_refund"
_EVENT_CAPTURED = "payment.captured"
_EVENT_FAILED = "payment.failed"


@dataclass(frozen=True)
class WebhookOutcome:
    # "confirmed" | "already_confirmed" | "duplicate" | "amount_mismatch"
    # | "hold_expired_refunding" | "failed" | "ignored"
    status: str


class PaymentService:
    def __init__(
        self,
        *,
        payments: PaymentRepository,
        refunds: RefundRepository,
        webhooks: ProcessedWebhookRepository,
        bookings: BookingRepository,
        booking_service: BookingService,
        payments_port: PaymentPort,
        task_queue: TaskQueuePort,
    ) -> None:
        self._payments = payments
        self._refunds = refunds
        self._webhooks = webhooks
        self._bookings = bookings
        self._booking_service = booking_service
        self._port = payments_port
        self._task_queue = task_queue

    # --- STAGE 1: webhook -> verify -> dedupe -> confirm -------------------

    def handle_webhook(self, *, raw_body: bytes, signature: str) -> WebhookOutcome:
        # 1) SIGNATURE — the only proof this is real. Reject unsigned/forged.
        if not signature or not self._port.verify_webhook_signature(
            payload=raw_body, signature=signature
        ):
            raise InvalidWebhookSignatureError()

        try:
            event = json.loads(raw_body)
        except (ValueError, TypeError) as exc:
            raise MalformedWebhookError() from exc

        event_type = event.get("event", "")
        entity = event.get("payload", {}).get("payment", {}).get("entity", {})
        rzp_payment_id = entity.get("id", "")
        if not rzp_payment_id:
            return WebhookOutcome("ignored")  # not a payment event we handle

        # 2) IDEMPOTENCY — dedupe on (event, payment). Fast path first; the
        # unique constraint below is the race-safe backstop.
        dedupe_key = f"{event_type}:{rzp_payment_id}"
        if self._webhooks.exists(dedupe_key):
            return WebhookOutcome("duplicate")

        try:
            with UnitOfWork() as uow:
                # Written in the SAME transaction as the processing it guards:
                # if processing rolls back, so does this, and Razorpay's retry
                # reprocesses rather than being silently swallowed.
                self._webhooks.create(dedupe_key=dedupe_key)
                outcome = self._process(event_type, entity, uow)
        except IntegrityError:
            # A concurrent duplicate won the unique key; our txn rolled back.
            return WebhookOutcome("duplicate")

        return outcome

    def _process(self, event_type: str, entity: dict, uow: UnitOfWork) -> WebhookOutcome:
        if event_type == _EVENT_CAPTURED:
            return self._process_captured(entity, uow)
        if event_type == _EVENT_FAILED:
            return self._process_failed(entity, uow)
        return WebhookOutcome("ignored")  # recorded in the ledger, no action

    def _process_captured(self, entity: dict, uow: UnitOfWork) -> WebhookOutcome:
        rzp_order_id = entity.get("order_id", "")
        rzp_payment_id = entity["id"]
        amount = int(entity.get("amount", 0))

        booking = self._bookings.get_by_payment_order_id(rzp_order_id)
        if booking is None:
            logger.warning("payments.webhook.unknown_order", extra={"order_id": rzp_order_id})
            return WebhookOutcome("ignored")

        # The money is captured, so record the Payment as paid regardless of
        # what happens next (a mismatch/expired hold then triggers a refund).
        payment = self._payments.record_captured(
            booking_id=booking.id,
            rzp_order_id=rzp_order_id,
            rzp_payment_id=rzp_payment_id,
            amount_minor=amount,
        )

        # 3) AMOUNT CHECK — a tampered/mismatched amount is NOT confirmed; the
        # money is refunded.
        if amount != booking.total_amount_minor:
            logger.warning(
                "payments.webhook.amount_mismatch",
                extra={"payment_id": str(payment.id), "expected": booking.total_amount_minor},
            )
            self._schedule_refund(payment, reason="amount_mismatch")
            uow.publish(
                PAYMENT_FAILED,
                {"payment_id": str(payment.id), "reason": "amount_mismatch"},
                aggregate_id=str(payment.id),
            )
            return WebhookOutcome("amount_mismatch")

        # 4) CONFIRM — booking's confirm is idempotent (a webhook can fire twice).
        result = self._booking_service.confirm_booking(
            booking_id=booking.id, payment_ref=rzp_payment_id
        )
        if result.issued or result.reason == "already_confirmed":
            uow.publish(
                PAYMENT_CONFIRMED,
                {"payment_id": str(payment.id), "booking_id": str(booking.id)},
                aggregate_id=str(payment.id),
            )
            record_audit(
                actor_id="razorpay",
                action="payment.confirmed",
                target_type="payment",
                target_id=str(payment.id),
            )
            return WebhookOutcome("confirmed" if result.issued else "already_confirmed")

        # hold_expired → we can't deliver tickets → refund (never keep money
        # without a ticket). The sweeper already frees the inventory.
        logger.info("payments.webhook.hold_expired", extra={"payment_id": str(payment.id)})
        self._schedule_refund(payment, reason="hold_expired")
        uow.publish(
            PAYMENT_FAILED,
            {"payment_id": str(payment.id), "reason": "hold_expired"},
            aggregate_id=str(payment.id),
        )
        return WebhookOutcome("hold_expired_refunding")

    def _process_failed(self, entity: dict, uow: UnitOfWork) -> WebhookOutcome:
        rzp_order_id = entity.get("order_id", "")
        booking = self._bookings.get_by_payment_order_id(rzp_order_id) if rzp_order_id else None
        if booking is None:
            return WebhookOutcome("ignored")

        payment = self._payments.record_failed(
            booking_id=booking.id,
            rzp_order_id=rzp_order_id,
            rzp_payment_id=entity["id"],
            amount_minor=int(entity.get("amount", 0)),
        )
        # No tickets, no inventory action here: the hold simply expires via
        # booking's sweeper. No leak.
        uow.publish(
            PAYMENT_FAILED,
            {"payment_id": str(payment.id), "reason": "payment_failed"},
            aggregate_id=str(payment.id),
        )
        return WebhookOutcome("failed")

    def _schedule_refund(self, payment: Payment, *, reason: str) -> None:
        # Offloaded to the queue and fired only after the webhook transaction
        # commits — the external refund never runs inline or under a lock, so
        # the webhook returns fast.
        transaction.on_commit(
            lambda: self._task_queue.enqueue(
                _REFUND_TASK, {"payment_id": str(payment.id), "reason": reason}
            )
        )

    # --- STAGE 2: refunds -------------------------------------------------

    def execute_refund(self, *, payment_id: uuid.UUID | str, reason: str) -> bool:
        """Refund a paid payment. IDEMPOTENT and retry/concurrency-safe:
        - a payment already refunded is a no-op;
        - the external refund carries an idempotency key, so the vendor never
          double-refunds even if this runs twice;
        - the record step re-checks under a row lock.
        The external call happens OUTSIDE any lock. Returns True if this call
        performed the refund. Run this via the task queue (retry + dead-letter)."""
        payment = self._payments.get_by_id(payment_id)
        if payment is None:
            return False
        if payment.status == PaymentStatus.REFUNDED:
            return False  # already refunded — idempotent no-op
        if payment.status != PaymentStatus.PAID:
            return False  # only a captured/paid payment can be refunded

        rzp_refund_id = self._port.refund(
            payment_id=payment.rzp_payment_id,
            amount_minor=payment.amount_minor,
            idempotency_key=f"refund:{payment.id}",
        )

        with UnitOfWork() as uow:
            locked = self._payments.lock_for_update(payment_id)
            if locked is None or locked.status == PaymentStatus.REFUNDED:
                return False  # a concurrent refund recorded it first
            self._payments.mark_refunded(locked)
            self._refunds.create(
                payment_id=payment_id,
                rzp_refund_id=rzp_refund_id,
                amount_minor=locked.amount_minor,
                reason=reason,
            )
            uow.publish(
                PAYMENT_REFUNDED,
                {"payment_id": str(payment_id), "reason": reason},
                aggregate_id=str(payment_id),
            )
            record_audit(
                actor_id="system",
                action="payment.refunded",
                target_type="payment",
                target_id=str(payment_id),
            )

        logger.info("payment.refunded", extra={"payment_id": str(payment_id), "reason": reason})
        return True

    def refund_payment(
        self, *, payment_id: uuid.UUID | str, actor_id: uuid.UUID | str, is_admin: bool = False
    ) -> Payment:
        """Organizer/admin-initiated refund. Validates ownership + refundability,
        then OFFLOADS the actual refund to the queue (async, reliable). Returns
        the payment as loaded (poll GET /payments/{id} for the final state)."""
        payment = self._payments.get_with_event_owner(payment_id)
        if payment is None:
            raise PaymentNotFoundError(str(payment_id))
        if not is_admin and str(payment.booking.event.organization.owner_id) != str(actor_id):
            raise NotAllowedToRefundError()
        if payment.status != PaymentStatus.PAID:
            raise PaymentNotRefundableError(payment.status)

        self._task_queue.enqueue(
            _REFUND_TASK, {"payment_id": str(payment.id), "reason": "organizer_refund"}
        )
        return payment
