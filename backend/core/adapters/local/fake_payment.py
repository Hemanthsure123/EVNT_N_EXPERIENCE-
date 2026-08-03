"""In-memory PaymentPort adapter — used whenever PAYMENTS_BACKEND=fake (the
default for dev/test). Network operations (create order, refund, linked
account) return deterministic dummy ids with no external call.

Webhook signature verification is the exception: it's PURE COMPUTATION (an
HMAC, no network), so the fake does exactly what production does — real
HMAC-SHA256 with the configured webhook secret. That keeps the
security-critical verification path honest under PAYMENTS_BACKEND=fake, so
tests exercise the real verifier (a correctly-signed webhook passes, a
mis-signed one is rejected) without any Razorpay credentials.

It also implements `SimulatedPaymentPort.capture`, which is what makes a demo
payment completable: it models money arriving at the provider, and nothing
more. It does not confirm bookings or issue tickets — the caller still has to
go and ASK this adapter (`fetch_payment`) and run the same confirm path a real
Razorpay payment runs. The real adapter does not implement that interface, so
no code path can tell Razorpay a payment happened.
"""

from __future__ import annotations

import hashlib
import hmac
import itertools
import logging
import uuid

from core.ports.payment_port import (
    OrderTransfer,
    PaymentPort,
    ProviderPayment,
    SimulatedPaymentPort,
    SplitTransferResult,
)

logger = logging.getLogger(__name__)


