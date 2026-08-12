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

import base64
import logging
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.repositories import UserRepository
from apps.booking.repositories import TicketRepository
from apps.events.repositories import EventRepository
from core.ports.email_port import EmailAttachment, EmailPort
from core.ports.push_port import PushPort
from core.ports.push_port import PushSubscription as PushSubscriptionData
from core.ports.sms_port import SmsPort
from core.ports.task_queue_port import TaskQueuePort

from .models import NotificationChannel, NotificationLog, NotificationStatus, NotificationType
from .repositories import NotificationLogRepository, PushSubscriptionRepository
from .templates import (
    TemplateService,
    channel_for_type,
    dlt_template_id_for_type,
    format_when,
)

logger = logging.getLogger(__name__)


def _decode_attachments(stored: list | None) -> tuple[EmailAttachment, ...]:
    """Rebuild attachments from the claimed row.

    A malformed or truncated entry is DROPPED, not raised on. The email is
    complete without its attachment — the QR tokens are in the body and the
    wallet link is in the HTML — so a corrupt blob costs a convenience, while
    raising here would dead-letter a ticket somebody has already paid for.
    """
    attachments: list[EmailAttachment] = []
    for entry in stored or []:
        try:
            attachments.append(
                EmailAttachment(
                    filename=str(entry["filename"]),
                    content=base64.b64decode(entry["b64"]),
                    content_type=str(entry.get("content_type") or "application/octet-stream"),
                )
            )
        except Exception:  # noqa: BLE001 — see the note above
            logger.exception("notifications.attachment.undecodable")
    return tuple(attachments)


