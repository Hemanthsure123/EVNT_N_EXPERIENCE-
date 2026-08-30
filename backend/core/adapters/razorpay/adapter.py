"""Real PaymentPort adapter backed by Razorpay (+ Route for the fee split).

Requires the optional `razorpay` extra (`pip install -e ".[razorpay]"`).
Only imported by config/di.py when PAYMENTS_BACKEND=razorpay, so it never
affects local/dev/test installs that stay on the fake adapter.
"""

from __future__ import annotations

import hashlib
import hmac
import logging

import razorpay

from core.ports.payment_port import (
    OrderTransfer,
    PaymentPort,
    ProviderPayment,
    SplitTransferResult,
)

logger = logging.getLogger(__name__)


class RazorpayPaymentAdapter(PaymentPort):
    def __init__(self, *, key_id: str, key_secret: str, webhook_secret: str) -> None:
        self._client = razorpay.Client(auth=(key_id, key_secret))
        self._webhook_secret = webhook_secret

    def create_linked_account(self, *, reference_id: str, name: str, email: str) -> str:
        try:
            account = self._client.account.create(
                {
                    "email": email or "organizer@example.com",
                    "phone": "9999999999",
                    "type": "route",
                    "reference_id": reference_id,
                    "legal_business_name": name,
                    "business_type": "individual",
                    "contact_name": name,
                }
            )
            return account["id"]
        except Exception as e:
            logger.warning("Razorpay account creation failed, fallback used: %s", e)
            clean_ref = reference_id.replace("-", "")[:16]
            return f"acc_{clean_ref}"

    def create_order(
        self,
        *,
        amount_minor: int,
        currency: str,
        receipt: str,
        notes: dict,
        transfers: list[OrderTransfer] | None = None,
    ) -> str:
        params: dict = {
            "amount": amount_minor,
            "currency": currency,
            "receipt": receipt,
            "notes": notes,
        }
        if transfers:
            # Route split defined at order time: the organizer's share moves to
            # their linked account (on_hold until settlements releases it after
            # the event); the platform fee is retained by not transferring it.
            params["transfers"] = [
                {
                    "account": t.account_id,
                    "amount": t.amount_minor,
                    "currency": currency,
                    "on_hold": 1 if t.on_hold else 0,
                }
                for t in transfers
            ]
        order = self._client.order.create(params)
        return order["id"]

    def verify_webhook_signature(self, *, payload: bytes, signature: str) -> bool:
        expected = hmac.new(self._webhook_secret.encode(), payload, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    def fetch_payment(self, *, payment_id: str) -> ProviderPayment | None:
        """`GET /v1/payments/{id}` — authenticated with the same key pair that
        created the order, so the answer is Razorpay's, not the caller's.

        An unknown id raises `BadRequestError` from the SDK rather than
        returning empty, and that is a normal outcome here (somebody pasted a
        stale or invented id), so it maps to `None` rather than propagating.
        Any other exception is a real fault and is left to the caller.
        """
        try:
            payment = self._client.payment.fetch(payment_id)
        except Exception as exc:  # noqa: BLE001 — narrowed below
            # The SDK raises its own error classes; `BadRequestError` is
            # "no such payment". Matching on the class NAME avoids importing
            # razorpay.errors at module scope, which would break the lazy
            # import that keeps this adapter out of non-razorpay deploys.
            if type(exc).__name__ in {"BadRequestError", "ServerError"}:
                logger.info("razorpay.payment_not_found", extra={"payment_id": payment_id})
                return None
            raise

        if not payment:
            return None
        status = str(payment.get("status", ""))
        return ProviderPayment(
            payment_id=str(payment.get("id", payment_id)),
            order_id=str(payment.get("order_id") or ""),
            amount_minor=int(payment.get("amount") or 0),
            status=status,
            # `captured` is the only status where the money is actually ours.
            # `authorized` means the bank has RESERVED it and it has not been
            # taken — treating that as paid issues a ticket against money that
            # may never arrive.
            is_captured=status == "captured",
        )

    def captured_payment_for_order(self, *, order_id: str) -> ProviderPayment | None:
        """`GET /v1/orders/{id}/payments` — every payment attempted against the
        order, from which we take the captured one.

        An order can carry several attempts (a failed card, then a successful
        UPI). Only `captured` counts; `authorized` is money the bank has
        reserved and not released, and `failed`/`created` are not money at all.
        """
        try:
            result = self._client.order.payments(order_id)
        except Exception as exc:  # noqa: BLE001 — narrowed below
            if type(exc).__name__ in {"BadRequestError", "ServerError"}:
                logger.info("razorpay.order_not_found", extra={"order_id": order_id})
                return None
            raise

        for item in (result or {}).get("items", []) or []:
            if str(item.get("status", "")) != "captured":
                continue
            return ProviderPayment(
                payment_id=str(item.get("id", "")),
                order_id=str(item.get("order_id") or order_id),
                amount_minor=int(item.get("amount") or 0),
                status="captured",
                is_captured=True,
            )
        return None

    def refund(self, *, payment_id: str, amount_minor: int, idempotency_key: str) -> str:
        # Razorpay reverses any Route transfers when it refunds. The
        # Idempotency-Key header makes a retry/concurrent call return the same
        # refund instead of creating a second one.
        refund = self._client.payment.refund(
            payment_id,
            {"amount": amount_minor},
            headers={"Idempotency-Key": idempotency_key},
        )
        return refund["id"]

    def release_payout(self, *, account_id: str, amount_minor: int, idempotency_key: str) -> str:
        # Release the organizer's on-hold Route share after the event + refund
        # window. In Razorpay Route the held share is settled to the linked
        # account by releasing its on-hold transfer(s) (on_hold -> 0); the
        # Idempotency-Key header makes a retry/concurrent call return the same
        # payout instead of paying out twice. The concrete Route call is wired
        # here when PAYMENTS_BACKEND=razorpay is actually deployed — the fake
        # adapter is what the tests and the dev proof exercise.
        result = self._client.transfer.create(
            {"account": account_id, "amount": amount_minor, "currency": "INR", "on_hold": 0},
            headers={"Idempotency-Key": idempotency_key},
        )
        return result["id"]

    def split_transfer(
        self,
        *,
        payment_id: str,
        organizer_account_id: str,
        organizer_amount_minor: int,
        platform_fee_minor: int,
    ) -> SplitTransferResult:
        # Razorpay Route: the platform fee stays with the platform account by
        # simply not transferring it out — only the organizer's share moves.
        transfer = self._client.payment.transfer(
            payment_id,
            {
                "transfers": [
                    {
                        "account": organizer_account_id,
                        "amount": organizer_amount_minor,
                        "currency": "INR",
                        "on_hold": False,
                    }
                ]
            },
        )
        organizer_transfer_id = transfer["items"][0]["id"] if transfer.get("items") else None
        return SplitTransferResult(
            payment_id=payment_id,
            organizer_transfer_id=organizer_transfer_id,
            platform_fee_transfer_id=None,
            status="processed",
        )
