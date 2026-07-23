from __future__ import annotations

from core.models import AuditLog


def record_audit(
    *,
    actor_id: str,
    action: str,
    target_type: str = "",
    target_id: str = "",
    metadata: dict | None = None,
) -> AuditLog:
    return AuditLog.objects.create(
        actor_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        metadata=metadata or {},
    )
