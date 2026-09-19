"""Real PaymentPort adapter backed by Cashfree Payments (PG API v3).

── WHY REST AND NOT THE VENDOR SDK ───────────────────────────────────────────

`requests` is a BASE dependency of this project, so this adapter needs no
optional extra, no `INSTALL_EXTRAS` entry and no preflight import check of the
kind `razorpay` needs. That is not a convenience — the razorpay extra exists in
the first place because a selected backend whose SDK was missing raised
`ModuleNotFoundError` on somebody's first checkout, lazily, with nothing failing
at boot or in CI. An adapter with no vendor package cannot have that failure.

It is still imported LAZILY from `config/di.py`, like every other real adapter.

── WHAT THIS ADAPTER DELIBERATELY REFUSES TO DO ──────────────────────────────

`create_linked_account`, `split_transfer` and `release_payout` RAISE. Cashfree's
marketplace-split product (Easy Split) is a separate onboarding with its own
vendor records, and `organizations.payout_account_id` holds a RAZORPAY Route
linked-account id — an identifier Cashfree has never heard of. An adapter that
answered those calls with a plausible-looking id would put the organizer's
payout into a state where nothing failed and no money moved, which is the exact
shape of the bug `core/preflight.py` exists to prevent.

They are never reached on the live path: `config/di.py` keeps `PAYMENTS_BACKEND`
— Razorpay — as the ROUTE/SETTLEMENT provider that `organizations` and
`settlements` are given, and resolves a per-booking gateway only for the
checkout, webhook, verify and refund paths. `supports_order_time_split = False`
is what tells `booking` not to build a transfer this adapter would silently
drop.

── MONEY IS RUPEES HERE AND PAISE EVERYWHERE ELSE ────────────────────────────

Cashfree takes and returns `order_amount` as a DECIMAL NUMBER OF RUPEES; this
codebase is integer paise from `TicketType.price_minor` to the webhook's amount
check. Every crossing goes through `_to_rupees` / `_to_minor`, which use
`Decimal` and never a float: 1999 paise -> 19.99, and back exactly. A float
round trip on the money path is how 19.99 becomes 19.989999999999998 and the
amount check then refuses a payment that was perfectly correct.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import uuid
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

import requests

from core.ports.payment_port import (
    CreatedOrder,
    OrderTransfer,
    PaymentOrderRejected,
    PaymentPort,
    PaymentProviderUnavailable,
    ProviderPayment,
    SplitTransferResult,
)

logger = logging.getLogger(__name__)

#: Cashfree pins behaviour to a dated API version rather than a path segment.
#: Pinned, never "latest": a provider silently changing a response shape under
#: a live checkout is not a risk worth taking to avoid one line of maintenance.
API_VERSION = "2023-08-01"

_BASE_URLS = {
    "sandbox": "https://sandbox.cashfree.com/pg",
    "production": "https://api.cashfree.com/pg",
}

#: Cashfree statuses that mean money is in hand. Everything else — PENDING,
#: USER_DROPPED, FAILED, CANCELLED, NOT_ATTEMPTED — is not.
#:
#: `PENDING` is the one worth naming: it covers a bank debit that has left the
#: customer's account and not yet settled to the merchant. It is the analogue of
#: Razorpay's `authorized`, and issuing a ticket for it would issue one against
#: money that may still never arrive. The reconciliation sweep asks again.
_CAPTURED_STATUSES = frozenset({"SUCCESS"})

#: Cashfree rejects a `refund_id` longer than this, and rejects ":" in one.
_MAX_REFUND_ID = 40

#: Required by Cashfree on every order. `User.phone` is nullable in this
#: codebase (SMS is opt-in), and Cashfree refuses an order without a phone — so
#: a customer with no stored number could not check out at all. The customer
#: enters their real contact details inside Cashfree's own checkout; this is a
#: placeholder for a required field, not a claim about anybody.
#: `RazorpayPaymentAdapter.create_linked_account` already does the same thing
#: for the same reason.
_PLACEHOLDER_PHONE = "9999999999"


class CashfreePaymentAdapter(PaymentPort):
    name = "cashfree"
    #: See the module docstring. Easy Split is not onboarded, so an order-time
    #: transfer would be accepted by this method and dropped on the floor.
    supports_order_time_split = False
    #: Cashfree refuses an order with no `customer_details.customer_phone`.
    requires_customer_details = True
    #: Easy Split is not onboarded, so this adapter cannot be the
    #: `PAYMENTS_ROUTE_PROVIDER` — `release_payout` raises. Production
    #: preflight refuses that combination at boot rather than letting the first
    #: settlement dead-letter weeks after an event.
    supports_payouts = False

    def __init__(
        self,
        *,
        app_id: str,
        secret_key: str,
        environment: str = "sandbox",
        timeout_seconds: float = 20.0,
    ) -> None:
        self._app_id = app_id
        self._secret_key = secret_key
        self._environment = "production" if environment == "production" else "sandbox"
        self._base_url = _BASE_URLS[self._environment]
        self._timeout = timeout_seconds

    # --- plumbing ---------------------------------------------------------

    def _headers(self) -> dict[str, str]:
        return {
            "x-client-id": self._app_id,
            "x-client-secret": self._secret_key,
            "x-api-version": API_VERSION,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _request(self, method: str, path: str, *, json: dict | None = None) -> tuple[int, object]:
        """One HTTP call, returning `(status_code, parsed_body)`.

        Transport failures become `PaymentProviderUnavailable` here so no caller
        ever sees a `requests` exception — the port's two failure types are the
        whole vocabulary above this line, and a raw `ConnectionError` reaching
        DRF is answered as a 500 with "An unexpected error occurred", which is
        the failure `RazorpayPaymentAdapter.create_order` was fixed for.
        """
        url = f"{self._base_url}{path}"
        try:
            response = requests.request(
                method, url, headers=self._headers(), json=json, timeout=self._timeout
            )
        except requests.RequestException as exc:
            raise PaymentProviderUnavailable(f"cashfree unreachable: {exc}") from exc
        try:
            body = response.json()
        except ValueError:
            body = {"raw": response.text[:500]}
        return response.status_code, body

    @staticmethod
    def _reason(body: object) -> str:
        if isinstance(body, dict):
            message = body.get("message") or body.get("error") or ""
            code = body.get("code") or ""
            return f"{code}: {message}".strip(": ") or str(body)[:300]
        return str(body)[:300]

    @staticmethod
    def _to_rupees(amount_minor: int) -> float:
        """Paise -> the decimal rupees Cashfree wants, exactly.

        `Decimal` throughout, and `float()` only at the very last step because
        `json` cannot serialise a `Decimal`. An integer number of paise always
        has an exact two-decimal representation, so this conversion is lossless
        — what is being avoided is `amount_minor / 100` in float arithmetic,
        which is not.
        """
        return float((Decimal(int(amount_minor)) / Decimal(100)).quantize(Decimal("0.01")))

    @staticmethod
    def _to_minor(amount: object) -> int:
        """Cashfree's decimal rupees -> paise, via `str` so a float that arrived
        as 19.989999999999998 still lands on 1999 rather than 1998."""
        try:
            return int((Decimal(str(amount)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        except (InvalidOperation, TypeError, ValueError):
            return 0

    # --- orders -----------------------------------------------------------

    def create_order(
        self,
        *,
        amount_minor: int,
        currency: str,
        receipt: str,
        notes: dict,
        transfers: list[OrderTransfer] | None = None,
    ) -> CreatedOrder:
        """`POST /pg/orders` — returns the order id AND the `payment_session_id`
        the browser SDK opens a checkout with.

        ── THE ORDER ID CARRIES A SUFFIX, AND IT HAS TO ──────────────────────

        Cashfree requires `order_id` to be unique per merchant FOREVER. The
        obvious id — the booking's uuid — is reused: `_ensure_payment_order`
        clears `payment_order_id` and creates a NEW order on the same booking
        every time a donation or a coupon changes the total. The second such
        call would be refused as a duplicate, and the customer would be told
        their payment could not be prepared because they had pressed a donation
        chip.

        So the booking id is a PREFIX and a short random suffix makes each
        attempt distinct. The booking is still readable in Cashfree's own
        dashboard, which is the whole reason for supplying an id rather than
        letting Cashfree mint an opaque one.
        """
        if transfers:
            # Never silently. Reaching here means `supports_order_time_split`
            # was ignored upstream; the order is still created (refusing would
            # block a sale over a payout arrangement) but the organizer's share
            # is now a settlement concern and somebody has to know.
            logger.warning(
                "cashfree.transfers_ignored",
                extra={"receipt": receipt, "transfer_count": len(transfers)},
            )

        order_id = f"{receipt}_{uuid.uuid4().hex[:8]}"
        raw_customer = notes.get("customer")
        customer = raw_customer if isinstance(raw_customer, dict) else {}
        order_meta: dict = {}
        return_url = str(notes.get("return_url") or "")
        if return_url:
            # `notify_url` is deliberately NOT set here: it is configured in the
            # Cashfree dashboard, a per-order override is ignored on most
            # accounts, and setting it in code would read as though webhooks
            # were wired when they are not.
            order_meta["return_url"] = return_url

        payload: dict = {
            "order_id": order_id,
            "order_amount": self._to_rupees(amount_minor),
            "order_currency": currency,
            "customer_details": {
                # The user's uuid, never their email — a customer id travels in
                # Cashfree's dashboard and logs, and this one identifies without
                # disclosing. Same reasoning as the QR token's ids-only payload.
                "customer_id": str(customer.get("id") or receipt),
                "customer_phone": str(customer.get("phone") or _PLACEHOLDER_PHONE),
                "customer_email": str(customer.get("email") or ""),
                "customer_name": str(customer.get("name") or ""),
            },
            "order_meta": order_meta,
            "order_note": f"booking:{notes.get('booking_id', receipt)}",
            "order_tags": {"booking_id": str(notes.get("booking_id") or receipt)},
        }

        status_code, body = self._request("POST", "/orders", json=payload)

        if status_code >= 400:
            reason = self._reason(body)
            logger.error(
                "cashfree.order_create_failed",
                extra={
                    "receipt": receipt,
                    "status_code": status_code,
                    "reason": reason,
                    "had_transfers": bool(transfers),
                },
            )
            # Split exactly where `RazorpayPaymentAdapter` splits, on the one
            # distinction a caller can act on: a 4xx is a definite refusal of
            # THIS request, anything else is an outcome nobody knows.
            if status_code < 500:
                raise PaymentOrderRejected(reason, had_transfers=bool(transfers))
            raise PaymentProviderUnavailable(reason)

        data = body if isinstance(body, dict) else {}
        session_id = str(data.get("payment_session_id") or "")
        if not session_id:
            # A 200 with no session token is an order no browser can pay for.
            # Treated as a provider fault rather than silently returning an
            # order that looks fine and then fails to open a checkout.
            raise PaymentProviderUnavailable("cashfree returned no payment_session_id")
        return CreatedOrder(
            order_id=str(data.get("order_id") or order_id), checkout_token=session_id
        )

    # --- webhooks ---------------------------------------------------------

    def verify_webhook_signature(
        self, *, payload: bytes, signature: str, timestamp: str = ""
    ) -> bool:
        """Cashfree signs `base64(HMAC-SHA256(timestamp + rawBody, secret_key))`.

        Three differences from Razorpay, each of which silently fails the check
        if it is got wrong: the timestamp is part of the signed material, the
        digest is BASE64 and not hex, and the key is the API SECRET KEY rather
        than a separate webhook secret.

        Verified over the RAW bytes, never the re-serialised parsed body — the
        same rule this module has always had, and the reason `request.body` is
        read before DRF touches it.
        """
        if not signature or not timestamp:
            # No timestamp means the signed material cannot be reconstructed.
            # Refusing is the only safe answer: there is no lenient mode for the
            # one check that decides whether money is real.
            return False
        signed = timestamp.encode() + payload
        expected = base64.b64encode(
            hmac.new(self._secret_key.encode(), signed, hashlib.sha256).digest()
        ).decode()
        return hmac.compare_digest(expected, signature)

    # --- payments ---------------------------------------------------------

    def _to_provider_payment(self, item: dict, *, order_id: str) -> ProviderPayment:
        status = str(item.get("payment_status") or "")
        return ProviderPayment(
            payment_id=str(item.get("cf_payment_id") or ""),
            order_id=str(item.get("order_id") or order_id),
            amount_minor=self._to_minor(item.get("payment_amount")),
            status=status,
            is_captured=status in _CAPTURED_STATUSES,
        )

    def fetch_payment(self, *, payment_id: str, order_id: str = "") -> ProviderPayment | None:
        """`GET /pg/orders/{order}/payments/{cf_payment_id}`.

        ── WHY `order_id` IS NOT OPTIONAL IN PRACTICE ────────────────────────

        Razorpay addresses a payment globally; Cashfree addresses it only within
        its order. With no order id there is no request to make, so this returns
        `None` and says so in the log rather than guessing.

        That is not a gap in the trust model: the only caller that arrives with
        a bare payment id is `verify_and_confirm`, and the Cashfree path reaches
        it through `captured_payment_for_order`, which needs exactly the handle
        this system already stores on the booking row.
        """
        if not order_id:
            logger.info("cashfree.fetch_payment_needs_order", extra={"payment_id": payment_id})
            return None
        status_code, body = self._request("GET", f"/orders/{order_id}/payments/{payment_id}")
        if status_code == 404:
            logger.info(
                "cashfree.payment_not_found",
                extra={"payment_id": payment_id, "order_id": order_id},
            )
            return None
        if status_code >= 400:
            raise PaymentProviderUnavailable(self._reason(body))
        if not isinstance(body, dict):
            return None
        return self._to_provider_payment(body, order_id=order_id)

    def captured_payment_for_order(self, *, order_id: str) -> ProviderPayment | None:
        """`GET /pg/orders/{order}/payments` — every attempt against the order,
        from which we take the successful one.

        An order can carry several attempts (a dropped UPI, then a card). Only
        `SUCCESS` counts; `PENDING` is money that has left the customer and not
        arrived, and `USER_DROPPED` / `FAILED` are not money at all.
        """
        status_code, body = self._request("GET", f"/orders/{order_id}/payments")
        if status_code == 404:
            logger.info("cashfree.order_not_found", extra={"order_id": order_id})
            return None
        if status_code >= 400:
            raise PaymentProviderUnavailable(self._reason(body))
        items = body if isinstance(body, list) else []
        for item in items:
            if not isinstance(item, dict):
                continue
            if str(item.get("payment_status") or "") not in _CAPTURED_STATUSES:
                continue
            return self._to_provider_payment(item, order_id=order_id)
        return None

    # --- refunds ----------------------------------------------------------

    @staticmethod
    def _refund_id(idempotency_key: str) -> str:
        """Cashfree's merchant-supplied `refund_id` IS the idempotency key — a
        repeat with the same one returns the original refund instead of issuing
        a second. It permits only alphanumerics, "-" and "_", up to 40 chars,
        and this codebase's keys look like `refund:{uuid}` and
        `settlement:{uuid}`.

        Sanitised, and HASHED rather than truncated when it will not fit.
        Truncating is what would break this: two keys sharing a 40-character
        prefix would collide into ONE refund id, and the second refund — a
        different customer's — would silently return the first one's result and
        never be paid. A digest of the whole key is deterministic (so retries
        still dedupe) and collision-free in practice.
        """
        safe = "".join(c if (c.isalnum() or c in "-_") else "_" for c in idempotency_key)
        if len(safe) <= _MAX_REFUND_ID:
            return safe
        digest = hashlib.sha256(idempotency_key.encode()).hexdigest()[:32]
        return f"rf_{digest}"

    def refund(
        self, *, payment_id: str, amount_minor: int, idempotency_key: str, order_id: str = ""
    ) -> str:
        """`POST /pg/orders/{order}/refunds`.

        Cashfree refunds an ORDER, not a payment id, which is why the port
        gained `order_id`. Without it there is no call to make, and raising is
        the only honest answer — returning a fabricated refund id would record a
        refund in this system's ledger for money that was never returned, which
        is the single worst lie a payments module can tell.
        """
        if not order_id:
            raise PaymentProviderUnavailable(
                "cashfree refunds are order-scoped and no order id was supplied"
            )
        payload = {
            "refund_amount": self._to_rupees(amount_minor),
            "refund_id": self._refund_id(idempotency_key),
            "refund_note": "Automatic refund",
        }
        status_code, body = self._request("POST", f"/orders/{order_id}/refunds", json=payload)
        data = body if isinstance(body, dict) else {}

        if status_code >= 400:
            # A duplicate `refund_id` is Cashfree's idempotency ANSWERING, not a
            # failure: the refund already exists and this call must return its
            # id, exactly as Razorpay's Idempotency-Key header does. Treating it
            # as an error would make `execute_refund` retry and dead-letter a
            # refund that had already been paid.
            existing = str(data.get("refund_id") or "")
            if status_code == 409 and existing:
                logger.info(
                    "cashfree.refund_already_exists",
                    extra={"order_id": order_id, "refund_id": existing},
                )
                return existing
            raise PaymentProviderUnavailable(self._reason(body))

        return str(data.get("cf_refund_id") or data.get("refund_id") or payload["refund_id"])

    # --- the three Route-shaped calls this adapter refuses -----------------
    #
    # See the module docstring. Never reached: `config/di.py` gives
    # `organizations` and `settlements` the ROUTE provider, not the gateway a
    # particular booking happened to be paid through.

    def create_linked_account(self, *, reference_id: str, name: str, email: str) -> str:
        raise NotImplementedError(
            "Cashfree Easy Split is not onboarded; organizer payout accounts are "
            "Razorpay Route linked accounts. See core/adapters/cashfree/adapter.py."
        )

    def split_transfer(
        self,
        *,
        payment_id: str,
        organizer_account_id: str,
        organizer_amount_minor: int,
        platform_fee_minor: int,
    ) -> SplitTransferResult:
        raise NotImplementedError(
            "Cashfree Easy Split is not onboarded; splits are defined on Razorpay Route."
        )

    def release_payout(self, *, account_id: str, amount_minor: int, idempotency_key: str) -> str:
        raise NotImplementedError(
            "Cashfree Easy Split is not onboarded; payouts are released on Razorpay Route."
        )
