"""Notifications business rules — reliable, idempotent, fully-async delivery.

Three responsibilities, cleanly separated (render / dispatch / orchestrate):
- TemplateService renders (pure, no I/O — see templates.py).
- `NotificationService.dispatch` sends via the channel port and manages
  retry / dead-letter.
- `NotificationService.notify` orchestrates: dedupe -> render -> CLAIM -> enqueue.

Exactly-once, even under at-least-once event delivery and worker retries:
1. Every logical message has a stable, UNIQUE `dedupe_key`. `notify` is a no-op
   if a log already exists for it, and a concurrent claim collides on the unique
   key — so a message is CLAIMED exactly once.
2. The actual send is made under a per-row `SELECT ... FOR UPDATE` lock with a
   status re-check, so two dispatchers of the same claim can't both send.

Nothing user-facing blocks on a send: `notify` only renders (fast, no I/O) and
claims, then hands the send to `TaskQueuePort`. OTP is dispatched with zero
delay (prompt) but still through this same async path.
"""

from __future__ import annotations

import logging
import uuid

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.repositories import UserRepository
from apps.booking.repositories import TicketRepository
from apps.events.repositories import EventRepository
from core.ports.email_port import EmailPort
from core.ports.sms_port import SmsPort
from core.ports.task_queue_port import TaskQueuePort

from .models import NotificationChannel, NotificationLog, NotificationStatus, NotificationType
from .repositories import NotificationLogRepository
from .templates import (
    TemplateService,
    channel_for_type,
    dlt_template_id_for_type,
    format_when,
)

logger = logging.getLogger(__name__)

DISPATCH_TASK = "notifications.dispatch"
EVENT_REMINDER_TASK = "notifications.event_reminder"


