from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from apps.accounts.repositories import UserRepository
from apps.booking import handlers


@pytest.mark.django_db
def test_handle_booking_confirmed_emails_the_buyer(monkeypatch):
    from config import di

    user = UserRepository().create_user(email="ticketholder@example.com", password="s3cur3pass")
    fake_port = MagicMock()
    monkeypatch.setattr(di, "email_port", lambda: fake_port)

    handlers.handle_booking_confirmed(
        {"booking_id": "b1", "user_id": str(user.id), "ticket_ids": ["t1", "t2"]}
    )

    fake_port.send.assert_called_once()
    _, kwargs = fake_port.send.call_args
    assert kwargs["to"] == "ticketholder@example.com"


def test_handle_booking_created_does_not_raise():
    handlers.handle_booking_created({"booking_id": "b1"})
