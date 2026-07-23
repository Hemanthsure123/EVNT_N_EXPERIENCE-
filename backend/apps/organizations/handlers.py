"""Observers reacting to this module's own domain events, dispatched via
the outbox -> event bus (see core/outbox.py,
core/adapters/local/inprocess_event_bus.py). Wired up in apps.py
AppConfig.ready()."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def handle_organization_created(payload: dict) -> None:
    from config.di import email_port

    if payload.get("owner_email"):
        email_port().send(
            to=payload["owner_email"],
            subject="Your organization is live",
            body=f"'{payload['name']}' has been created. You're now an organizer.",
        )
    logger.info(
        "organizations.created_email_sent", extra={"organization_id": payload["organization_id"]}
    )


def handle_organization_verified(payload: dict) -> None:
    from config.di import email_port

    if payload.get("owner_email"):
        email_port().send(
            to=payload["owner_email"],
            subject="You're verified",
            body="Your organization has passed verification.",
        )
    logger.info("organizations.verified", extra={"organization_id": payload["organization_id"]})


def handle_payout_account_linked(payload: dict) -> None:
    from config.di import email_port

    if payload.get("owner_email"):
        email_port().send(
            to=payload["owner_email"],
            subject="Payout account linked",
            body="Your payout account is linked — you're ready to receive payouts after events.",
        )
    logger.info(
        "organizations.payout_account_linked",
        extra={"organization_id": payload["organization_id"]},
    )