DISPATCH_TASK = "notifications.dispatch"
EVENT_REMINDER_TASK = "notifications.event_reminder"
SWEEP_STUCK_TASK = "notifications.sweep_stuck"


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
        push: PushPort,
        push_subscriptions: PushSubscriptionRepository,
    ) -> None:
        self._logs = logs
        self._templates = templates
        self._email = email
        self._sms = sms
        self._push = push
        self._push_subscriptions = push_subscriptions
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

        # ── SMS THAT CANNOT BE DELIVERED IS NOT CLAIMED ────────────────────
        #
        # With SMS_PROVIDER=disabled the port reports it cannot deliver, and
        # the message is skipped HERE — before a `NotificationLog` row is
        # written. That ordering is the point: claiming the row first would
        # leave a pending record that dispatch can only ever fail, so every
        # undeliverable SMS would burn its retries and land in the dead-letter
        # state, making a deliberate configuration look like an outage.
        #
        # Skipping is safe for the caller because SMS is never the only channel
        # for anything that matters: a booking confirmation is an email AND an
        # SMS, and the email still goes. The one capability genuinely lost is
        # phone OTP, which has no backend wired in any case.
        if channel == NotificationChannel.SMS and not self._sms.is_configured():
            logger.info(
                "notifications.skipped_sms_disabled",
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
                    html_body=rendered.html,
                    context_url=rendered.url,
                    attachments_json=[
                        {
                            "filename": a.filename,
                            "content_type": a.content_type,
                            "b64": base64.b64encode(a.content).decode("ascii"),
                        }
                        for a in rendered.attachments
                    ],
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

    # --- sweep: the backstop for claims that were never dispatched ---------

    def sweep_stuck(self, *, older_than_seconds: int = 300, limit: int = 200) -> int:
        """Re-enqueue dispatch for claims left `pending`. Returns the count.

        `notify` claims the row and THEN enqueues — two steps, so there is a
        window. A process killed inside it, or a queue that rejects the
        enqueue, leaves a `pending` row that nothing will ever look at again:
        the dedupe key exists, so a later `notify` returns it rather than
        re-enqueueing, and `dispatch` is only ever called from the task that
        was never created. The message is a ticket email that silently never
        arrives, which the customer discovers at the gate.

        This is the module's third reliability layer, and it is the same shape
        as booking's expired-hold sweeper: periodic, idempotent, and correct
        even when every best-effort signal was missed.

        Safe to run as often as you like. It only re-enqueues — `dispatch`
        re-checks `status == pending` under the row lock, so a sweep racing a
        dispatcher that is already sending does nothing at all.

        `older_than_seconds` must comfortably exceed a normal enqueue-to-send
        gap, or the sweeper starts racing healthy dispatches and doing wasted
        work. Five minutes is far longer than any real dispatch takes and far
        shorter than a person's patience for a ticket.
        """
        cutoff = timezone.now() - timedelta(seconds=older_than_seconds)
        stuck = self._logs.list_stuck_pending(older_than=cutoff, limit=limit)
        if not stuck:
            return 0

        requeued = 0
        for log in stuck:
            try:
                self._task_queue.enqueue(DISPATCH_TASK, {"notification_id": str(log.id)})
            except Exception:
                # One bad enqueue must not abandon the rest of the backlog.
                logger.exception(
                    "notifications.sweep.enqueue_failed", extra={"notification_id": str(log.id)}
                )
                continue
            requeued += 1

        # Warning, not info: a non-zero result means something dropped a send
        # earlier. The messages are rescued, and somebody should still know.
        logger.warning("notifications.sweep.requeued", extra={"count": requeued})
        return requeued

    def _send(self, log: NotificationLog) -> str:
        if log.channel == NotificationChannel.EMAIL:
            return self._email.send(
                to=log.recipient,
                subject=log.subject,
                body=log.body,
                html=log.html_body,
                attachments=_decode_attachments(log.attachments_json),
            )
        if log.channel == NotificationChannel.PUSH:
            return self._send_push(log)
        return self._sms.send(
            to=log.recipient,
            message=log.body,
            dlt_template_id=dlt_template_id_for_type(log.type),
        )

    def _send_push(self, log: NotificationLog) -> str:
        """Fan one logical notification out to every device a user subscribed.

        `recipient` is a USER ID here, not an address — one person with a
        laptop and a phone should get one reminder on each, not two
        notifications each. So the log row stays one row, and the fan-out
        happens at send time.

        ── WHAT COUNTS AS SUCCESS ───────────────────────────────────────────

        One device reaching the person is the message being delivered. Raising
        because their old laptop's subscription expired would dead-letter a
        notification their phone already showed. So:

        - at least one delivered  -> success, with a per-device summary stored
          as the provider ref;
        - every device reported GONE -> also success, and every row deleted.
          There is nobody to reach and no retry that could change that; the
          honest record is "delivered to zero live devices", not a failure
          that burns five attempts and dead-letters;
        - a real transport error with nothing delivered -> raise, so the
          existing retry/dead-letter machinery handles it exactly as it does
          for a refused SMTP connection.

        Expired subscriptions are deleted here rather than swept later: this
        is the moment we learn, and the row can never work again.
        """
        subscriptions = self._push_subscriptions.list_for_user(log.recipient)
        if not subscriptions:
            # Not an error. Somebody unsubscribed between the claim and the
            # send, which is ordinary. Recorded as sent-to-nothing rather than
            # retried five times against a user who has no devices.
            return "push:no-subscriptions"

        delivered: list = []
        expired: list = []
        last_error = ""
        for subscription in subscriptions:
            result = self._push.send(
                subscription=PushSubscriptionData(
                    endpoint=subscription.endpoint,
                    p256dh=subscription.p256dh,
                    auth=subscription.auth,
                ),
                title=log.subject or "Update",
                body=log.body,
                url=log.context_url,
                # One tag per logical notification, so a second delivery
                # REPLACES the first in the tray instead of stacking. Two
                # identical reminders is how people turn notifications off.
                tag=log.dedupe_key,
            )
            if result.delivered:
                delivered.append(subscription.id)
            elif result.gone:
                expired.append(subscription.id)
            else:
                last_error = result.error

        if expired:
            self._push_subscriptions.delete_ids(expired)
        if delivered:
            self._push_subscriptions.mark_used(delivered, when=timezone.now())
            return f"push:{len(delivered)}/{len(subscriptions)}"
        if expired and not last_error:
            return "push:all-expired"

        raise RuntimeError(last_error or "push delivery failed")


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
        # Blank rather than a guess when PUBLIC_SITE_URL is unset: a push whose
        # tap target is the wrong host is worse than one with no link.
        site = settings.PUBLIC_SITE_URL
        context = {
            "event_title": event.title,
            "event_when": when,
            "event_where": where,
            "url": f"{site}/events/{event.id}" if site else "",
        }
        count = 0
        for user in self._users.list_by_ids(holder_ids):
            self._notifications.notify(
                notification_type=NotificationType.EVENT_REMINDER,
                recipient=user.email,
                context={"name": user.full_name, **context},
                dedupe_key=f"event_reminder:{event_id}:email:{user.email}",
            )
            # A SECOND logical notification, not a second copy of the first.
            # Its own type, channel, template and dedupe key, so the email
            # arriving has no bearing on whether the push does — and somebody
            # with no subscribed device simply gets the email, which is what
            # already happened before push existed.
            #
            # Keyed on the USER rather than a device: two devices should show
            # one reminder each, not two logical messages. `_send_push` fans
            # out; this stays one row.
            self._notifications.notify(
                notification_type=NotificationType.EVENT_REMINDER_PUSH,
                recipient=str(user.id),
                context=context,
                dedupe_key=f"event_reminder:{event_id}:push:{user.id}",
            )
            count += 1
        logger.info(
            "notifications.reminders_sent", extra={"event_id": str(event_id), "count": count}
        )
        return count
