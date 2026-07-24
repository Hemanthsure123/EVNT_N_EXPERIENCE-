from __future__ import annotations

from unittest.mock import MagicMock

from apps.events import handlers


def test_handle_event_published_emails_the_owner(monkeypatch):
    from config import di

    fake_port = MagicMock()
    monkeypatch.setattr(di, "email_port", lambda: fake_port)

    handlers.handle_event_published(
        {"event_id": "e1", "owner_email": "owner@example.com", "title": "Gig"}
    )

    fake_port.send.assert_called_once()
    _, kwargs = fake_port.send.call_args
    assert kwargs["to"] == "owner@example.com"
    assert "Gig" in kwargs["body"]


def test_handle_event_published_skips_email_without_an_owner_email(monkeypatch):
    from config import di

    fake_port = MagicMock()
    monkeypatch.setattr(di, "email_port", lambda: fake_port)

    handlers.handle_event_published({"event_id": "e1", "owner_email": "", "title": "Gig"})

    fake_port.send.assert_not_called()


def test_handle_event_created_does_not_raise():
    handlers.handle_event_created({"event_id": "e1"})
