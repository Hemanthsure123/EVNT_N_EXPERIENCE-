"""In-process EventBusPort adapter — used whenever EVENT_BUS_BACKEND=inprocess.

Implements the Observer pattern for the monolith: subscribers register a
callable per event type, and `publish` calls each of them synchronously.
A handler raising does not stop the others; it is logged and swallowed so
one broken observer can't take down the publisher (outbox draining must
keep making progress)."""

from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Callable

from core.ports.event_bus_port import EventBusPort

logger = logging.getLogger(__name__)


class InProcessEventBusAdapter(EventBusPort):
    def __init__(self) -> None:
        self._subscribers: dict[str, list[Callable[[dict], None]]] = defaultdict(list)

    def subscribe(self, event_type: str, handler: Callable[[dict], None]) -> None:
        self._subscribers[event_type].append(handler)

    def publish(self, event_type: str, payload: dict) -> None:
        for handler in self._subscribers.get(event_type, []):
            try:
                handler(payload)
            except Exception:
                logger.exception(
                    "inprocess_event_bus.handler_failed",
                    extra={
                        "event_type": event_type,
                        "handler": getattr(handler, "__name__", repr(handler)),
                    },
                )
