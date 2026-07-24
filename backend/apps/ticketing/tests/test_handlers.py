from __future__ import annotations

from apps.ticketing import handlers


def test_handle_ticket_type_added_does_not_raise():
    handlers.handle_ticket_type_added({"ticket_type_id": "t1"})


def test_handle_ticket_type_sold_out_does_not_raise():
    handlers.handle_ticket_type_sold_out({"ticket_type_id": "t1", "event_id": "e1"})
