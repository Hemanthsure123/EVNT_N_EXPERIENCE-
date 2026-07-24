"""Console EmailPort adapter — used whenever EMAIL_PROVIDER=console."""

from __future__ import annotations

import logging
import uuid

from core.ports.email_port import EmailPort

logger = logging.getLogger("core.adapters.console_email")


class ConsoleEmailAdapter(EmailPort):
    def send(self, *, to: str, subject: str, body: str) -> str:
        provider_ref = f"console-email-{uuid.uuid4().hex[:16]}"
        logger.info(
            "console_email.send",
            extra={"to": to, "subject": subject, "body": body, "provider_ref": provider_ref},
        )
        return provider_ref
