"""Port for the payments vendor (Razorpay in production).

The shape follows the money-path rules in the project brief: create an order
(optionally carrying a Route split so the organizer's share is transferred to
their linked account and the platform fee is retained), verify a webhook
signature before trusting anything, refund when a ticket can't be delivered,
and split/settle. No adapter is imported here — only the abstract contract.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class OrderTransfer:
    """One Route transfer attached to an order: the organizer's share to their
    linked account. `on_hold=True` means Razorpay holds the money until
    `settlements` releases it after the event — the platform never holds the
    organizer's funds, and the organizer isn't paid before the event happens.
    The platform fee is retained simply by not transferring it out."""

    account_id: str
    amount_minor: int
    on_hold: bool


@dataclass(frozen=True)
class SplitTransferResult:
    payment_id: str
    organizer_transfer_id: str | None
    platform_fee_transfer_id: str | None
    status: str


class PaymentPort(ABC):
    @abstractmethod
    def create_linked_account(self, *, reference_id: str, name: str, email: str) -> str:
        """Create a linked/connected account (Razorpay Route linked account)
        that a future transfer can pay out to. Returns the vendor's linked-
        account id."""

    @abstractmethod
    def create_order(
        self,
        *,
        amount_minor: int,
        currency: str,
        receipt: str,
        notes: dict,
        transfers: list[OrderTransfer] | None = None,
    ) -> str:
        """Create a payment order and return its order id. `transfers`, if
        given, defines the Route split applied when the payment is captured."""

    @abstractmethod
    def verify_webhook_signature(self, *, payload: bytes, signature: str) -> bool:
        """Return True only if `signature` is a valid vendor signature for the
        RAW `payload` bytes. This is the ONLY proof a payment is real — the
        browser redirect is not. Never trust an unsigned/mis-signed webhook."""

    @abstractmethod
    def refund(self, *, payment_id: str, amount_minor: int, idempotency_key: str) -> str:
        """Refund a captured payment (reversing any Route transfers). Returns
        the vendor refund id. `idempotency_key` makes the call safe to retry
        and safe under concurrency — the vendor must never double-refund for
        the same key."""

    @abstractmethod
    def split_transfer(
        self,
        *,
        payment_id: str,
        organizer_account_id: str,
        organizer_amount_minor: int,
        platform_fee_minor: int,
    ) -> SplitTransferResult:
        """Split a captured payment after the fact (an alternative to order-time
        transfers). Kept for `settlements`; the primary split is defined at
        order time via `create_order(transfers=...)`."""

    @abstractmethod
    def release_payout(self, *, account_id: str, amount_minor: int, idempotency_key: str) -> str:
        """Release the organizer's ON-HOLD Route payout to their linked account
        after the event + refund window (`settlements` calls this). `payments`
        created the transfer `on_hold=True`; this settles `amount_minor` to
        `account_id`. Returns the vendor payout reference. `idempotency_key`
        makes it safe to retry and safe under concurrency — the vendor must
        never pay out twice for the same key."""
