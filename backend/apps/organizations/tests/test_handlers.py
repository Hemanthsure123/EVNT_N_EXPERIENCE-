from unittest.mock import MagicMock

from apps.organizations import handlers


def test_handle_organization_created_sends_an_email(monkeypatch):
    from config import di

    fake_port = MagicMock()
    monkeypatch.setattr(di, "email_port", lambda: fake_port)

    handlers.handle_organization_created(
        {
            "organization_id": "o1",
            "name": "Acme Events",
            "owner_id": "u1",
            "owner_email": "a@example.com",
        }
    )

    fake_port.send.assert_called_once()
    _, kwargs = fake_port.send.call_args
    assert kwargs["to"] == "a@example.com"
    assert "Acme Events" in kwargs["body"]


def test_handle_organization_created_skips_email_when_owner_email_missing(monkeypatch):
    from config import di

    fake_port = MagicMock()
    monkeypatch.setattr(di, "email_port", lambda: fake_port)

    handlers.handle_organization_created(
        {"organization_id": "o1", "name": "Acme Events", "owner_id": "u1", "owner_email": ""}
    )

    fake_port.send.assert_not_called()


def test_handle_organization_verified_sends_an_email(monkeypatch):
    from config import di

    fake_port = MagicMock()
    monkeypatch.setattr(di, "email_port", lambda: fake_port)

    handlers.handle_organization_verified({"organization_id": "o1", "owner_email": "a@example.com"})

    fake_port.send.assert_called_once()


def test_handle_payout_account_linked_sends_an_email(monkeypatch):
    from config import di

    fake_port = MagicMock()
    monkeypatch.setattr(di, "email_port", lambda: fake_port)

    handlers.handle_payout_account_linked(
        {"organization_id": "o1", "payout_account_id": "acc_1", "owner_email": "a@example.com"}
    )

    fake_port.send.assert_called_once()
