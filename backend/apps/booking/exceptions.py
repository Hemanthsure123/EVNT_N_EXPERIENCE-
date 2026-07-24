from __future__ import annotations

from core.errors import ConflictError, InvalidInputError, NotFoundError, PermissionDeniedError


class BookingNotFoundError(NotFoundError):
    """No booking exists with this id."""

    code = "booking_not_found"

    def __init__(self, booking_id: str) -> None:
        super().__init__(f"Booking '{booking_id}' not found.")


class NotBookingOwnerError(PermissionDeniedError):
    """The requesting user doesn't own this booking."""

    code = "not_booking_owner"

    def __init__(self) -> None:
        super().__init__("This booking belongs to another user.")


class InvalidBookingItemsError(InvalidInputError):
    """The requested items are empty, malformed, or reference tiers that don't
    belong to the event."""

    code = "invalid_booking_items"

    def __init__(self, message: str = "Invalid booking items.") -> None:
        super().__init__(message)


class EventNotBookableError(ConflictError):
    """The event isn't live / open for booking."""

    code = "event_not_bookable"

    def __init__(self) -> None:
        super().__init__("This event isn't open for booking.")


class BookingNotCancellableError(ConflictError):
    """Cancel was requested on a booking that isn't in the reserved state."""

    code = "booking_not_cancellable"

    def __init__(self, status: str) -> None:
        super().__init__(f"A booking in '{status}' state can't be cancelled.")
