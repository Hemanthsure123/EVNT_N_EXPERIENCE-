"""Reservation strategy (Strategy pattern) — encapsulates HOW a reserve/
release/confirm decision is made and enforced, so it's pluggable and unit-
testable in isolation from the service that orchestrates events/caches.

The one real strategy today is `RowLockReservationStrategy`: a pessimistic
per-tier row lock. It assumes it runs INSIDE a transaction (the service's
UnitOfWork provides one) — that's what makes `SELECT ... FOR UPDATE`
serialise concurrent reserves. The decision is ALWAYS taken from the freshly
locked row, never from any cache (the module's headline rule).

Each method keeps the locked section minimal: lock one row, check, write the
counters back, return. No I/O, no cross-table work, nothing slow happens
while the lock is held — contention during a ticket rush stays low.
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime

from django.utils import timezone

from .exceptions import (
    ExceedsMaxPerOrderError,
    SaleClosedError,
    SaleNotStartedError,
    SoldOutError,
    TicketTypeNotFoundError,
)
from .repositories import TicketTypeRepository


@dataclass(frozen=True)
class ReservationOutcome:
    ticket_type_id: uuid.UUID
    event_id: uuid.UUID
    quantity: int
    available_after: int
    became_sold_out: bool


class ReservationStrategy(ABC):
    @abstractmethod
    def reserve(
        self, *, ticket_type_id: uuid.UUID | str, quantity: int, now: datetime | None = None
    ) -> ReservationOutcome: ...

    @abstractmethod
    def release(self, *, ticket_type_id: uuid.UUID | str, quantity: int) -> ReservationOutcome: ...

    @abstractmethod
    def confirm_sold(
        self, *, ticket_type_id: uuid.UUID | str, quantity: int
    ) -> ReservationOutcome: ...


class RowLockReservationStrategy(ReservationStrategy):
    def __init__(self, *, ticket_types: TicketTypeRepository) -> None:
        self._ticket_types = ticket_types

    def _lock(self, ticket_type_id: uuid.UUID | str):
        tt = self._ticket_types.lock_for_update(ticket_type_id)
        if tt is None:
            raise TicketTypeNotFoundError(str(ticket_type_id))
        return tt

    def reserve(
        self, *, ticket_type_id: uuid.UUID | str, quantity: int, now: datetime | None = None
    ) -> ReservationOutcome:
        now = now or timezone.now()
        tt = self._lock(ticket_type_id)

        # Sale window — closed sales can't be reserved against.
        if tt.sale_start is not None and now < tt.sale_start:
            raise SaleNotStartedError()
        if tt.sale_end is not None and now > tt.sale_end:
            raise SaleClosedError()
        # Per-order cap.
        if quantity > tt.max_per_order:
            raise ExceedsMaxPerOrderError(tt.max_per_order)
        # Availability — decided from the LOCKED row, never a cache.
        available = tt.quantity - tt.sold - tt.reserved
        if quantity > available:
            raise SoldOutError(available)

        tt.reserved += quantity
        self._ticket_types.save_counts(tt)  # CHECK constraint backstops oversell

        available_after = tt.quantity - tt.sold - tt.reserved
        return ReservationOutcome(
            ticket_type_id=tt.id,
            event_id=tt.event_id,
            quantity=quantity,
            available_after=available_after,
            became_sold_out=available_after == 0,
        )

    def release(self, *, ticket_type_id: uuid.UUID | str, quantity: int) -> ReservationOutcome:
        tt = self._lock(ticket_type_id)

        # Clamp to what's actually reserved so a duplicate release (a retry, or
        # booking releasing an already-expired hold) is a safe no-op rather than
        # a CHECK violation. Exactly-once accounting is the caller's job.
        released = min(quantity, tt.reserved)
        tt.reserved -= released
        self._ticket_types.save_counts(tt)

        available_after = tt.quantity - tt.sold - tt.reserved
        return ReservationOutcome(
            ticket_type_id=tt.id,
            event_id=tt.event_id,
            quantity=released,
            available_after=available_after,
            became_sold_out=False,  # releasing only frees capacity
        )

    def confirm_sold(self, *, ticket_type_id: uuid.UUID | str, quantity: int) -> ReservationOutcome:
        tt = self._lock(ticket_type_id)

        # Move reserved -> sold. Clamp to reserved so a retried confirm can't
        # double-count sold (availability is unchanged by this move).
        moved = min(quantity, tt.reserved)
        tt.reserved -= moved
        tt.sold += moved
        self._ticket_types.save_counts(tt)

        available_after = tt.quantity - tt.sold - tt.reserved
        return ReservationOutcome(
            ticket_type_id=tt.id,
            event_id=tt.event_id,
            quantity=moved,
            available_after=available_after,
            became_sold_out=False,  # a confirm never lowers availability
        )
