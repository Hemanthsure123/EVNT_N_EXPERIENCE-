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
