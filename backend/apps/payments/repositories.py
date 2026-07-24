"""ORM access for payments. The webhook-dedupe and payment lookups are kept
lean; ownership resolution for GET /payments/{id} pulls the booking→event→org
chain in one query."""

from __future__ import annotations

import uuid

from core.base_repository import BaseRepository

from .models import Payment, PaymentStatus, ProcessedWebhook, Refund


class PaymentRepository(BaseRepository[Payment]):
    model = Payment

    def get_by_order_id(self, rzp_order_id: str) -> Payment | None:
        return Payment.objects.filter(rzp_order_id=rzp_order_id).first()

    def lock_for_update(self, payment_id: uuid.UUID | str) -> Payment | None:
        """SELECT ... FOR UPDATE — serialises the refund record step so two
        refund attempts can't both mark the payment refunded."""
        return Payment.objects.select_for_update().filter(pk=payment_id).first()

    def get_with_event_owner(self, payment_id: uuid.UUID | str) -> Payment | None:
        """Payment + booking + user + event + organization in one query, for
        the GET detail response and its owner/organizer permission check."""
        return (
            Payment.objects.select_related("booking__user", "booking__event__organization")
            .filter(pk=payment_id)
            .first()
        )

    def record_captured(
        self,
        *,
        booking_id: uuid.UUID | str,
        rzp_order_id: str,
        rzp_payment_id: str,
        amount_minor: int,
    ) -> Payment:
        """Create (or update) the Payment for a captured order and mark it paid.
        Keyed on the unique order id, so a re-record is a safe upsert."""
        payment, created = Payment.objects.get_or_create(
            rzp_order_id=rzp_order_id,
            defaults={
                "booking_id": booking_id,
                "rzp_payment_id": rzp_payment_id,
                "amount_minor": amount_minor,
                "status": PaymentStatus.PAID,
            },
        )
        if not created and payment.status != PaymentStatus.PAID:
            payment.rzp_payment_id = rzp_payment_id
            payment.amount_minor = amount_minor
            payment.status = PaymentStatus.PAID
            payment.save(update_fields=["rzp_payment_id", "amount_minor", "status", "updated_at"])
        return payment

    def record_failed(
        self,
        *,
        booking_id: uuid.UUID | str,
        rzp_order_id: str,
        rzp_payment_id: str,
        amount_minor: int,
    ) -> Payment:
        payment, created = Payment.objects.get_or_create(
            rzp_order_id=rzp_order_id,
            defaults={
                "booking_id": booking_id,
                "rzp_payment_id": rzp_payment_id,
                "amount_minor": amount_minor,
                "status": PaymentStatus.FAILED,
            },
        )
        # Never downgrade a paid/refunded payment to failed on a stray event.
        if not created and payment.status == PaymentStatus.CREATED:
            payment.status = PaymentStatus.FAILED
            payment.rzp_payment_id = rzp_payment_id
            payment.save(update_fields=["status", "rzp_payment_id", "updated_at"])
        return payment

    def mark_refunded(self, payment: Payment) -> None:
        payment.status = PaymentStatus.REFUNDED
        payment.save(update_fields=["status", "updated_at"])


class ProcessedWebhookRepository(BaseRepository[ProcessedWebhook]):
    model = ProcessedWebhook

    def exists(self, dedupe_key: str) -> bool:
        return ProcessedWebhook.objects.filter(dedupe_key=dedupe_key).exists()

    def create(self, *, dedupe_key: str) -> ProcessedWebhook:
        return ProcessedWebhook.objects.create(dedupe_key=dedupe_key)


class RefundRepository(BaseRepository[Refund]):
    model = Refund

    def create(
        self, *, payment_id: uuid.UUID | str, rzp_refund_id: str, amount_minor: int, reason: str
    ) -> Refund:
        return Refund.objects.create(
            payment_id=payment_id,
            rzp_refund_id=rzp_refund_id,
            amount_minor=amount_minor,
            reason=reason,
        )
