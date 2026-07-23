"""Synchronous TaskQueuePort adapter — used whenever QUEUE_BACKEND=local.

There is no real dispatch target yet (see task_queue_port.py for why no
registry exists in this foundation slice); this adapter just logs the
enqueue call and returns a fake task id so callers can be written now and
wired to a real consumer later without changing their call sites."""

from __future__ import annotations

import itertools
import logging

from core.ports.task_queue_port import TaskQueuePort

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
        return task_id
