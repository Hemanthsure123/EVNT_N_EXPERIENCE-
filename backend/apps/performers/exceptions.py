from __future__ import annotations

from core.errors import ConflictError, InvalidInputError, NotFoundError, PermissionDeniedError


class PerformerNotFoundError(NotFoundError):
    code = "performer_not_found"

    def __init__(self, performer_id: str) -> None:
        super().__init__(f"No performer with id '{performer_id}'.")


class NotPerformerOwnerError(PermissionDeniedError):
    code = "not_performer_owner"

    def __init__(self) -> None:
        super().__init__("You do not own this performer profile.")


class StalePerformerVersionError(ConflictError):
    code = "stale_performer_version"

    def __init__(self) -> None:
        super().__init__("This profile changed since you loaded it. Reload and reapply your edits.")


class InvalidPerformerStateError(ConflictError):
    code = "invalid_performer_state"


class PerformerNotUnderReviewError(ConflictError):
    code = "performer_not_under_review"

    def __init__(self) -> None:
        super().__init__("That performer is not awaiting a decision.")


class RequestNotFoundError(NotFoundError):
    code = "booking_request_not_found"

    def __init__(self, request_id: str) -> None:
        super().__init__(f"No booking request with id '{request_id}'.")


class RequestClosedError(ConflictError):
    code = "booking_request_closed"

    def __init__(self) -> None:
        super().__init__("That request is no longer taking quotes.")


class QuoteNotFoundError(NotFoundError):
    code = "quote_not_found"

    def __init__(self, quote_id: str) -> None:
        super().__init__(f"No quote with id '{quote_id}'.")


class DuplicateQuoteError(ConflictError):
    code = "duplicate_quote"

    def __init__(self) -> None:
        super().__init__(
            "You have already quoted on this request. Edit your existing quote instead."
        )


class PerformerNotBookableError(InvalidInputError):
    """A performer that is not live cannot quote — the same rule that keeps a
    draft invisible keeps it from selling."""

    code = "performer_not_bookable"

    def __init__(self) -> None:
        super().__init__("Only a published performer profile can send quotes.")


class EnquiryNotFoundError(NotFoundError):
    """No enquiry with that id."""

    code = "enquiry_not_found"

    def __init__(self, request_id: str) -> None:
        super().__init__(f"Enquiry '{request_id}' not found.")


class EnquiryWithdrawnError(ConflictError):
    """The customer took it back before an operator closed it.

    A `409` rather than a silent success, so a double-click cannot write a
    second audit row claiming a second decision — and so an operator who was
    about to record a booking learns that the request is gone.
    """

    code = "enquiry_withdrawn"

    def __init__(self) -> None:
        super().__init__("The customer withdrew this enquiry. It can no longer be moved.")
