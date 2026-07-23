"""Port for deferred/background work (Google Cloud Tasks in production).

Deliberately minimal for now: `enqueue` is the only contract. No module in
the current foundation slice needs async execution yet, so we are not
pre-building a task-name registry speculatively — the first real consumer
(e.g. settlement payouts or reminder emails) should add that alongside its
own use case. Adding it now, unused, would be exactly the kind of
over-engineering the project brief warns against.
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class TaskQueuePort(ABC):
    @abstractmethod
    def enqueue(self, task_name: str, payload: dict, *, delay_seconds: int = 0) -> str:
        """Schedule `task_name` to run (immediately, or after `delay_seconds`).
        Returns a vendor task id for observability."""
