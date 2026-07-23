"""Console EmailPort adapter — used whenever EMAIL_PROVIDER=console."""

from __future__ import annotations

import logging

from core.ports.email_port import EmailPort

logger = logging.getLogger("core.adapters.console_email")


class ConsoleEmailAdapter(EmailPort):
    def send(self, *, to: str, subject: str, body: str) -> None:
        logger.info("console_email.send", extra={"to": to, "subject": subject, "body": body})
