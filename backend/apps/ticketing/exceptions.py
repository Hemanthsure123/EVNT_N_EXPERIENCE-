from __future__ import annotations

from core.errors import (
    ConflictError,
    InvalidInputError,
    NotFoundError,
    PermissionDeniedError,
)


class TicketTypeNotFoundError(NotFoundError):
    """No active ticket type exists with this id."""

    code = "ticket_type_not_found"

    def __init__(self, ticket_type_id: str) -> None:
        super().__init__(f"Ticket type '{ticket_type_id}' not found.")


class NotTicketTypeOwnerError(PermissionDeniedError):
    """The requesting user doesn't own the organization behind this event."""

    code = "not_ticket_type_owner"

    def __init__(self) -> None:
        super().__init__("Only the owning organization can manage this event's tickets.")


class StaleTicketTypeVersionError(ConflictError):
    """The tier was edited by someone else since this client last read it."""

    code = "stale_ticket_type_version"

    def __init__(self) -> None:
        super().__init__("This ticket type changed since you loaded it. Reload and try again.")


class PhasePriceAbovePriceError(InvalidInputError):
    """A sale phase's price was set above the tier's face price."""

    code = "phase_price_above_price"

    def __init__(self) -> None:
        super().__init__("A sale phase's price can't be higher than the normal ticket price.")


class InvalidPhaseScheduleError(InvalidInputError):
    """The submitted phase schedule breaks a structural rule (too many phases,
    a blank name, decreasing prices, or a phase with no bound at all)."""

    code = "invalid_phase_schedule"

    def __init__(self, message: str) -> None:
        super().__init__(message)


class QuantityBelowCommittedError(ConflictError):
    """A requested quantity reduction would drop below tickets already sold/held."""

    code = "quantity_below_committed"

    def __init__(self) -> None:
        super().__init__("Can't set quantity below the number of tickets already sold or reserved.")


# --- reservation-decision errors (raised by the reserve primitive) ---------


class InvalidReservationQuantityError(InvalidInputError):
    """A reserve/release/confirm was asked for a non-positive quantity."""

    code = "invalid_reservation_quantity"

    def __init__(self) -> None:
        super().__init__("Quantity must be a positive integer.")


class SaleNotStartedError(ConflictError):
    """The tier's sale window hasn't opened yet."""

    code = "sale_not_started"

    def __init__(self) -> None:
        super().__init__("Sales for this ticket type haven't started yet.")


class SaleClosedError(ConflictError):
    """The tier's sale window has closed."""

    code = "sale_closed"

    def __init__(self) -> None:
        super().__init__("Sales for this ticket type have closed.")


class SoldOutError(ConflictError):
    """Not enough tickets remain to satisfy the request."""

    code = "sold_out"

    def __init__(self, available: int) -> None:
        self.available = available
        super().__init__(
            f"Not enough tickets available (only {available} left).", available=available
        )


class ExceedsMaxPerOrderError(InvalidInputError):
    """The requested quantity exceeds the tier's per-order limit."""

    code = "exceeds_max_per_order"

    def __init__(self, max_per_order: int) -> None:
        self.max_per_order = max_per_order
        super().__init__(
            f"You can order at most {max_per_order} of this ticket type at a time.",
            max_per_order=max_per_order,
        )


class SlotNotFoundError(NotFoundError):
    """No such session on THIS event.

    Scoped by event on purpose: a slot id that exists but belongs to somebody
    else's show is the same answer as one that does not exist at all, and
    saying so would confirm the other event's session ids to anyone guessing.
    """

    code = "slot_not_found"

    def __init__(self, slot_id: str) -> None:
        super().__init__(f"Session '{slot_id}' not found on this event.")
