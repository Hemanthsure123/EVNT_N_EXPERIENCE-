"""The fan-out, off the request path.

`queue_broadcast` writes the delivery rows and stops. This is what turns each
of them into a message, one bounded batch at a time, re-enqueueing itself while
there is more (see `BroadcastService.send_pending`). Registered via
`@register_task` at import time; apps.py's `AppConfig.ready()` imports this
module so registration always happens before a request could enqueue one.
"""

from __future__ import annotations

from core.tasks import register_task

from .services import BROADCAST_TASK


@register_task(BROADCAST_TASK)
def broadcast(payload: dict) -> None:
    """Hand one batch of this announcement's deliveries to `notifications`."""
    from .di import build_broadcast_service  # staged; belongs in config/di.py

    build_broadcast_service().send_pending(payload["announcement_id"])
