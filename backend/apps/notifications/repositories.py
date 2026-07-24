"""ORM access for NotificationLog — the only place its queries live.

The claim (`create`) races on the unique `dedupe_key`; `lock_for_update` is the
per-row lock that serialises concurrent dispatchers so a message is sent once.
"""

from __future__ import annotations

import uuid

from core.base_repository import BaseRepository

from .models import NotificationLog, NotificationStatus


class NotificationLogRepository(BaseRepository[NotificationLog]):
    model = NotificationLog

    def get_by_dedupe_key(self, dedupe_key: str) -> NotificationLog | None:
        return self.get_queryset().filter(dedupe_key=dedupe_key).first()

    def claim(
        self,
        *,
        dedupe_key: str,
        notification_type: str,
        channel: str,
        recipient: str,
        subject: str,
        body: str,
    ) -> NotificationLog:
        """Insert the pending claim. Racing callers collide on the unique
        `dedupe_key` (IntegrityError) — the caller catches it and treats the
        existing row as the winner, so only one claim ever proceeds to enqueue."""
        return NotificationLog.objects.create(
            dedupe_key=dedupe_key,
            type=notification_type,
            channel=channel,
            recipient=recipient,
            subject=subject,
            body=body,
            status=NotificationStatus.PENDING,
        )

    def lock_for_update(self, notification_id: uuid.UUID | str) -> NotificationLog | None:
        """SELECT ... FOR UPDATE on the single log row — serialises two
        dispatchers of the same notification so exactly one sends. MUST run
        inside the caller's transaction."""
        return self.get_queryset().select_for_update().filter(pk=notification_id).first()
