"""Port for cross-module domain-event distribution (Observer pattern).

`publish` is the real cross-cutting contract every adapter must implement —
it's how the outbox worker hands a durable event to the bus. `subscribe` is
only meaningful for the in-process adapter used in the dev/test monolith:
real message-bus adapters (Pub/Sub) manage subscriptions externally (via
infra config, not runtime code), so the base implementation is a documented
no-op rather than raising, so callers don't need backend-specific branches.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable


class EventBusPort(ABC):
    @abstractmethod
    def publish(self, event_type: str, payload: dict) -> None: ...

    def subscribe(self, event_type: str, handler: Callable[[dict], None]) -> None:
        return None
