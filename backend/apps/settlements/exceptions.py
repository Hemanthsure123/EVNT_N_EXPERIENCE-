from __future__ import annotations

from core.errors import ConflictError, NotFoundError, PermissionDeniedError


class SettlementNotFoundError(NotFoundError):
    """No settlement exists for this event (no paid bookings yet)."""

    code = "settlement_not_found"

    def __init__(self, event_id: str) -> None:
        super().__init__(f"No settlement for event '{event_id}'.")


class NotSettlementOwnerError(PermissionDeniedError):
    """The requester is not the organizer who owns this event's settlement."""

    code = "not_settlement_owner"

    def __init__(self) -> None:
        super().__init__("You don't have access to this settlement.")


class EventNotFinishedError(ConflictError):
    """A payout can be released ONLY after the event has ended and its refund
    window has closed — this one hasn't yet."""

    code = "event_not_finished"

    def __init__(self, event_id: str) -> None:
        super().__init__(
            f"Event '{event_id}' has not finished (or its refund window is still open)."
        )
