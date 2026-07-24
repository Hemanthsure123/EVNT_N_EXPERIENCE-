"""Console SmsPort adapter — used whenever SMS_PROVIDER=console."""

from __future__ import annotations

import logging
import uuid

from core.ports.sms_port import SmsPort

logger = logging.getLogger("core.adapters.console_sms")


class ConsoleSmsAdapter(SmsPort):
    def send(self, *, to: str, message: str, dlt_template_id: str = "") -> str:
        provider_ref = f"console-sms-{uuid.uuid4().hex[:16]}"
        # "message" collides with a reserved LogRecord attribute — stdlib
        # logging raises KeyError if `extra` tries to overwrite it.
        logger.info(
            "console_sms.send",
            extra={
                "to": to,
                "sms_message": message,
                "dlt_template_id": dlt_template_id,
                "provider_ref": provider_ref,
            },
        )
        return provider_ref
