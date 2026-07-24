from __future__ import annotations

from apps.booking import handlers


def test_handle_booking_created_does_not_raise():
    handlers.handle_booking_created({"booking_id": "b1"})


def test_handle_booking_confirmed_is_log_only():
    """Ticket DELIVERY (email + SMS) is owned by the notifications module now;
    booking's observer just records the domain fact and must not raise."""
    handlers.handle_booking_confirmed(
        {"booking_id": "b1", "user_id": "u1", "event_id": "e1", "ticket_ids": ["t1", "t2"]}
    )
