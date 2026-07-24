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
