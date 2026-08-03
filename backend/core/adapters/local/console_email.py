"""Console EmailPort adapter — used whenever EMAIL_PROVIDER=console."""

from __future__ import annotations

import logging
import uuid

from core.ports.email_port import EmailAttachment, EmailPort

logger = logging.getLogger("core.adapters.console_email")


class ConsoleEmailAdapter(EmailPort):
    def send(
        self,
        *,
        to: str,
        subject: str,
        body: str,
        html: str = "",
        attachments: tuple[EmailAttachment, ...] = (),
    ) -> str:
        provider_ref = f"console-email-{uuid.uuid4().hex[:16]}"
        logger.info(
            "console_email.send",
            extra={
                "to": to,
                "subject": subject,
                # The TEXT part only. Dumping several KB of table markup into
                # a log line would bury the verification code a developer is
                # reading this log to find — `html_bytes` is enough to tell
                # that the alternative was built.
                "body": body,
                "html_bytes": len(html),
                # Names and sizes, never the bytes. A base64 ticket PDF in a
                # log line is several KB of noise around the one thing a
                # developer opened this log to read — and it is a scannable
                # credential, which does not belong in log storage.
                "attachments": [
                    f"{a.filename} ({len(a.content)}B, {a.content_type})" for a in attachments
                ],
                "provider_ref": provider_ref,
            },
        )
        return provider_ref
