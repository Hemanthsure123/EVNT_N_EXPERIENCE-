"""Port for transactional email delivery.

`send` returns a provider reference (the provider's message id) so a caller
that logs deliveries — `notifications`, the first real consumer — can store it
for tracing/support. The console adapter returns a synthetic id; real adapters
return the provider's own id.
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class EmailPort(ABC):
    @abstractmethod
    def send(self, *, to: str, subject: str, body: str) -> str:
        """Send an email. Returns a provider message reference for tracing."""
