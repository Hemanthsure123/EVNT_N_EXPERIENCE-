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


@dataclass(frozen=True)
class ProviderPayment:
    """A payment as the PROVIDER describes it, fetched server-to-server.

    The same facts the webhook carries, obtained by asking instead of being
    told. `status` is the vendor's own value; `is_captured` is the only
    interpretation of it a caller should need.
    """

    payment_id: str
    order_id: str
    amount_minor: int
    status: str
    is_captured: bool


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
    def fetch_payment(self, *, payment_id: str) -> ProviderPayment | None:
        """Ask the provider what it thinks of a payment. `None` if unknown.

        ── WHY THIS EXISTS ALONGSIDE THE WEBHOOK ─────────────────────────────

        The webhook is the provider PUSHING a signed fact at us; this is us
        PULLING the same fact over an authenticated outbound call. Both are
        server-to-server statements by the provider, so both are equally
        trustworthy — and that is the whole point. What is NOT trustworthy is
        the browser's success callback, and neither of these is that.

        It exists because a push needs a publicly reachable HTTPS endpoint and
        a pull does not. On a laptop, in CI, or on any deployment that has not
        yet been given a domain, the webhook can never arrive; the payment
        still happened, and the customer is still owed a ticket. Being unable
        to receive a callback is an infrastructure gap, and a customer paying
        and getting nothing is a money-path failure — the two must not be the
        same bug.

        The browser supplies only an ID with this. An attacker who invents one
        gets `None`; one who supplies somebody else's real id gets a payment
        whose order does not match any booking of theirs. The ID is a lookup
        key, never a claim.
        """

    @abstractmethod
    def captured_payment_for_order(self, *, order_id: str) -> ProviderPayment | None:
        """The captured payment against `order_id`, or None if there is none.

        ── WHY THIS EXISTS SEPARATELY FROM `fetch_payment` ───────────────────

        `fetch_payment` needs a PAYMENT id, and a payment id is something only
        the customer's browser ever saw. `payment_order_id` is what this system
        stores on the booking row, so it is the only handle a BACKGROUND job
        has. Without this method, reconciliation is impossible: there is no way
        to ask "did anyone pay for this booking?" from the server alone.

        That gap was a live money-path hole. Fulfilment of a captured payment
        depended entirely on one best-effort browser call to `/payments/verify`
        — so a closed tab, a dropped network or an expired token after a long
        checkout meant the money was captured at the provider and the customer
        got NO TICKET AND NO REFUND, because the auto-refund branch also only
        runs once a webhook or a verify call arrives.

        Returns only a CAPTURED payment. An `authorized`-but-uncaptured one is
        money the bank has reserved and not handed over; issuing a ticket for
        it would be issuing against money that may never arrive.
        """

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


class SimulatedPaymentPort(ABC):
    """The one capability a FAKE provider has and a real one must never have:
    being told that money arrived.

    ── WHY IT IS A SEPARATE PORT, NOT A METHOD ON `PaymentPort` ──────────────

    A real provider learns a payment happened from the customer's bank. Nothing
    in this codebase may ever be able to say "consider this paid" to Razorpay,
    so `capture` is deliberately NOT on `PaymentPort`: `RazorpayPaymentAdapter`
    does not implement this interface and therefore has no such method to call,
    reach for, or accidentally be handed. There is no flag, no setting and no
    `NotImplementedError` stub involved — the capability is absent from the type.

    `payments` gates its demo endpoint on `isinstance(port, SimulatedPaymentPort)`,
    which is an ABSTRACTION check, not a concrete-adapter check, so the service
    layer still never imports an adapter. When `PAYMENTS_BACKEND=razorpay` the
    check is False and the endpoint refuses; `core/preflight.py` already refuses
    to boot production on a fake backend at all, so in production the answer is
    permanently "no".

    ── WHAT IT DOES NOT DO ───────────────────────────────────────────────────

    It records a capture at the fake provider and returns the id the provider
    would have issued. It does NOT confirm a booking, issue a ticket, or touch
    the database. Everything above it — the ledger, the amount check, the
    confirm — runs the SAME code it runs for a real Razorpay payment, and reads
    every figure back out of `fetch_payment`. A fake provider that fulfilled its
    own payments would be a demo of code the production path does not use.
    """

    @abstractmethod
    def capture(self, *, order_id: str, amount_minor: int | None = None) -> str:
        """Record that `order_id` was paid, and return the provider's payment id.

        `amount_minor` is what the provider should report as captured. It is
        passed explicitly rather than looked up because the caller (a service
        holding the booking row) knows it authoritatively, and an in-memory fake
        that created the order in a different worker process would not. `None`
        falls back to the amount the order was created with.

        The returned id is DETERMINISTIC per order: a provider issues one
        payment per successfully captured order, and a fake that minted a fresh
        id on every call would let a double-click write two ledger rows and two
        `Payment` records for one order.
        """
