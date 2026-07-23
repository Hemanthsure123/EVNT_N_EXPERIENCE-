"""Observers reacting to this module's own domain events, dispatched via the
outbox -> event bus (see core/outbox.py, core/adapters/local/inprocess_event_bus.py).
Wired up in apps.py AppConfig.ready()."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def handle_user_registered(payload: dict) -> None:
    from config.di import email_port

    email_port().send(
        to=payload["email"],
        subject="Welcome to Event & Experience Platform",
        body=f"Hi {payload.get('full_name') or payload['email']}, your account is ready.",
    )
    logger.info("accounts.welcome_email_sent", extra={"user_id": payload["user_id"]})
