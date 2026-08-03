"""Business rules for announcements — the banner, the list, and the campaign.

Three services, because they answer to three different people:

- `AnnouncementService` — an operator writing a banner. Every write is a staff
  action, audited.
- `SubscriptionService` — a visitor asking to hear from us. Unauthenticated,
  idempotent, and deliberately silent about what it already knew.
- `BroadcastService` — an operator sending one announcement to that list, and
  the fan-out that hands each recipient to `notifications`.
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlencode

from django.core import signing
from django.db import transaction
from django.utils import timezone

from core.audit import record_audit
from core.errors import InvalidInputError, NotFoundError
from core.ports.task_queue_port import TaskQueuePort
from core.unit_of_work import UnitOfWork

from .exceptions import BroadcastNotConfigured, NotSendable
from .links import require_site_path
from .models import Announcement, Subscriber
from .repositories import (
    AnnouncementDeliveryRepository,
    AnnouncementRepository,
    SubscriberRepository,
)
from .selectors import invalidate_announcements

logger = logging.getLogger(__name__)


class AnnouncementService:
    def __init__(self, *, announcements: AnnouncementRepository) -> None:
        self._announcements = announcements

    @staticmethod
    def _check_window(starts_at, ends_at) -> None:
        if starts_at and ends_at and ends_at <= starts_at:
            raise InvalidInputError("The window must end after it starts.")

    @staticmethod
    def _check_link(path: str) -> None:
        """A same-origin path, never an absolute URL.

        An operator-controlled banner that can point anywhere on the internet
        is a phishing vector on the platform's own front page — and the person
        placing it may be a compromised admin account rather than a colleague.
        The same rule the sign-in `?next=` validator follows, and the same rule
        the emailed tracked redirect applies: one implementation, in links.py,
        because the second copy is always the one that drifts.
        """
        if not path:
            return
        require_site_path(path, field="link_path")

    def create(self, *, actor_id: uuid.UUID | str, **fields) -> Announcement:
        self._check_window(fields.get("starts_at"), fields.get("ends_at"))
        self._check_link(fields.get("link_path", ""))

        with UnitOfWork():
            announcement = self._announcements.create(created_by_id=actor_id, **fields)
            record_audit(
                actor_id=str(actor_id),
                action="announcement.published",
                target_type="announcement",
                target_id=str(announcement.id),
                metadata={"kind": announcement.kind, "placement": announcement.placement},
            )
            transaction.on_commit(invalidate_announcements)
        return announcement

    def update(
        self, *, actor_id: uuid.UUID | str, announcement_id: uuid.UUID | str, **fields
    ) -> Announcement:
        existing = self._announcements.get(announcement_id)
        if existing is None:
            raise NotFoundError("No such announcement.")
        self._check_window(
            fields.get("starts_at", existing.starts_at), fields.get("ends_at", existing.ends_at)
        )
        self._check_link(fields.get("link_path", existing.link_path))

        with UnitOfWork():
            if not self._announcements.update(announcement_id, **fields):
                raise NotFoundError("No such announcement.")
            record_audit(
                actor_id=str(actor_id),
                action="announcement.updated",
                target_type="announcement",
                target_id=str(announcement_id),
                metadata={"fields": sorted(fields.keys())},
            )
            transaction.on_commit(invalidate_announcements)

        updated = self._announcements.get(announcement_id)
        if updated is None:  # pragma: no cover - deleted mid-request
            raise NotFoundError("No such announcement.")
        return updated

    def delete(self, *, actor_id: uuid.UUID | str, announcement_id: uuid.UUID | str) -> None:
        with UnitOfWork():
            if not self._announcements.delete(announcement_id):
                raise NotFoundError("No such announcement.")
            record_audit(
                actor_id=str(actor_id),
                action="announcement.deleted",
                target_type="announcement",
                target_id=str(announcement_id),
            )
            transaction.on_commit(invalidate_announcements)


# --- subscribing ----------------------------------------------------------

#: The salt for the unsubscribe token. Django's signer namespaces by salt, so a
#: token minted here can never be replayed against another signed value in the
#: codebase even though both are keyed by `SECRET_KEY`.
UNSUBSCRIBE_SALT = "announcements.unsubscribe"


class SubscriptionService:
    """Joining and leaving the Curatix list.

    ── IT NEVER REVEALS WHETHER IT ALREADY KNEW THE ADDRESS ────────────────

    `subscribe` returns the same thing for a new address, a repeat and a
    reactivation. The endpoint is public and unauthenticated, so any
    distinguishable outcome — a 201 versus a 200, "already subscribed" versus
    "subscribed", even a materially different amount of work — is an oracle
    for "does this person have an account here", answerable at whatever rate
    the throttle allows. The service returns the row because the caller may
    need it; the view is what makes the response uniform.
    """

    def __init__(self, *, subscribers: SubscriberRepository) -> None:
        self._subscribers = subscribers

    def subscribe(
        self, *, email: str, source: str = "", user_id: uuid.UUID | str | None = None
    ) -> Subscriber:
        """Idempotent on the address. Re-subscribing CLEARS `unsubscribed_at`.

        Clearing rather than refusing is the point: somebody who left in March
        and presses subscribe in July has changed their mind, and an error
        saying "you already unsubscribed" is both useless to them and a
        confirmation that we hold a record of their address.
        """
        return self._subscribers.upsert_active(email=email, source=source, user_id=user_id)

    def make_unsubscribe_token(self, subscriber_id: uuid.UUID | str) -> str:
        """A signed, self-describing token for the link in an email.

        The subscriber id alone would let anybody unsubscribe anybody by
        guessing — and while a UUID is not guessable, a token is what makes
        that a statement about cryptography rather than about entropy. There
        is no expiry: an unsubscribe link has to keep working in a mailbox
        somebody opens two years later, and the only thing it can do is honour
        a request we would honour anyway.
        """
        return signing.Signer(salt=UNSUBSCRIBE_SALT).sign(str(subscriber_id))

    def unsubscribe(self, *, token: str, when: dt.datetime | None = None) -> None:
        """Honour an unsubscribe link. Idempotent, and silent about the outcome.

        A bad signature is `InvalidInputError` — that is a tampered or
        truncated link, not a person, and it is worth surfacing. Everything
        else (a subscriber row that has since been deleted, a second click on
        the same link) completes quietly: the caller's request has been
        honoured either way, and telling them which case they were in reveals
        whether the address is on the list.
        """
        try:
            subscriber_id = signing.Signer(salt=UNSUBSCRIBE_SALT).unsign(token)
        except signing.BadSignature as exc:
            raise InvalidInputError("That unsubscribe link is not valid.") from exc

        self._subscribers.mark_unsubscribed(subscriber_id, when=when or timezone.now())


# --- clicking through from an email --------------------------------------


class ClickTrackingService:
    """Stamps the click and hands back where the reader asked to go.

    The measurement is a side effect of a redirect somebody wanted anyway,
    which is what makes it a real number rather than an inferred one. See
    `AnnouncementDelivery`'s docstring for why clicks are measured and opens
    are not.
    """

    def __init__(self, *, deliveries: AnnouncementDeliveryRepository, site_url: str) -> None:
        self._deliveries = deliveries
        self._site_url = site_url.rstrip("/")

    def record_click(
        self,
        *,
        announcement_id: uuid.UUID | str,
        to: str,
        delivery_id: uuid.UUID | str | None,
    ) -> str:
        """Validate the destination, stamp the click, return the absolute URL.

        Validation happens FIRST. A tampered `to` must be refused whether or
        not it carries a valid delivery id, and stamping before checking would
        record an attacker's probe as engagement.

        An unknown, absent or already-clicked delivery is not an error. Links
        get forwarded; a colleague who opens somebody else's copy should still
        arrive at the page, and a second click from the same reader is one
        person, not two. Only the first stamp counts, and the redirect is
        identical in every case.
        """
        path = require_site_path(to, field="to")
        if delivery_id is not None:
            self._deliveries.stamp_click(
                delivery_id=delivery_id,
                announcement_id=announcement_id,
                when=timezone.now(),
            )
        # A relative Location is valid HTTP and is what we fall back to when no
        # public origin is configured — better than prefixing a guessed host,
        # which would send the reader somewhere that is not us.
        return f"{self._site_url}{path}" if self._site_url else path


# --- broadcasting ---------------------------------------------------------

#: The `notifications.NotificationType` value an announcement email renders as.
#: Declared here because THIS module is what asks for it; `notifications` holds
#: the matching enum member and the template (see the module's wiring notes).
#: The two literals must agree — `test_broadcast.py` asserts this value, so a
#: change on either side has somewhere to fail.
ANNOUNCEMENT_NOTIFICATION_TYPE = "announcement"

BROADCAST_TASK = "announcements.broadcast"

#: Recipients handed to `notifications` per task run. Each one is a render, a
#: dedupe read and a claim insert, so this bounds the work a single task does
#: and the fan-out re-enqueues itself while there is more. A campaign of any
#: size therefore progresses in short, resumable steps rather than one task
#: that either finishes or loses everything.
BROADCAST_BATCH = 500


class Notifier(Protocol):
    """The one method this module uses from `NotificationService`.

    Structural, and injected, for two reasons. It keeps the dependency
    one-way and explicit — announcements asks notifications to send; nothing
    in notifications knows this module exists. And it lets the fan-out be
    tested against a recording double instead of against notifications'
    template registry, which is a different module's contract and a different
    module's test.
    """

    def notify(
        self,
        *,
        notification_type: str,
        recipient: str,
        context: dict,
        dedupe_key: str,
        delay_seconds: int = 0,
    ) -> Any: ...


@dataclass(frozen=True)
class BroadcastResult:
    """What the operator's Send press actually did."""

    announcement_id: str
    #: Every delivery row for this announcement, including ones an earlier
    #: press created.
    recipients: int
    #: Rows this press created — i.e. people not already reached.
    newly_queued: int


