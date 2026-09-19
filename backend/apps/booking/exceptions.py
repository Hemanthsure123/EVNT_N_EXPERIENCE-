from __future__ import annotations

from core.errors import (
    ConflictError,
    DomainError,
    InvalidInputError,
    NotFoundError,
    PermissionDeniedError,
)


class PaymentOrderFailedError(DomainError):
    """We could not start the payment. Nothing was held and nothing was charged."""

    # 502, and deliberately not 500. This is not our code crashing — it is an
    # upstream the booking depends on declining to start a payment — and a
    # distinct status and code is what lets the checkout say something true
    # instead of "an unexpected error occurred".
    code = "payment_order_failed"
    status_code = 502


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


class BookingNotAssignableError(ConflictError):
    """Attendees were named on a booking that isn't paid.

    The tickets don't exist until the booking is paid, so there is nothing to
    address and nothing to send — a reserved hold could still expire, and an
    email promising a ticket that was never issued is worse than no email.
    """

    code = "booking_not_assignable"

    def __init__(self, status: str) -> None:
        super().__init__(f"Attendees can only be named on a paid booking, not a '{status}' one.")


class InvalidAttendeeAssignmentsError(DomainError):
    """The attendee list is malformed, over-long, or names a ticket that isn't
    part of this booking. 400 rather than 422: this is a bad request shape, and
    every one of these is a client bug rather than a rejected-but-well-formed
    intent."""

    code = "invalid_attendee_assignments"
    status_code = 400

    def __init__(self, message: str = "Invalid attendee assignments.") -> None:
        super().__init__(message)


class BookingNotModifiableError(DomainError):
    """The donation can only move while the hold is live.

    Its own error rather than reusing `BookingNotCancellableError`, which is
    what `set_donation` raised first. That produced, on a checkout screen where
    somebody had just pressed a ₹15 chip, the sentence "A booking in 'expired'
    state can't be cancelled." — a message about an operation they had not
    attempted, for a reason they could not connect to what they did. An error
    that describes the wrong action is worse than a generic one: it sends the
    reader looking for a cancel button they never pressed.
    """

    code = "booking_not_modifiable"

    def __init__(self, status: str) -> None:
        if status == "paid":
            super().__init__("This booking is already paid, so its total can no longer change.")
        else:
            super().__init__(
                "Your hold has expired and these tickets were released, "
                "so nothing can be added to this booking."
            )


class HoldNotLiveError(DomainError):
    """The checkout was reopened over a hold that is no longer payable.

    ── THE ZOMBIE CHECKOUT ────────────────────────────────────────────────

    A customer cancels at the review screen (the back arrow releases the seats
    via `ticketing.release`), leaves, and then presses the browser's BACK
    button. The checkout remounts. Nothing in the page knew the hold was dead,
    so it reserved again — silently taking inventory back off sale for somebody
    who had just deliberately given it up, and starting a fresh countdown over
    a session they had ended.

    The same shape reaches here three other ways: a hold that simply lapsed, a
    booking already paid for and reopened from history, and a `?booking=` id
    pasted or restored by the browser. In every one of them the right answer is
    the same — do not treat this as a live checkout — and only the SERVER can
    say so, because the sweeper releases holds on a schedule the browser cannot
    see.

    `409` rather than `404`: the booking exists and the caller may well own it.
    What has gone is the CONDITION, and a 404 would send the client looking for
    a missing row instead of a finished one. `status` travels in `details` so
    the client can route rather than guess — a paid booking belongs on the
    confirmation screen, everything else back at the event.
    """

    code = "hold_not_live"
    status_code = 409

    def __init__(self, status: str) -> None:
        # `**details` kwargs, not a dict — `DomainError` spreads them into the
        # error envelope's `details` object itself.
        super().__init__(
            "This checkout is no longer active. Nothing has been charged.",
            status=status,
        )
        self.status = status
