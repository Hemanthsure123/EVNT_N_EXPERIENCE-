"""Port for the payments vendor (Razorpay in production).

The shape here follows the money-path rules in the project brief: create an
order, verify a webhook signature before trusting it, then split a captured
payment between the organizer's linked account and the platform fee via
Razorpay Route. No adapter is imported here — only the abstract contract.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


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
        that a future split_transfer can pay out to. Returns the vendor's
        linked-account id."""

    @abstractmethod
    def create_order(self, *, amount_minor: int, currency: str, receipt: str, notes: dict) -> str:
        """Create a payment order with the vendor and return its order id."""

    @abstractmethod
    def verify_webhook_signature(self, *, payload: bytes, signature: str) -> bool:
        """Return True only if `signature` is a valid vendor signature for `payload`."""

    @abstractmethod
    def split_transfer(
        self,
        *,
        payment_id: str,
        organizer_account_id: str,
        organizer_amount_minor: int,
        platform_fee_minor: int,
    ) -> SplitTransferResult:
        """Split a captured payment: organizer share to their linked account, the
        remainder to the platform fee account. The platform must never hold the
        organizer's funds beyond this split."""
