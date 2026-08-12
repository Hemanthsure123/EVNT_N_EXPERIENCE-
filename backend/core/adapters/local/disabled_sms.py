"""Null SmsPort adapter — used whenever SMS_PROVIDER=disabled.

── WHY THIS EXISTS, AND WHY IT IS NOT `console` ──────────────────────────

`console` is a DEVELOPMENT fake: it accepts every message, logs it, and
returns a plausible provider reference. In production that is the worst
possible behaviour — `NotificationLog` rows say `sent`, operators see a
healthy delivery rate, and no customer ever receives an OTP. `core/preflight`
refuses to boot production with it, and must keep refusing.

But "somebody forgot to configure SMS" and "we deliberately launched without
SMS" are different facts that `console` cannot tell apart. India's DLT regime
means SMS is not switched on by pasting an API key — it needs a registered
entity and per-template approval, which takes weeks. A platform can be
genuinely ready to take money before that clears.

So this adapter is the second fact, stated explicitly. It reports
`is_configured() == False`, which makes `NotificationService.notify` SKIP the
message and record why, instead of claiming it. It is the same pattern the Web
Push port already uses when VAPID keys are absent: refuse rather than pretend.

`send()` RAISES rather than no-ops. Nothing should reach it — `notify` checks
`is_configured()` first — so if it is ever called, a caller has bypassed that
check and the right outcome is a loud failure in the retry/dead-letter
machinery, not a message silently discarded while the log says `sent`.

To turn SMS on: set SMS_PROVIDER=http with SMS_API_KEY, SMS_SENDER_ID and
SMS_DLT_ENTITY_ID. Nothing else changes; this adapter simply stops being
selected.
"""

from __future__ import annotations

import logging

from core.ports.sms_port import SmsPort

logger = logging.getLogger("core.adapters.disabled_sms")


class SmsDisabledError(RuntimeError):
    """Raised if an SMS send is attempted while SMS is deliberately disabled."""


class DisabledSmsAdapter(SmsPort):
    def is_configured(self) -> bool:
        return False

    def send(self, *, to: str, message: str, dlt_template_id: str = "") -> str:
        # Deliberately no `to`/`message` in the log: this is the one place a
        # phone number could be written out on a path nobody expected to run.
        logger.error(
            "disabled_sms.send_attempted",
            extra={"dlt_template_id": dlt_template_id},
        )
        raise SmsDisabledError(
            "SMS_PROVIDER=disabled: this deployment cannot deliver SMS. "
            "Callers must check SmsPort.is_configured() and skip. "
            "Set SMS_PROVIDER=http with SMS_API_KEY, SMS_SENDER_ID and "
            "SMS_DLT_ENTITY_ID to enable delivery."
        )
