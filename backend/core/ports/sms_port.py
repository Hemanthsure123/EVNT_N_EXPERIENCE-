"""Port for transactional SMS delivery (India DLT-registered sender in production).

`send` returns a provider reference (the provider's message id) for tracing.
`dlt_template_id` lets the caller pass the DLT-approved template id for THIS
specific message — India's DLT regime approves a distinct template per message
type, so a single sender uses many template ids. When blank, the real adapter
falls back to its configured default. `notifications` maps each SMS type to its
approved id (see `apps/notifications/templates.py`).
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class SmsPort(ABC):
    @abstractmethod
    def send(self, *, to: str, message: str, dlt_template_id: str = "") -> str:
        """Send an SMS. Returns a provider message reference for tracing."""

    def is_configured(self) -> bool:
        """Whether this deployment can actually deliver an SMS.

        Concrete, not abstract, and defaulting to True: every adapter that
        exists to send something can send, and requiring each to say so would
        be ceremony. Only `DisabledSmsAdapter` overrides it.

        This mirrors `PushPort.is_configured()`, and for the same reason. India's
        DLT regime means SMS cannot be switched on by pasting an API key — it
        needs a registered entity and per-template approval, which takes weeks.
        A deployment can therefore be legitimately complete and still have no
        SMS, and the honest way to model that is a port that SAYS it cannot
        deliver, so callers skip cleanly, rather than a fake that accepts every
        message and drops it.
        """
        return True
