"""The outbox pattern: record domain events in the same transaction as the
business change, then drain them to the event bus once that transaction has
committed.

`record_event` must be called from inside an active transaction (normally
via UnitOfWork.publish — see unit_of_work.py). `publish_pending` is safe to
call from multiple processes concurrently thanks to `select_for_update
(skip_locked=True)`, so both the synchronous on-commit drain used in
dev/test and the durable polling worker (config/worker.py) share one code
path and can never double-publish an event to each other's batch."""

from __future__ import annotations

import logging

from django.db import transaction
from django.utils import timezone

from core.models import OutboxEvent

logger = logging.getLogger(__name__)


def record_event(*, event_type: str, payload: dict, aggregate_id: str = "") -> OutboxEvent:
    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError("record_event must be called inside a transaction (use UnitOfWork)")
    return OutboxEvent.objects.create(
        event_type=event_type, payload=payload, aggregate_id=aggregate_id
    )


def publish_pending(*, batch_size: int = 100) -> int:
    """Publish up to `batch_size` unpublished events. Returns how many were
    successfully published. Events whose handler raises are left unpublished
    so a later call can retry them."""
    from config.di import event_bus_port

    bus = event_bus_port()
    published_count = 0

    with transaction.atomic():
        events = list(
            OutboxEvent.objects.select_for_update(skip_locked=True)
            .filter(published_at__isnull=True)
            .order_by("created_at")[:batch_size]
        )
        for event in events:
            try:
                bus.publish(event.event_type, event.payload)
            except Exception:
                logger.exception("outbox.publish_failed", extra={"event_id": str(event.id)})
                continue
            event.published_at = timezone.now()
            event.save(update_fields=["published_at"])
            published_count += 1

    return published_count
