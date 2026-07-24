"""Read-side of notifications (CQRS-lite). Internal/ops reads only — this
module has no public CRUD surface. Handy for admin dashboards, health checks
and tests (e.g. surfacing the dead-letter backlog)."""

from __future__ import annotations

from django.db.models import QuerySet

from .models import NotificationLog, NotificationStatus
from .repositories import NotificationLogRepository


def get_by_dedupe_key(
    dedupe_key: str, *, logs: NotificationLogRepository | None = None
) -> NotificationLog | None:
    logs = logs or NotificationLogRepository()
    return logs.get_by_dedupe_key(dedupe_key)


def list_dead_letters() -> QuerySet[NotificationLog]:
    """The dead-letter backlog (permanently failed after exhausting retries) —
    what an operator would inspect/replay. Newest first."""
    return NotificationLog.objects.filter(status=NotificationStatus.FAILED).order_by("-created_at")
