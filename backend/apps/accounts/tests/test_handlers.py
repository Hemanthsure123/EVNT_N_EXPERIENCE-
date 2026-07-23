from unittest.mock import MagicMock

from apps.accounts import handlers


def test_handle_user_registered_sends_a_welcome_email(monkeypatch):
    from config import di

    fake_port = MagicMock()
    monkeypatch.setattr(di, "email_port", lambda: fake_port)

    handlers.handle_user_registered({"user_id": "u1", "email": "a@example.com", "full_name": "A"})

    fake_port.send.assert_called_once()
    _, kwargs = fake_port.send.call_args
    assert kwargs["to"] == "a@example.com"
    assert "A" in kwargs["body"]


def test_handle_user_registered_falls_back_to_email_when_full_name_blank(monkeypatch):
    from config import di

    fake_port = MagicMock()
    monkeypatch.setattr(di, "email_port", lambda: fake_port)

    handlers.handle_user_registered({"user_id": "u2", "email": "b@example.com", "full_name": ""})

    _, kwargs = fake_port.send.call_args
    assert "b@example.com" in kwargs["body"]
