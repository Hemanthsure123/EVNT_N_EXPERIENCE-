"""In-memory PaymentPort adapter. Deterministic, no network calls — used
whenever PAYMENTS_BACKEND=fake (the default for dev/test)."""

from __future__ import annotations

import itertools
import logging

from core.ports.payment_port import PaymentPort, SplitTransferResult

logger = logging.getLogger(__name__)


class FakePaymentAdapter(PaymentPort):
    def __init__(self) -> None:
        self._order_ids = itertools.count(1)
        self._transfer_ids = itertools.count(1)
        self._linked_account_ids = itertools.count(1)
        self.orders: dict[str, dict] = {}
        self.linked_accounts: dict[str, dict] = {}

    def create_linked_account(self, *, reference_id: str, name: str, email: str) -> str:
        account_id = f"fake_linked_account_{next(self._linked_account_ids)}"
        self.linked_accounts[account_id] = {
            "reference_id": reference_id,
            "name": name,
            "email": email,
        }
        logger.info("fake_payment.linked_account_created", extra={"account_id": account_id})
        return account_id

    def create_order(self, *, amount_minor: int, currency: str, receipt: str, notes: dict) -> str:
        order_id = f"fake_order_{next(self._order_ids)}"
        self.orders[order_id] = {
            "amount_minor": amount_minor,
            "currency": currency,
            "receipt": receipt,
            "notes": notes,
        }
        logger.info("fake_payment.order_created", extra={"order_id": order_id})
        return order_id

    def verify_webhook_signature(self, *, payload: bytes, signature: str) -> bool:
        # The fake adapter trusts any signature that starts with "fake-sig:" —
        # tests use this to exercise both the success and failure paths.
        return signature.startswith("fake-sig:")

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
