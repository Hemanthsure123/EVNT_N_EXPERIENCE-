"""Synchronous TaskQueuePort adapter — used whenever QUEUE_BACKEND=local.

Runs the registered task (see core/tasks.py) immediately, in-process. This
is a deliberate dev/test simplification, mirroring how EVENT_BUS_BACKEND=
inprocess handles domain events: production's Cloud Tasks adapter defers
work to a separately-invoked HTTP request, off the original request's
critical path, but local dev accepts synchronous execution for simplicity —
there's no separate worker process to run. A task raising is caught and
logged rather than propagated, so a bug in background work can never break
the request that enqueued it, matching how a real queue's failure handling
(retries, dead-lettering) is invisible to the enqueuing caller."""

from __future__ import annotations

import itertools
import logging

from core.ports.task_queue_port import TaskQueuePort
from core.tasks import run_task

logger = logging.getLogger(__name__)


class SyncTaskQueueAdapter(TaskQueuePort):
    def __init__(self) -> None:
        self._ids = itertools.count(1)

    def enqueue(self, task_name: str, payload: dict, *, delay_seconds: int = 0) -> str:
        task_id = f"local_task_{next(self._ids)}"
        logger.info(
            "sync_task_queue.enqueue",
            extra={"task_id": task_id, "task_name": task_name, "delay_seconds": delay_seconds},
        )
        try:
            run_task(task_name, payload)
        except Exception:
            logger.exception(
                "sync_task_queue.task_failed",
                extra={"task_id": task_id, "task_name": task_name},
            )
        return task_id
