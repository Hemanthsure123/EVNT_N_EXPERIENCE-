"""Read-side of settlements (CQRS-lite). Financial data is per-organizer and
sensitive → the views serve these `private, no-store` and never cache them as
authoritative. The list filters by owner (an organizer sees only their own);
the detail returns the row for the view to ownership-check."""

from __future__ import annotations

import uuid

from django.db.models import QuerySet

from .models import Settlement
from .repositories import SettlementRepository


def list_settlements(
    owner_id: uuid.UUID | str, *, settlements: SettlementRepository | None = None
) -> QuerySet[Settlement]:
    settlements = settlements or SettlementRepository()
    return settlements.list_for_owner(owner_id)


def get_settlement(
    event_id: uuid.UUID | str, *, settlements: SettlementRepository | None = None
) -> Settlement | None:
    """The event's settlement plus its event→org chain (for the ownership check
    and serialization), in one query. Returns None if there's no settlement."""
    settlements = settlements or SettlementRepository()
    return settlements.get_for_owner_check(event_id)
