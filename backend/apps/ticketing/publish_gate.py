"""The events publish-readiness check this module contributes: an event
can't go live with no way to buy into it.

This lives in `ticketing` (not `events`) precisely because dependencies
point one way — ticketing knows about events, never the reverse. It's
registered with events' extensible check hook from AppConfig.ready(), so
`events` needs no edit to gain the rule.
"""

from __future__ import annotations

from apps.events.exceptions import EventNotPublishableError
from apps.events.models import Event

from .repositories import TicketTypeRepository


def require_at_least_one_ticket_type(event: Event) -> None:
    if not TicketTypeRepository().exists_for_event(event.id):
        raise EventNotPublishableError(
            "An event needs at least one ticket type before it can be published."
        )