class NotificationService:
    def __init__(
        self,
        *,
        logs: NotificationLogRepository,
        templates: TemplateService,
        email: EmailPort,
        sms: SmsPort,
        task_queue: TaskQueuePort,
        max_attempts: int,
        retry_backoff_seconds: int,
    ) -> None:
        self._logs = logs
        self._templates = templates
        self._email = email
        self._sms = sms
        self._task_queue = task_queue
        self._max_attempts = max_attempts
        self._retry_backoff_seconds = retry_backoff_seconds

    # --- notify: the ONE entry point (orchestrate) -------------------------

    def notify(
        self,
        *,
        notification_type: str,
        recipient: str,
        context: dict,
        dedupe_key: str,
        delay_seconds: int = 0,
    ) -> NotificationLog | None:
        """Render + dedupe + claim + enqueue one notification. Idempotent on
        `dedupe_key`: a second call for the same logical message returns the
        existing log and does NOT enqueue a second send. Returns the log, or
        None when there's no recipient (e.g. an SMS to a user with no phone —
        a clean skip, not a failure). Raises TemplateMissingError if the type
        has no template (a loud error, never a silent no-send)."""
        channel = channel_for_type(notification_type)
        if not recipient:
            logger.info(
                "notifications.skipped_no_recipient",
                extra={"type": notification_type, "dedupe_key": dedupe_key},
            )
            return None

        existing = self._logs.get_by_dedupe_key(dedupe_key)
        if existing is not None:
            return existing  # already claimed/sent/failed — never send twice

        rendered = self._templates.render(
            notification_type=notification_type, channel=channel, context=context
        )
        try:
            # Own savepoint so a lost race (unique dedupe_key) rolls back only
            # this insert, not an enclosing transaction (notify runs inside the
            # outbox-drain transaction when called from an event handler).
            with transaction.atomic():
                log = self._logs.claim(
                    dedupe_key=dedupe_key,
                    notification_type=notification_type,
                    channel=channel,
                    recipient=recipient,
                    subject=rendered.subject,
                    body=rendered.body,
                )
        except IntegrityError:
            # A concurrent notify() claimed it first — return the winner, and
            # let it (not us) enqueue the single dispatch.
            return self._logs.get_by_dedupe_key(dedupe_key)

        self._task_queue.enqueue(
            DISPATCH_TASK, {"notification_id": str(log.id)}, delay_seconds=delay_seconds
        )
        return log

    # --- dispatch: the send (with retry + dead-letter) ---------------------

    def dispatch(self, notification_id: uuid.UUID | str) -> None:
        """Send one claimed notification. IDEMPOTENT and redelivery-safe: a
        SENT or FAILED log is a no-op, and the send is made under a row lock
        with a status re-check so two dispatchers can't both send. On provider
        failure it increments attempts and re-enqueues with exponential
        backoff; after `max_attempts` it dead-letters (status=failed, logged)."""
        log = self._logs.get_by_id(notification_id)
        if log is None:
            logger.warning(
                "notifications.dispatch.missing", extra={"notification_id": str(notification_id)}
            )
            return
        if log.status != NotificationStatus.PENDING:
            return  # already delivered or dead-lettered

        retry_delay: int | None = None
        with transaction.atomic():
            locked = self._logs.lock_for_update(notification_id)
            if locked is None or locked.status != NotificationStatus.PENDING:
                return  # a concurrent dispatcher won the row — don't double-send

            try:
                provider_ref = self._send(locked)
            except Exception as exc:  # noqa: BLE001 — any provider error is retryable
                locked.attempts += 1
                locked.error = str(exc)[:500]
                if locked.attempts >= self._max_attempts:
                    locked.status = NotificationStatus.FAILED  # dead-letter
                    self._logs.save(locked)
                    logger.error(
                        "notifications.dead_lettered",
                        extra={
                            "notification_id": str(locked.id),
                            "type": locked.type,
                            "attempts": locked.attempts,
                        },
                    )
                else:
                    self._logs.save(locked)
                    retry_delay = self._retry_backoff_seconds * (2 ** (locked.attempts - 1))
                    logger.warning(
                        "notifications.retry_scheduled",
                        extra={"notification_id": str(locked.id), "attempt": locked.attempts},
                    )
            else:
                locked.status = NotificationStatus.SENT
                locked.provider_ref = provider_ref
                locked.sent_at = timezone.now()
                locked.attempts += 1
                self._logs.save(locked)
                logger.info(
                    "notifications.sent",
                    extra={
                        "notification_id": str(locked.id),
                        "type": locked.type,
                        "channel": locked.channel,
                    },
                )

        # Re-enqueue AFTER the failed attempt commits, so the retry reads the
        # incremented attempt count. External-ish call kept out of the txn.
        if retry_delay is not None:
            self._task_queue.enqueue(
                DISPATCH_TASK, {"notification_id": str(notification_id)}, delay_seconds=retry_delay
            )

    def _send(self, log: NotificationLog) -> str:
        if log.channel == NotificationChannel.EMAIL:
            return self._email.send(to=log.recipient, subject=log.subject, body=log.body)
        return self._sms.send(
            to=log.recipient,
            message=log.body,
            dlt_template_id=dlt_template_id_for_type(log.type),
        )


class ReminderService:
    """Fans a scheduled event reminder out to every current ticket holder. Each
    recipient goes through NotificationService.notify with a per-(event, user)
    dedupe_key, so re-running the job never double-sends."""

    def __init__(
        self,
        *,
        notifications: NotificationService,
        tickets: TicketRepository,
        users: UserRepository,
        events: EventRepository,
    ) -> None:
        self._notifications = notifications
        self._tickets = tickets
        self._users = users
        self._events = events

    def send_event_reminders(self, event_id: uuid.UUID | str) -> int:
        """Notify all holders of a live ticket for this event. Returns the
        number notified. Loads recipients in ONE query (no N+1)."""
        event = self._events.get_active_by_id(event_id)
        if event is None:
            logger.warning(
                "notifications.reminder.event_missing", extra={"event_id": str(event_id)}
            )
            return 0

        holder_ids = self._tickets.list_holder_user_ids_for_event(event_id)
        if not holder_ids:
            return 0

        when = format_when(event.starts_at)
        where = f"{event.venue}, {event.city}"
        count = 0
        for user in self._users.list_by_ids(holder_ids):
            self._notifications.notify(
                notification_type=NotificationType.EVENT_REMINDER,
                recipient=user.email,
                context={
                    "name": user.full_name,
                    "event_title": event.title,
                    "event_when": when,
                    "event_where": where,
                },
                dedupe_key=f"event_reminder:{event_id}:email:{user.email}",
            )
            count += 1
        logger.info(
            "notifications.reminders_sent", extra={"event_id": str(event_id), "count": count}
        )
        return count
