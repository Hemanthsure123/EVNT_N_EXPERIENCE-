"""ORM access for payments. The webhook-dedupe and payment lookups are kept
lean; ownership resolution for GET /payments/{id} pulls the booking→event→org
chain in one query."""

from __future__ import annotations

import uuid

from django.db.models import Sum

from core.base_repository import BaseRepository

from .models import (
    Payment,
    PaymentStatus,
    ProcessedWebhook,
    Refund,
    RefundRequest,
    RefundRequestStatus,
)


class PaymentRepository(BaseRepository[Payment]):
    model = Payment

    def get_by_order_id(self, rzp_order_id: str) -> Payment | None:
        return Payment.objects.filter(rzp_order_id=rzp_order_id).first()

    def aggregate_event_settlement(self, event_id: uuid.UUID | str) -> dict:
        """The AUTHORITATIVE settlement figures for an event, derived from the
        payment records (the source of truth `settlements` recomputes under lock
        at release time — never from a running total that could drift):
        - gross        = sum of every captured payment (paid + refunded);
        - platform_fee = sum of those bookings' platform fees;
        - donations    = sum of those bookings' donations;
        - refunds      = sum of the recorded refund amounts.
        net = gross - platform_fee - donations - refunds is computed by the caller.

        ── WHY DONATIONS ARE THEIR OWN LINE ──────────────────────────────────

        `gross` is what was captured, and a captured amount now includes both
        the platform's fee and any donation the buyer added. Both have to come
        back out before the organizer is paid, and they are subtracted
        SEPARATELY rather than summed into `platform_fee`, because a settlement
        report that describes charity money as a platform fee is a lie about
        where money went — which is the one thing a financial record may never
        be, however correct the arithmetic underneath it happens to be.
        """
        captured = Payment.objects.filter(
            booking__event_id=event_id,
            status__in=(PaymentStatus.PAID, PaymentStatus.REFUNDED),
        ).aggregate(
            gross=Sum("amount_minor"),
            platform_fee=Sum("booking__platform_fee_minor"),
            donations=Sum("booking__donation_amount_minor"),
        )
        refunds = Refund.objects.filter(payment__booking__event_id=event_id).aggregate(
            total=Sum("amount_minor")
        )
        return {
            "gross": captured["gross"] or 0,
            "platform_fee": captured["platform_fee"] or 0,
            "donations": captured["donations"] or 0,
            "refunds": refunds["total"] or 0,
        }

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

    def get_paid_for_booking(self, booking_id: uuid.UUID | str) -> Payment | None:
        """The captured payment behind a booking, if there is one.

        A booking can accumulate several `Payment` rows — a failed attempt then
        a successful one, or a `created` order that was never captured — so
        "the payment for this booking" is only well defined once you say PAID.
        Approving a refund request needs exactly that one: the row that
        `execute_refund` can actually act on.

        Newest-first, because a booking that was somehow captured twice should
        surface the most recent; the duplicate would be a bug elsewhere and
        this is not the place to silently pick the older one.
        """
        return (
            Payment.objects.filter(booking_id=booking_id, status=PaymentStatus.PAID)
            .order_by("-created_at")
            .first()
        )


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


