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


class PaymentOrderRejected(Exception):
    """The provider REFUSED to create the order — a definite 4xx.

    Nothing was created at the provider, so retrying the same request will be
    refused the same way; something about the request has to change first.
    `had_transfers` is carried because the Route split is the one input to an
    order that varies by ORGANIZER rather than by booking, which makes it the
    first thing to suspect when one organizer's events fail and another's do
    not.
    """

    def __init__(self, reason: str, *, had_transfers: bool) -> None:
        super().__init__(reason)
        self.reason = reason
        self.had_transfers = had_transfers


class PaymentProviderUnavailable(Exception):
    """The provider could not be reached, or failed on its own side.

    Unlike a rejection this says nothing about the request — the same call may
    well succeed a moment later — and it does not even prove nothing was
    created, since a timeout can land after the provider committed.
    """

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class CreatedOrder:
    """What a provider hands back when an order is opened.

    ── WHY THIS IS NO LONGER JUST AN ORDER ID ────────────────────────────────

    `create_order` returned a bare `str`, which was exactly right while
    Razorpay was the only provider: Razorpay Checkout is opened with the ORDER
    id itself, so the id was both the platform's handle and the browser's.

    Cashfree splits those two things. The order id is still the handle every
    server-side path uses — `booking.payment_order_id`, the webhook's lookup,
    `captured_payment_for_order`, the reconciliation sweep — but the browser
    cannot open a checkout with it. It needs a `payment_session_id`, minted
    with the order and returned only by that one call.

    So the port returns both, and `checkout_token` is EMPTY for any provider
    whose checkout opens on the order id alone. This is the same "the first
    real consumer needs it" port evolution `EmailPort.send` went through when
    `notifications` needed a provider reference back — the alternative was a
    second round trip to re-fetch a token the create call already had, on the
    money path.

    `checkout_token` is NOT a secret. It is the public handle for one order,
    it expires, and it is useless without the order it belongs to — the same
    class of value as a Razorpay order id or a `key_id`. The signing secret
    never leaves the backend.
    """

    order_id: str
    checkout_token: str = ""


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
    #: The `PAYMENTS_BACKEND`/gateway name this adapter answers to — the value
    #: stored on `Booking.payment_gateway` and echoed to the browser. It is on
    #: the PORT rather than inferred from the class, because every path that
    #: resolves a second gateway later (the webhook, the refund, the
    #: reconciliation sweep) needs the booking's own answer and must never get
    #: it by guessing from settings, which describe the DEFAULT and not the
    #: gateway that actually took this particular payment.
    name: str = ""

    #: Whether `create_order(transfers=...)` is honoured.
    #:
    #: Razorpay Route attaches the organizer's on-hold share at order time.
    #: Cashfree's equivalent (Easy Split) is a separately-onboarded product
    #: this platform has not enabled, so a Cashfree adapter would DROP the
    #: transfers silently — and a silently-dropped split is money quietly not
    #: held for an organizer. Declaring it lets `booking` skip building one
    #: rather than build one that goes nowhere.
    supports_order_time_split: bool = True

    #: Whether `create_order` needs the buyer's contact details in `notes`.
    #:
    #: Razorpay does not (it collects them inside Checkout); Cashfree REFUSES
    #: an order without a customer id and phone. Declared rather than always
    #: supplied, because assembling them costs a lazy load of the related user
    #: on the platform's hottest write — an extra query on every booking, for a
    #: field one of three adapters reads.
    requires_customer_details: bool = False

    #: Whether this adapter can hold linked accounts and RELEASE PAYOUTS —
    #: i.e. whether it may be `PAYMENTS_ROUTE_PROVIDER`.
    #:
    #: Declared rather than discovered by CALLING `release_payout`, which is
    #: the obvious alternative and is wrong: on a real adapter that method is a
    #: live API request that creates a transfer. A capability probe must never
    #: be able to move money, and a boot-time check must never depend on a
    #: vendor being reachable.
    supports_payouts: bool = True

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
    ) -> CreatedOrder:
        """Create a payment order. `transfers`, if given, defines the split
        applied when the payment is captured (Razorpay Route).

        Returns the order id AND, where the provider needs one, the token its
        browser SDK opens a checkout with — see `CreatedOrder`. A provider that
        ignores `transfers` must say so via `supports_order_time_split`, so the
        caller never believes a split was attached that was silently dropped."""

    @abstractmethod
    def verify_webhook_signature(
        self, *, payload: bytes, signature: str, timestamp: str = ""
    ) -> bool:
        """Return True only if `signature` is a valid vendor signature for the
        RAW `payload` bytes. This is the ONLY proof a payment is real — the
        browser redirect is not. Never trust an unsigned/mis-signed webhook.

        `timestamp` is the vendor's own replay guard, sent in a header beside
        the signature and included in the signed material. Razorpay signs the
        body alone and ignores it; Cashfree signs `timestamp + body`, so
        omitting it there is not a laxer check but a check that always FAILS.
        Defaulted so every existing caller and adapter is unchanged."""

    @abstractmethod
    def fetch_payment(self, *, payment_id: str, order_id: str = "") -> ProviderPayment | None:
        """Ask the provider what it thinks of a payment. `None` if unknown.

        `order_id` is a HINT, never a claim, and it is required by some
        providers rather than optional: Razorpay addresses a payment globally
        (`GET /payments/{id}`) while Cashfree addresses it only within its order
        (`GET /orders/{order}/payments/{id}`). It changes nothing about trust —
        every figure still comes back from the provider, and a caller that
        supplies a mismatched pair gets `None` rather than somebody else's
        payment.

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
    def refund(
        self, *, payment_id: str, amount_minor: int, idempotency_key: str, order_id: str = ""
    ) -> str:
        """Refund a captured payment (reversing any Route transfers). Returns
        the vendor refund id. `idempotency_key` makes the call safe to retry
        and safe under concurrency — the vendor must never double-refund for
        the same key.

        `order_id` for the same reason `fetch_payment` takes one: Razorpay
        refunds a payment id, Cashfree refunds within an order
        (`POST /orders/{order}/refunds`) and takes the idempotency key as the
        merchant-supplied `refund_id` that makes the call unique."""

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
