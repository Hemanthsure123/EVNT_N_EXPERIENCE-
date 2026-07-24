"""In-memory PaymentPort adapter — used whenever PAYMENTS_BACKEND=fake (the
default for dev/test). Network operations (create order, refund, linked
account) return deterministic dummy ids with no external call.

Webhook signature verification is the exception: it's PURE COMPUTATION (an
HMAC, no network), so the fake does exactly what production does — real
HMAC-SHA256 with the configured webhook secret. That keeps the
security-critical verification path honest under PAYMENTS_BACKEND=fake, so
tests exercise the real verifier (a correctly-signed webhook passes, a
mis-signed one is rejected) without any Razorpay credentials.
"""

from __future__ import annotations

import hashlib
import hmac
import itertools
import logging
import uuid

from core.ports.payment_port import OrderTransfer, PaymentPort, SplitTransferResult

logger = logging.getLogger(__name__)


class FakePaymentAdapter(PaymentPort):
    def __init__(self, *, webhook_secret: str = "") -> None:
        self._transfer_ids = itertools.count(1)
        self._linked_account_ids = itertools.count(1)
        self._refund_ids = itertools.count(1)
        self._webhook_secret = webhook_secret
        self.orders: dict[str, dict] = {}
        self.linked_accounts: dict[str, dict] = {}
        # Idempotency ledger: one refund id per key, so a repeat call with the
        # same key returns the same id (mirrors Razorpay's idempotency).
        self.refunds_by_key: dict[str, str] = {}

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

    def refund(self, *, payment_id: str, amount_minor: int, idempotency_key: str) -> str:
        # Idempotent: the same key always maps to the same refund id, so a
        # retried or concurrent refund never creates a second one.
        if idempotency_key in self.refunds_by_key:
            return self.refunds_by_key[idempotency_key]
        refund_id = f"fake_refund_{next(self._refund_ids)}"
        self.refunds_by_key[idempotency_key] = refund_id
        logger.info("fake_payment.refunded", extra={"payment_id": payment_id})
        return refund_id

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