class FakePaymentAdapter(PaymentPort, SimulatedPaymentPort):
    def __init__(self, *, webhook_secret: str = "") -> None:
        self._transfer_ids = itertools.count(1)
        self._linked_account_ids = itertools.count(1)
        self._refund_ids = itertools.count(1)
        self._payout_ids = itertools.count(1)
        self._webhook_secret = webhook_secret
        self.orders: dict[str, dict] = {}
        # Payments this adapter has been told were completed, keyed by the
        # id it issued. `fetch_payment` reads this the way the real adapter
        # reads Razorpay.
        self.payments: dict[str, dict] = {}
        self.linked_accounts: dict[str, dict] = {}
        # Idempotency ledgers: one id per key, so a repeat call with the same
        # key returns the same id (mirrors Razorpay's idempotency).
        self.refunds_by_key: dict[str, str] = {}
        self.payouts_by_key: dict[str, dict] = {}

    def create_linked_account(self, *, reference_id: str, name: str, email: str) -> str:
        account_id = f"fake_linked_account_{next(self._linked_account_ids)}"
        self.linked_accounts[account_id] = {
            "reference_id": reference_id,
            "name": name,
            "email": email,
        }
        logger.info("fake_payment.linked_account_created", extra={"account_id": account_id})
        return account_id

    def create_order(
        self,
        *,
        amount_minor: int,
        currency: str,
        receipt: str,
        notes: dict,
        transfers: list[OrderTransfer] | None = None,
    ) -> str:
        # A globally-unique id (like a real Razorpay order id) rather than a
        # process counter — so order ids never collide across restarts in a
        # persistent dev DB, and `booking.get_by_payment_order_id` always
        # resolves the right booking.
        order_id = f"fake_order_{uuid.uuid4().hex[:20]}"
        self.orders[order_id] = {
            "amount_minor": amount_minor,
            "currency": currency,
            "receipt": receipt,
            "notes": notes,
            "transfers": list(transfers or []),
        }
        logger.info("fake_payment.order_created", extra={"order_id": order_id})
        return order_id

    def verify_webhook_signature(self, *, payload: bytes, signature: str) -> bool:
        expected = hmac.new(self._webhook_secret.encode(), payload, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    def capture(self, *, order_id: str, amount_minor: int | None = None) -> str:
        """Simulate the customer completing payment for an order.

        `SimulatedPaymentPort`, NOT `PaymentPort` — a real provider is told this
        by the customer's bank, never by us, and `RazorpayPaymentAdapter` has no
        such method at all. It exists so the fake adapter can model the one
        thing a fake otherwise cannot: money arriving. `fetch_payment` then
        reports it exactly as Razorpay would, so every layer above this runs the
        same code against a fake provider as against a real one.

        ── THE ID IS DERIVED FROM THE ORDER, NOT RANDOM ──────────────────────

        A provider issues ONE payment per successfully captured order. A random
        id per call would mean a double-tapped demo button produced two distinct
        payment ids, two `payment.captured:{id}` ledger rows and two `Payment`
        records for one booking — the second harmless to the customer (the
        confirm is idempotent, so no second ticket) but corrupting the gross
        figure `settlements` recomputes from payment records. Deriving the id
        makes a repeat capture resolve to the SAME id, which the existing ledger
        then dedupes with no new code.

        It is an HMAC rather than a hash so the id cannot be produced by
        anything that does not hold the server secret, matching the one thing
        this fake already does for real (webhook signature verification).

        ── AMOUNT ────────────────────────────────────────────────────────────

        `amount_minor` is passed by the caller because `self.orders` is
        process-local: the order may well have been created by a different
        gunicorn worker, or before the last autoreload. Falling back to the
        stored order keeps the in-process/test path working unchanged.
        """
        payment_id = self._payment_id_for(order_id)
        order = self.orders.get(order_id, {})
        amount = amount_minor if amount_minor is not None else order.get("amount_minor")
        self.payments[payment_id] = {
            "order_id": order_id,
            "amount_minor": int(amount or 0),
            "status": "captured",
        }
        logger.info("fake_payment.captured", extra={"order_id": order_id, "payment_id": payment_id})
        return payment_id

    def _payment_id_for(self, order_id: str) -> str:
        digest = hmac.new(
            self._webhook_secret.encode(), f"capture:{order_id}".encode(), hashlib.sha256
        ).hexdigest()
        return f"fake_pay_{digest[:20]}"

    def fetch_payment(self, *, payment_id: str) -> ProviderPayment | None:
        record = self.payments.get(payment_id)
        if record is None:
            # An id this adapter never issued. Same answer Razorpay gives for
            # one it never issued, which is what keeps the caller's "unknown
            # payment" branch exercised in tests.
            return None
        status = str(record["status"])
        return ProviderPayment(
            payment_id=payment_id,
            order_id=str(record["order_id"]),
            amount_minor=int(record["amount_minor"]),
            status=status,
            is_captured=status == "captured",
        )

    def captured_payment_for_order(self, *, order_id: str) -> ProviderPayment | None:
        """Same question the real adapter answers, against this adapter's own
        ledger. Note the in-memory caveat: `self.payments` is process-local, so
        a reconciliation running in the WORKER process cannot see a capture
        recorded in the WEB process. That is a property of a fake provider, not
        of the reconciliation — against Razorpay the lookup is a real API call
        and is process-independent."""
        for payment_id, record in self.payments.items():
            if str(record.get("order_id")) != order_id:
                continue
            if str(record.get("status")) != "captured":
                continue
            return ProviderPayment(
                payment_id=payment_id,
                order_id=order_id,
                amount_minor=int(record.get("amount_minor") or 0),
                status="captured",
                is_captured=True,
            )
        return None

    def refund(self, *, payment_id: str, amount_minor: int, idempotency_key: str) -> str:
        # Idempotent: the same key always maps to the same refund id, so a
        # retried or concurrent refund never creates a second one.
        if idempotency_key in self.refunds_by_key:
            return self.refunds_by_key[idempotency_key]
        refund_id = f"fake_refund_{next(self._refund_ids)}"
        self.refunds_by_key[idempotency_key] = refund_id
        logger.info("fake_payment.refunded", extra={"payment_id": payment_id})
        return refund_id

    def release_payout(self, *, account_id: str, amount_minor: int, idempotency_key: str) -> str:
        # Idempotent: the same key always maps to the same payout, so a retried
        # or concurrent release never pays out twice. Records the payout so a
        # test can assert the amount/account released.
        if idempotency_key in self.payouts_by_key:
            return self.payouts_by_key[idempotency_key]["payout_id"]
        payout_id = f"fake_payout_{next(self._payout_ids)}"
        self.payouts_by_key[idempotency_key] = {
            "payout_id": payout_id,
            "account_id": account_id,
            "amount_minor": amount_minor,
        }
        logger.info(
            "fake_payment.payout_released",
            extra={"account_id": account_id, "amount_minor": amount_minor, "payout_id": payout_id},
        )
        return payout_id

    def split_transfer(
        self,
        *,
        payment_id: str,
        organizer_account_id: str,
        organizer_amount_minor: int,
        platform_fee_minor: int,
    ) -> SplitTransferResult:
        organizer_transfer_id = f"fake_transfer_{next(self._transfer_ids)}"
        platform_transfer_id = f"fake_transfer_{next(self._transfer_ids)}"
        logger.info(
            "fake_payment.split_transfer",
            extra={"payment_id": payment_id, "organizer_account_id": organizer_account_id},
        )
        return SplitTransferResult(
            payment_id=payment_id,
            organizer_transfer_id=organizer_transfer_id,
            platform_fee_transfer_id=platform_transfer_id,
            status="processed",
        )
