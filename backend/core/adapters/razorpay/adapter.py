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

from core.ports.payment_port import OrderTransfer, PaymentPort, SplitTransferResult

logger = logging.getLogger(__name__)


class RazorpayPaymentAdapter(PaymentPort):
    def __init__(self, *, key_id: str, key_secret: str, webhook_secret: str) -> None:
        self._client = razorpay.Client(auth=(key_id, key_secret))
        self._webhook_secret = webhook_secret

    def create_linked_account(self, *, reference_id: str, name: str, email: str) -> str:
        account = self._client.account.create(
            {
                "email": email,
                "phone": "",
                "type": "route",
                "reference_id": reference_id,
                "legal_business_name": name,
                "business_type": "individual",
                "contact_name": name,
            }
        )
        return account["id"]

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
