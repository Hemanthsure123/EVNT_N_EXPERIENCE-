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

There are three ways a payment reaches fulfilment, and ALL THREE converge on
`_process_captured` — the same ledger key, the same amount check, the same
confirm. That convergence is the point: no entry point gets to be the lenient
one, and adding one cannot issue a second ticket for a payment another already
fulfilled.

1. `handle_webhook`   — the provider PUSHES a signed fact. The primary path.
2. `verify_and_confirm` — the server PULLS the same fact. For deployments with
   no public HTTPS endpoint, where a push can never arrive.
3. `simulate_capture` — a FAKE provider is told money arrived, then (2) runs.
   Refused outright whenever a real provider is configured.
"""

from __future__ import annotations

import datetime
import json
import logging
import uuid
from dataclasses import dataclass

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.booking.exceptions import BookingNotFoundError, NotBookingOwnerError
from apps.booking.models import BookingStatus
from apps.booking.repositories import BookingRepository
from apps.booking.services import BookingService
from core.audit import record_audit
from core.events import (
    PAYMENT_CONFIRMED,
    PAYMENT_FAILED,
    PAYMENT_REFUNDED,
    REFUND_REQUEST_APPROVED,
    REFUND_REQUEST_REJECTED,
    REFUND_REQUESTED,
)
from core.ports.payment_port import PaymentPort, SimulatedPaymentPort
from core.ports.task_queue_port import TaskQueuePort
from core.unit_of_work import UnitOfWork

from .exceptions import (
    BookingNotPayableError,
    BookingNotRefundableError,
    InvalidWebhookSignatureError,
    MalformedWebhookError,
    NotAllowedToDecideRefundError,
    NotAllowedToRefundError,
    PaymentNotFoundError,
    PaymentNotRefundableError,
    RefundDecisionNoteRequiredError,
    RefundRequestAlreadyDecidedError,
    RefundRequestAlreadyOpenError,
    RefundRequestNotFoundError,
    SimulatedPaymentUnavailableError,
)
from .models import Payment, PaymentStatus, RefundRequest, RefundRequestStatus
from .repositories import (
    PaymentRepository,
    ProcessedWebhookRepository,
    RefundRepository,
    RefundRequestRepository,
)

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

    # --- STAGE 1b: verify-on-demand, for deployments with no public URL ----

    def verify_and_confirm(self, *, provider_payment_id: str) -> WebhookOutcome:
        """Ask the provider about a payment and, if it is captured, confirm it.

        ── THIS IS THE SAME TRUST MODEL, NOT A WEAKER ONE ────────────────────

        The rule this module is built on is "never trust the browser", not
        "only trust a webhook". A webhook is the provider PUSHING a signed
        fact; this is the server PULLING the same fact over an authenticated
        outbound call. In both cases the statement "this payment was captured,
        for this order, for this amount" comes from the provider. What the
        browser supplies here is one opaque id — a lookup key, never a claim.
        Every figure used below comes back from `fetch_payment`, and NOTHING
        the caller sent is trusted beyond that id.

        ── WHY IT HAS TO EXIST ───────────────────────────────────────────────

        A webhook needs a publicly reachable HTTPS endpoint. A laptop, a CI
        run and a not-yet-DNS'd deployment do not have one, and on those the
        callback can never arrive — while the customer's money has still left
        their account. "We cannot receive callbacks yet" is an infrastructure
        gap; "a customer paid and got nothing" is a money-path failure. Those
        must not be the same bug, so the fulfilment path does not depend on
        inbound connectivity.

        ── IT CANNOT DOUBLE-ISSUE WITH THE WEBHOOK ───────────────────────────

        It writes the SAME `payment.captured:{id}` ledger row and runs the
        SAME `_process_captured` as the webhook. Whichever arrives first does
        the work; the other is a `duplicate`. So turning the webhook on later
        needs no change here and cannot issue a second ticket for a payment
        this already fulfilled — which is exactly what the ledger is for.
        """
        if not provider_payment_id:
            return WebhookOutcome("ignored")

        # The provider is asked BEFORE any DB work: if it does not know this
        # id, or has not captured it, there is nothing to record.
        payment = self._port.fetch_payment(payment_id=provider_payment_id)
        if payment is None:
            logger.info(
                "payments.verify.unknown_payment", extra={"payment_id": provider_payment_id}
            )
            return WebhookOutcome("ignored")
        if not payment.is_captured:
            # `authorized` lands here: the bank has reserved the money and not
            # yet handed it over. Issuing a ticket now is issuing one against
            # money that may never arrive.
            logger.info(
                "payments.verify.not_captured",
                extra={"payment_id": provider_payment_id, "status": payment.status},
            )
            return WebhookOutcome("not_captured")

        dedupe_key = f"{_EVENT_CAPTURED}:{payment.payment_id}"
        if self._webhooks.exists(dedupe_key):
            return WebhookOutcome("duplicate")

        # The entity shape `_process_captured` reads, rebuilt from what the
        # PROVIDER returned — deliberately identical to the webhook's, so one
        # code path serves both and neither can drift into being the lenient
        # one.
        entity = {
            "id": payment.payment_id,
            "order_id": payment.order_id,
            "amount": payment.amount_minor,
        }
        try:
            with UnitOfWork() as uow:
                self._webhooks.create(dedupe_key=dedupe_key)
                return self._process_captured(entity, uow)
        except IntegrityError:
            # A webhook (or a concurrent verify) won the unique key; our
            # transaction rolled back and theirs did the work.
            return WebhookOutcome("duplicate")

    # --- STAGE 1c: the demo path, for a deployment with no real provider ---

    def simulate_capture(
        self, *, booking_id: uuid.UUID | str, actor_id: uuid.UUID | str
    ) -> WebhookOutcome:
        """Simulate the customer paying for their own booking at the FAKE
        provider, then fulfil it through the ordinary path.

        ── WHAT MAKES THIS SAFE ──────────────────────────────────────────────

        The browser sends ONE field: which of its own bookings to pay for. It
        does not send an amount, a status, or a payment id — every one of those
        is decided server-side. The amount handed to the provider is read off
        the booking row; the confirmation runs `verify_and_confirm`, which asks
        the provider what it thinks and uses only the answer. So the browser is
        no more the authority here than it is on the real path: it asks, the
        provider states, the server decides.

        ── WHY IT CAPTURES *AND* CONFIRMS IN ONE CALL ────────────────────────

        A real provider does two things: it takes the money, and it tells us it
        took the money. A fake provider cannot make an outbound call, so the
        second half has to be driven from here — this stands in for the webhook
        as well as for the customer. Splitting it into two browser round trips
        would reintroduce exactly the failure this module exists to prevent: a
        payment captured at the provider with nothing on our side ever
        fulfilling it, because a tab closed in between.

        ── AND WHY IT CANNOT DOUBLE-ISSUE ────────────────────────────────────

        Three layers, none of them new: the booking must be `reserved` to be
        captured at all; the fake provider's payment id is derived from the
        order, so a repeat capture is the SAME id; and that id writes the SAME
        `payment.captured:{id}` ledger row the webhook writes, so the second
        attempt is a `duplicate` before it reaches `confirm_booking` — which is
        itself idempotent.
        """
        port = self._port
        if not isinstance(port, SimulatedPaymentPort):
            # A real provider is configured. There is no "simulate" here, and
            # there must not be: it would be a route to a ticket nobody paid for.
            raise SimulatedPaymentUnavailableError()

        booking = self._bookings.get_by_id(booking_id)
        if booking is None:
            raise BookingNotFoundError(str(booking_id))
        if str(booking.user_id) != str(actor_id):
            # Nobody gets to pay for — or fulfil — somebody else's booking.
            raise NotBookingOwnerError()

        if booking.status == BookingStatus.PAID:
            # Already fulfilled. Say so rather than capturing a second time:
            # the confirm would dedupe, but a second capture is a second
            # payment record against one booking, and `settlements` recomputes
            # gross from payment records.
            return WebhookOutcome("already_confirmed")
        if booking.status != BookingStatus.RESERVED or not booking.payment_order_id:
            raise BookingNotPayableError(booking.status)

        provider_payment_id = port.capture(
            order_id=booking.payment_order_id,
            # From the row, never from the request. This is the figure the
            # provider will report back and `_process_captured` will check
            # against the booking — so a tampered request cannot make them agree.
            amount_minor=booking.total_amount_minor,
        )
        logger.info(
            "payments.simulated_capture",
            extra={"booking_id": str(booking.id), "payment_id": provider_payment_id},
        )
        return self.verify_and_confirm(provider_payment_id=provider_payment_id)

    # --- STAGE 1d: reconciliation — the path that needs no browser at all ---

    def reconcile_pending(self, *, limit: int = 100) -> dict:
        """Ask the provider about every booking holding an unresolved order,
        and fulfil (or refund) whatever it says was captured.

        ── THE HOLE THIS CLOSES ──────────────────────────────────────────────

        Stages 1 and 1b both need something to ARRIVE: a webhook needs a public
        HTTPS endpoint, and `verify_and_confirm` needs the customer's browser
        to make one more call after Razorpay hands control back. On a
        deployment with no webhook URL, that browser call was the only path —
        and it is `void verifyPayment(...).catch(() => {})` in a tab the
        customer is free to close. A closed tab, a dead battery, a train
        tunnel, and the money was captured at the provider while this system
        knew nothing: NO TICKET AND NO REFUND, permanently, with no error
        anywhere because nothing failed. Every other guard in this module
        assumes something eventually tells it a payment happened.

        This is the thing that tells it. It needs no inbound connectivity and
        no browser — only the `payment_order_id` already on the booking row,
        which is why `captured_payment_for_order` had to exist.

        ── IT DECIDES NOTHING ITSELF ─────────────────────────────────────────

        It finds candidates and asks. Everything after that is
        `verify_and_confirm`: the same `payment.captured:{id}` ledger row, the
        same amount check, the same `confirm_booking`. So it cannot issue a
        ticket the webhook would not have issued, and cannot issue a second one
        for a payment either of the other two paths already fulfilled.

        ── A CAPTURED PAYMENT FOR A LAPSED HOLD IS A REFUND, NOT A TICKET ────

        If the sweeper released the inventory first, `confirm_booking` returns
        `hold_expired` and the existing branch schedules the auto-refund. That
        is the correct outcome and it is the SECOND half of why this job
        matters: without it, "customer paid, hold lapsed" is not just an
        unissued ticket, it is money kept for nothing.

        Runs outside any transaction: each candidate is an outbound provider
        call, and `verify_and_confirm` opens its own short transaction.
        """
        from django.conf import settings

        now = timezone.now()
        candidates = self._bookings.list_awaiting_reconciliation(
            created_before=now
            - datetime.timedelta(seconds=settings.PAYMENT_RECONCILE_MIN_AGE_SECONDS),
            terminal_since=now
            - datetime.timedelta(minutes=settings.PAYMENT_RECONCILE_GRACE_MINUTES),
            limit=limit,
        )

        stats = {"checked": len(candidates), "captured": 0, "confirmed": 0, "refunding": 0}

        for booking_id, order_id in candidates:
            try:
                payment = self._port.captured_payment_for_order(order_id=order_id)
            except Exception:
                # One unreachable lookup must not stop the rest — the next tick
                # retries it, and the candidate is still in the window.
                logger.exception(
                    "payments.reconcile.lookup_failed",
                    extra={"booking_id": str(booking_id), "order_id": order_id},
                )
                continue

            if payment is None:
                continue  # nobody paid for this one. The ordinary case.

            stats["captured"] += 1
            # Deliberately re-fetches the payment by id inside. That is one
            # extra provider call, paid only on the rare booking that WAS
            # captured without being fulfilled — and it buys a single trust
            # path rather than a second, subtly different one that takes a
            # pre-fetched payment on faith.
            outcome = self.verify_and_confirm(provider_payment_id=payment.payment_id)
            if outcome.status in {"confirmed", "already_confirmed"}:
                stats["confirmed"] += 1
            elif outcome.status == "hold_expired_refunding":
                stats["refunding"] += 1

            logger.warning(
                # WARNING, not INFO: reaching this line means a real payment was
                # fulfilled by a backstop rather than by the path that should
                # have caught it. It works, and it should be visible.
                "payments.reconcile.recovered",
                extra={
                    "booking_id": str(booking_id),
                    "payment_id": payment.payment_id,
                    "outcome": outcome.status,
                },
            )

        if stats["captured"]:
            logger.warning("payments.reconcile.summary", extra=stats)
        return stats

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
            # A refunded ticket must not enter the gate: void the booking's
            # still-active tickets in the SAME transaction as the refund record
            # (booking owns Ticket, so the void lives there). A no-op when the
            # booking never issued tickets (hold_expired / amount_mismatch).
            self._booking_service.void_tickets_for_booking(booking_id=locked.booking_id)
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


class RefundRequestService:
    """The refund REQUEST lifecycle: ask -> decide -> (refund | refusal).

    ── WHY THIS IS ITS OWN SERVICE ────────────────────────────────────────

    Every method on `PaymentService` is part of the money path — a signed
    webhook, a confirmation, the execution of a refund. Every method here is
    part of a HUMAN WORKFLOW: somebody asks, somebody else decides, and the
    outcome is communicated. Different actors, different failure modes,
    different audience. The same reasoning that gave `AccountAdminService` its
    own class rather than growing `AuthService` applies unchanged.

    It also keeps the dependency honest. This service ENQUEUES a refund; it
    never performs one. `PaymentService.execute_refund` stays the single place
    money moves, so its idempotency, its row lock and its vendor idempotency key
    remain the only things standing between a retry and a double refund.

    ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────

    **It does not decide amounts.** A request carries no `amount_minor`, and
    approving one refunds the payment in full — because `execute_refund`
    refunds `payment.amount_minor` and nothing else. There is no partial-refund
    path in this system. A request carrying an amount the executor would ignore
    is a field that silently discards what was typed, which is exactly what the
    rest of this codebase refuses. Partial refunds need `execute_refund` to
    accept an amount FIRST; then this grows the field.

    **It does not auto-approve anything.** No amount threshold, no "within 24
    hours" rule. Every request is decided by a person, because the policy that
    would automate it does not exist and inventing one here would be a rule
    nobody agreed to.
    """

    def __init__(
        self,
        *,
        requests: RefundRequestRepository,
        payments: PaymentRepository,
        bookings: BookingRepository,
        task_queue: TaskQueuePort,
    ) -> None:
        self._requests = requests
        self._payments = payments
        self._bookings = bookings
        self._task_queue = task_queue

    # --- the customer's half ------------------------------------------------

    def request_refund(
        self, *, booking_id: uuid.UUID | str, user_id: uuid.UUID | str, reason: str
    ) -> RefundRequest:
        """Raise a request against the caller's own PAID booking."""
        booking = self._bookings.get_with_event_owner(booking_id)
        if booking is None or str(booking.user_id) != str(user_id):
            # The SAME answer for "no such booking" and "not yours". Splitting
            # them would let this endpoint enumerate other people's bookings by
            # id, one 403 at a time.
            raise RefundRequestNotFoundError(str(booking_id))
        if booking.status != BookingStatus.PAID:
            # A lapsed hold released its own inventory and was never charged; a
            # cancelled booking likewise. There is nothing to give back.
            raise BookingNotRefundableError(booking.status)
        if self._requests.has_open_request(booking_id):
            raise RefundRequestAlreadyOpenError()

        with UnitOfWork() as uow:
            try:
                request = self._requests.create(
                    booking_id=booking_id, requested_by_id=user_id, reason=reason
                )
            except IntegrityError as exc:
                # The partial unique index caught a concurrent double-submit —
                # two taps on a slow connection. The pre-check above is the
                # cheap path; THIS is the correctness guarantee, exactly the way
                # CreateBooking's idempotency key works.
                raise RefundRequestAlreadyOpenError() from exc

            uow.publish(
                REFUND_REQUESTED,
                {
                    "refund_request_id": str(request.id),
                    "booking_id": str(booking_id),
                    "event_id": str(booking.event_id),
                    "organizer_id": str(booking.event.organization.owner_id),
                },
                aggregate_id=str(request.id),
            )
        logger.info(
            "payments.refund_requested",
            extra={"refund_request_id": str(request.id), "booking_id": str(booking_id)},
        )
        return request

    # --- the organizer's / operator's half ---------------------------------

    def decide(
        self,
        *,
        request_id: uuid.UUID | str,
        actor_id: uuid.UUID | str,
        approve: bool,
        note: str = "",
        is_admin: bool = False,
    ) -> RefundRequest:
        """Approve or reject, exactly once, under the request row's lock.

        Approving ENQUEUES `payments.process_refund`; it does not refund
        inline. That keeps the decision fast and puts the vendor call on the
        queue's retry + dead-letter path, where every other external call in
        this module already lives.

        The enqueue is registered with `transaction.on_commit`. Doing it inside
        the transaction would be the outbox bug in miniature: with the
        synchronous task adapter the refund would run and SUCCEED while the
        decision authorising it could still roll back — money returned against
        a request that still reads `pending`.
        """
        request = self._requests.get_for_decision(request_id)
        if request is None:
            raise RefundRequestNotFoundError(str(request_id))
        owner_id = request.booking.event.organization.owner_id
        if not is_admin and str(owner_id) != str(actor_id):
            raise NotAllowedToDecideRefundError()
        if not approve and not note.strip():
            raise RefundDecisionNoteRequiredError()

        payment = self._payments.get_paid_for_booking(request.booking_id) if approve else None
        if approve and payment is None:
            # Approving with no captured payment behind it would enqueue a
            # refund that can never run, and leave the request reading
            # "approved" forever while nothing was sent.
            raise PaymentNotRefundableError("no captured payment for this booking")

        new_status = RefundRequestStatus.APPROVED if approve else RefundRequestStatus.REJECTED

        with UnitOfWork() as uow:
            locked = self._requests.lock_for_update(request_id)
            if locked is None:  # pragma: no cover — vanished between load and lock
                raise RefundRequestNotFoundError(str(request_id))
            # Re-read under the lock: this IS the race. Two people working the
            # same queue press Approve and Reject a second apart; the loser is
            # told so rather than overwriting the winner — and, critically,
            # cannot enqueue a second refund.
            if locked.status != RefundRequestStatus.PENDING:
                raise RefundRequestAlreadyDecidedError(locked.status)

            self._requests.decide(
                locked,
                status=new_status,
                decided_by_id=actor_id,
                note=note.strip(),
                decided_at=timezone.now(),
            )
            uow.publish(
                REFUND_REQUEST_APPROVED if approve else REFUND_REQUEST_REJECTED,
                {
                    "refund_request_id": str(request_id),
                    "booking_id": str(request.booking_id),
                    "payment_id": str(payment.id) if payment else None,
                    "note": note.strip(),
                },
                aggregate_id=str(request_id),
            )
            record_audit(
                actor_id=str(actor_id),
                action=f"refund_request.{'approved' if approve else 'rejected'}",
                target_type="refund_request",
                target_id=str(request_id),
            )

            if approve and payment is not None:
                payment_id = str(payment.id)
                request_ref = str(request_id)
                transaction.on_commit(
                    lambda: self._task_queue.enqueue(
                        _REFUND_TASK,
                        {
                            "payment_id": payment_id,
                            "reason": "customer_request",
                            # Carried so the task can mark the REQUEST failed if
                            # the vendor call never succeeds. Without it an
                            # approved-but-unpaid request reads "approved"
                            # forever, telling the customer money is coming.
                            "refund_request_id": request_ref,
                        },
                    )
                )

        request.refresh_from_db()
        logger.info(
            "payments.refund_request_decided",
            extra={"refund_request_id": str(request_id), "status": new_status},
        )
        return request
