"""Durable outbox-draining worker.

The `UnitOfWork` on-commit hook already drains the outbox synchronously
after every write, which is enough for local dev/test. This process exists
for staging/production, where it must keep polling independently so an
event is never stuck forever if that on-commit hook is skipped (e.g. the
process crashed right after commit, or the in-process event bus isn't
being used). Run it with:

    python -m config.worker
"""

from __future__ import annotations

import os
import signal
import time

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

import django  # noqa: E402

django.setup()

from core.logging import get_logger  # noqa: E402
from core.outbox import publish_pending  # noqa: E402

logger = get_logger(__name__)

POLL_INTERVAL_SECONDS = 2

_shutdown = False


def _handle_shutdown(signum: int, frame: object) -> None:
    global _shutdown
    _shutdown = True


def run() -> None:
    signal.signal(signal.SIGTERM, _handle_shutdown)
    signal.signal(signal.SIGINT, _handle_shutdown)

    logger.info("outbox_worker.started")
    while not _shutdown:
        published = publish_pending()
        if published:
            logger.info("outbox_worker.published", extra={"count": published})
        time.sleep(POLL_INTERVAL_SECONDS)
    logger.info("outbox_worker.stopped")


if __name__ == "__main__":
    run()