class RefundRequestRepository(BaseRepository[RefundRequest]):
    """The refund-REQUEST queue. Distinct from `RefundRepository`, which
    records money that has already moved."""

    model = RefundRequest

    #: Everything a queue row renders, in one query. Without the chain down to
    #: the organization, an organizer's queue of 25 is 100 extra queries — and
    #: the ownership check itself needs `event.organization.owner_id`.
    _ROW_RELATIONS = (
        "booking",
        "booking__user",
        "booking__event",
        "booking__event__organization",
        "requested_by",
        "decided_by",
    )

    def get_for_decision(self, request_id: uuid.UUID | str) -> RefundRequest | None:
        """One request with its ownership chain — for the authorization check
        that precedes a decision."""
        return (
            RefundRequest.objects.select_related(*self._ROW_RELATIONS).filter(pk=request_id).first()
        )

    def lock_for_update(self, request_id: uuid.UUID | str) -> RefundRequest | None:
        """SELECT ... FOR UPDATE on the single request row.

        Two organizers (or an organizer and an operator) opening the same queue
        and pressing Approve and Reject within the same second is a real race on
        a screen designed to be worked through by a team. The lock plus the
        re-read of `status` inside it is what makes the second one a clean
        `409 refund_request_already_decided` instead of a silent overwrite —
        and, more importantly, stops Approve-after-Approve enqueuing the refund
        twice.

        Locks only this row, no join, so the critical section stays tiny. MUST
        run inside the caller's transaction.
        """
        return RefundRequest.objects.select_for_update().filter(pk=request_id).first()

    def create(
        self, *, booking_id: uuid.UUID | str, requested_by_id: uuid.UUID | str, reason: str
    ) -> RefundRequest:
        return RefundRequest.objects.create(
            booking_id=booking_id, requested_by_id=requested_by_id, reason=reason
        )

    def decide(
        self,
        request: RefundRequest,
        *,
        status: str,
        decided_by_id: uuid.UUID | str,
        note: str,
        decided_at,
    ) -> None:
        """Persist only the decision columns — the small write inside the lock."""
        request.status = status
        request.decided_by_id = decided_by_id
        request.decision_note = note
        request.decided_at = decided_at
        request.save(
            update_fields=["status", "decided_by", "decision_note", "decided_at", "updated_at"]
        )

    def mark_failed(self, request_id: uuid.UUID | str, *, note: str) -> None:
        """The approval stood but the money did not move.

        Called from the refund task's failure path. A REQUEST is not a refund,
        and leaving an approved-but-unpaid request reading "approved" would tell
        the customer their money is on its way when nothing was sent.

        Conditional on `status=approved` so it can never overwrite a rejection
        or resurrect a pending row.
        """
        RefundRequest.objects.filter(pk=request_id, status=RefundRequestStatus.APPROVED).update(
            status=RefundRequestStatus.FAILED, decision_note=note
        )

    def has_open_request(self, booking_id: uuid.UUID | str) -> bool:
        """Drives whether the customer is offered the button at all."""
        return RefundRequest.objects.filter(
            booking_id=booking_id, status=RefundRequestStatus.PENDING
        ).exists()

    def list_for_user(self, user_id: uuid.UUID | str):
        return (
            RefundRequest.objects.select_related(*self._ROW_RELATIONS)
            .filter(requested_by_id=user_id)  # type: ignore[misc]
            .order_by("-created_at")
        )

    def list_for_organizer(self, owner_id: uuid.UUID | str, *, status: str | None = None):
        """Requests against events this organizer owns.

        Scoped by `booking__event__organization__owner_id` — the same ownership
        rule every other organizer read uses, applied in the query rather than
        filtered in Python, so a page is a page of THEIRS.
        """
        queryset = RefundRequest.objects.select_related(*self._ROW_RELATIONS).filter(
            booking__event__organization__owner_id=owner_id  # type: ignore[misc]
        )
        if status:
            queryset = queryset.filter(status=status)
        # Pending oldest-first (the person who has waited longest is answered
        # first); everything else newest-first. One ordering per paginator —
        # see `pagination.py`, and the note there about a cursor whose ordering
        # disagrees with its queryset silently returning wrong pages.
        if status == RefundRequestStatus.PENDING:
            return queryset.order_by("created_at")
        return queryset.order_by("-created_at")

    def list_all(self, *, status: str | None = None):
        """Platform-wide, for the operator console."""
        queryset = RefundRequest.objects.select_related(*self._ROW_RELATIONS)
        if status:
            queryset = queryset.filter(status=status)
        if status == RefundRequestStatus.PENDING:
            return queryset.order_by("created_at")
        return queryset.order_by("-created_at")

    def count_pending_for_organizer(self, owner_id: uuid.UUID | str) -> int:
        return RefundRequest.objects.filter(
            booking__event__organization__owner_id=owner_id,  # type: ignore[misc]
            status=RefundRequestStatus.PENDING,
        ).count()

    def count_pending(self) -> int:
        return RefundRequest.objects.filter(status=RefundRequestStatus.PENDING).count()
