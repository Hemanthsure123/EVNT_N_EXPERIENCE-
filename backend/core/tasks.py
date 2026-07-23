"""Minimal task-name registry for TaskQueuePort adapters.

This didn't exist in the foundation slice on purpose (see
core/ports/task_queue_port.py) — nothing needed async execution yet. The
organizations module's verification flow is the first real consumer:
submitting verification must return fast, with the actual processing
happening off the request path. Modules register their task handlers at
import time via `@register_task`, imported from each app's `AppConfig.ready()`
(see apps/organizations/apps.py) so the registry is populated before any
request can enqueue a task.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

logger = logging.getLogger(__name__)

_registry: dict[str, Callable[[dict], None]] = {}


def register_task(name: str) -> Callable[[Callable[[dict], None]], Callable[[dict], None]]:
    def decorator(fn: Callable[[dict], None]) -> Callable[[dict], None]:
        if name in _registry and _registry[name] is not fn:
            raise ValueError(f"Task {name!r} is already registered")
        _registry[name] = fn
        return fn

    return decorator


def run_task(name: str, payload: dict) -> None:
    handler = _registry.get(name)
    if handler is None:
        raise KeyError(f"No task registered as {name!r}")
    handler(payload)
