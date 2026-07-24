"""The TICKET_CHECKED_IN observer is log-only for now; assert it's wired and
tolerates the event payload without raising."""

from __future__ import annotations

from apps.checkin import handlers


def test_handle_ticket_checked_in_is_a_safe_noop():
    handlers.handle_ticket_checked_in({"ticket_id": "t-1", "event_id": "e-1", "gate": "North"})