class BroadcastService:
    def __init__(
        self,
        *,
        announcements: AnnouncementRepository,
        subscribers: SubscriberRepository,
        deliveries: AnnouncementDeliveryRepository,
        subscriptions: SubscriptionService,
        notifier: Notifier,
        task_queue: TaskQueuePort,
        tracking_base_url: str,
        site_url: str,
    ) -> None:
        self._announcements = announcements
        self._subscribers = subscribers
        self._deliveries = deliveries
        self._subscriptions = subscriptions
        self._notifier = notifier
        self._task_queue = task_queue
        self._tracking_base_url = tracking_base_url.rstrip("/")
        self._site_url = site_url.rstrip("/")

    # --- the operator's press ------------------------------------------

    def queue_broadcast(
        self, *, actor_id: uuid.UUID | str, announcement_id: uuid.UUID | str
    ) -> BroadcastResult:
        """Create the delivery rows and enqueue the fan-out. Sends nothing.

        THIS ENDPOINT DOES NOT SEND EMAIL, deliberately. It writes one row per
        recipient inside one transaction and hands the actual delivery to a
        task, because rendering and claiming tens of thousands of messages
        inside an admin request is how the console times out with half a
        campaign committed and no record of which half.

        Safe to press twice: `announcement_delivery_unique` makes the second
        press insert rows only for subscribers who were not already recorded,
        and re-enqueues the fan-out, which picks up anything a previous run
        left pending. That is also the operator's retry when a send failed.
        """
        self._require_configured()
        announcement = self._announcements.get(announcement_id)
        if announcement is None:
            raise NotFoundError("No such announcement.")
        self._check_sendable(announcement)

        recipient_ids = self._subscribers.active_ids()

        with UnitOfWork():
            created = self._deliveries.create_for_subscribers(
                announcement_id=announcement.id, subscriber_ids=recipient_ids
            )
            total = self._deliveries.count_for_announcement(announcement.id)
            record_audit(
                actor_id=str(actor_id),
                action="announcement.broadcast_queued",
                target_type="announcement",
                target_id=str(announcement.id),
                metadata={"recipients": total, "newly_queued": created},
            )
            # AFTER commit, never before: a task that starts while the rows are
            # still uncommitted finds nothing to send and exits reporting
            # success, and the campaign is silently never delivered.
            transaction.on_commit(
                lambda: self._task_queue.enqueue(
                    BROADCAST_TASK, {"announcement_id": str(announcement.id)}
                )
            )

        logger.info(
            "announcements.broadcast_queued",
            extra={
                "announcement_id": str(announcement.id),
                "recipients": total,
                "newly_queued": created,
            },
        )
        return BroadcastResult(
            announcement_id=str(announcement.id), recipients=total, newly_queued=created
        )

    # --- the fan-out (a task, never a request) --------------------------

    def send_pending(
        self, announcement_id: uuid.UUID | str, *, limit: int = BROADCAST_BATCH
    ) -> int:
        """Hand up to `limit` unsent deliveries to `notifications`.

        Re-enqueues itself while a full batch came back, so one press drives a
        list of any size in bounded steps. Idempotent at both layers: a row is
        skipped once it carries a log id, and `notify` dedupes on its own key,
        so a task redelivered by the queue cannot produce a second email.
        """
        announcement = self._announcements.get(announcement_id)
        if announcement is None:
            # The campaign was deleted mid-send. Nothing to do and nothing
            # wrong — the delivery rows went with it (CASCADE).
            logger.warning(
                "announcements.broadcast.announcement_missing",
                extra={"announcement_id": str(announcement_id)},
            )
            return 0

        pending = self._deliveries.list_pending(announcement_id=announcement.id, limit=limit)
        if not pending:
            return 0

        sent = 0
        for delivery in pending:
            subscriber = delivery.subscriber
            if subscriber.unsubscribed_at is not None:
                # They left between the press and the send, and the send is
                # what the consent governs — not the queueing. The row stays
                # pending forever and is skipped on every run, which is both
                # the right outcome and a visible one: it shows in `recipients`
                # and not in `delivered`, which is exactly what happened.
                # Marking it handled would need a `notification_log_id`, and
                # that column means "a message was really sent".
                continue
            log = self._notifier.notify(
                notification_type=ANNOUNCEMENT_NOTIFICATION_TYPE,
                recipient=subscriber.email,
                context=self._context_for(announcement, delivery.id, subscriber),
                # Keyed on the delivery, which is unique per (announcement,
                # subscriber) by construction. Keying on the address instead
                # would be identical today and wrong the moment somebody
                # re-subscribes with the same address after a list rebuild.
                dedupe_key=f"announcement:{announcement.id}:email:{subscriber.email}",
            )
            if log is None:
                continue
            self._deliveries.attach_notification_log(delivery.id, log.id)
            sent += 1

        if len(pending) == limit:
            self._task_queue.enqueue(BROADCAST_TASK, {"announcement_id": str(announcement.id)})

        logger.info(
            "announcements.broadcast.batch",
            extra={"announcement_id": str(announcement.id), "handed_over": sent},
        )
        return sent

    # --- helpers --------------------------------------------------------

    def _require_configured(self) -> None:
        missing = []
        if not self._tracking_base_url:
            missing.append("PUBLIC_API_BASE_URL")
        if not self._site_url:
            missing.append("PUBLIC_SITE_URL")
        if missing:
            raise BroadcastNotConfigured(
                "This deployment cannot send announcement email yet: "
                f"{', '.join(missing)} is not set.",
                missing=missing,
            )

    @staticmethod
    def _check_sendable(announcement: Announcement) -> None:
        """Two refusals, both about not emailing something already over.

        An email cannot be pulled back the way a banner can, so the checks a
        banner does not need are exactly the ones that matter here.
        """
        if not announcement.is_active:
            raise NotSendable("This announcement is switched off; turn it on before sending.")
        if announcement.ends_at is not None and announcement.ends_at <= timezone.now():
            raise NotSendable("This announcement's window has already ended.")

    def _context_for(
        self, announcement: Announcement, delivery_id: uuid.UUID, subscriber: Subscriber
    ) -> dict:
        """Everything the email needs, with every link already absolute.

        The call-to-action is the TRACKED url, not the raw path — that
        indirection is the entire measurement. An announcement with no
        `link_path` gets no button and no tracked link, and its click rate is
        honestly zero because there was nothing to click.
        """
        tracked = (
            self.tracked_url(announcement.id, delivery_id, announcement.link_path)
            if announcement.link_path
            else ""
        )
        return {
            "title": announcement.title,
            "body": announcement.body,
            "kind": announcement.kind,
            "url": tracked,
            "link_label": announcement.link_label,
            "unsubscribe_url": self.unsubscribe_url(subscriber.id),
        }

    def tracked_url(
        self, announcement_id: uuid.UUID | str, delivery_id: uuid.UUID | str, path: str
    ) -> str:
        query = urlencode({"to": path, "d": str(delivery_id)})
        return f"{self._tracking_base_url}/api/v1/a/{announcement_id}/r?{query}"

    def unsubscribe_url(self, subscriber_id: uuid.UUID | str) -> str:
        token = self._subscriptions.make_unsubscribe_token(subscriber_id)
        return f"{self._site_url}/unsubscribe?{urlencode({'token': token})}"
