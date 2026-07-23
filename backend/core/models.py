"""Shared-kernel tables: the transactional outbox and the audit log.

Both are written to from inside the same UnitOfWork transaction as the
business change they describe, which is the whole point of the outbox
pattern — an event can never be "lost" because the write that created it
and the write that recorded the event either both commit or both roll back.
"""

from __future__ import annotations

import uuid

from django.db import models


class OutboxEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event_type = models.CharField(max_length=255, db_index=True)
    aggregate_id = models.CharField(max_length=255, blank=True, db_index=True)
    payload = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    published_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        db_table = "core_outbox_event"
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.event_type} ({self.id})"


class AuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor_id = models.CharField(max_length=255, blank=True, db_index=True)
    action = models.CharField(max_length=255, db_index=True)
    target_type = models.CharField(max_length=100, blank=True)
    target_id = models.CharField(max_length=255, blank=True, db_index=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "core_audit_log"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.action} by {self.actor_id or 'system'}"
