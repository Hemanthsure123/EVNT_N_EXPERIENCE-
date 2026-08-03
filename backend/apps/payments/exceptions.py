from __future__ import annotations

from core.errors import ConflictError, DomainError, NotFoundError, PermissionDeniedError


class InvalidWebhookSignatureError(DomainError):
    """The webhook signature is missing or doesn't verify — reject with 400 and
    do nothing. An unsigned/forged webhook is never trusted."""

    code = "invalid_webhook_signature"
    status_code = 400

    def __init__(self) -> None:
        super().__init__("Webhook signature verification failed.")


class MalformedWebhookError(DomainError):
    """The webhook body wasn't parseable JSON."""

    code = "malformed_webhook"
    status_code = 400

    def __init__(self) -> None:
        super().__init__("Malformed webhook payload.")


class PaymentNotFoundError(NotFoundError):
    """No payment exists with this id."""

    code = "payment_not_found"

    def __init__(self, payment_id: str) -> None:
        super().__init__(f"Payment '{payment_id}' not found.")


class NotAllowedToViewPaymentError(PermissionDeniedError):
    """The requester is neither the booking's owner nor the event's organizer."""

    code = "not_allowed_to_view_payment"

    def __init__(self) -> None:
        super().__init__("You don't have access to this payment.")


class NotAllowedToRefundError(PermissionDeniedError):
    """Only the event's organizer (or an admin) may refund a payment."""

    code = "not_allowed_to_refund"

    def __init__(self) -> None:
        super().__init__("Only the organizer can refund this payment.")


class PaymentNotRefundableError(ConflictError):
    """Refund was requested on a payment that isn't in a refundable state."""

    code = "payment_not_refundable"

    def __init__(self, status: str) -> None:
        super().__init__(f"A payment in '{status}' state can't be refunded.")


class SimulatedPaymentUnavailableError(ConflictError):
    """A simulated payment was requested while a REAL payment provider is
    configured.

    This is the refusal that keeps the demo path from ever being a way to get a
    free ticket. It is decided by asking the configured port whether it is a
    `SimulatedPaymentPort` — the real Razorpay adapter is not, so with
    `PAYMENTS_BACKEND=razorpay` the answer is always no. (`core/preflight.py`
    separately refuses to boot production on a fake backend at all, so in
    production this endpoint can only ever refuse.)
    """

    code = "simulated_payment_unavailable"

    def __init__(self) -> None:
        super().__init__(
            "A real payment provider is configured, so payments cannot be simulated. "
            "Pay through the provider's checkout instead."
        )


class BookingNotPayableError(ConflictError):
    """The booking can't take a payment: its hold has lapsed, it was cancelled,
    or no payment order was ever created for it.

    Deliberately a refusal rather than a simulated capture that then refunds
    itself. Taking (fake) money for an expired hold only to hand it back is a
    real production flow worth having — but reaching it on purpose from a demo
    button is just a confusing way to fail.
    """

    code = "booking_not_payable"

    def __init__(self, status: str) -> None:
        super().__init__(f"A booking in '{status}' state can't take a payment.")
