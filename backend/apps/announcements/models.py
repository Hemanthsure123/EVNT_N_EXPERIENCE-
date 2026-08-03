"""Platform announcements: maintenance windows, launches, emergencies.

SCHEDULING IS DECLARATIVE — `starts_at`/`ends_at`, filtered at read time —
rather than a job that flips an `is_live` flag. A maintenance banner that had
to wait for a cron tick to appear is exactly the banner that does not appear
during the incident it was written for. A window also survives a restart and
lets an operator queue a release note days ahead.

PLACEMENT is an explicit column rather than an inference from type: "this is
maintenance, so show it everywhere" is a rule that breaks the first time
someone wants to warn organizers about a payout delay without alarming
attendees.

THE EMAIL SIDE lives here too: `Subscriber` (who agreed to hear from us) and
`AnnouncementDelivery` (one row per person per announcement — the send record
AND the engagement measurement). An announcement is one piece of copy; the
banner and the email are two channels for it, so they share a row rather than
drifting into two systems with two wordings of the same notice.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models

TITLE_MAX = 120
BODY_MAX = 400


class AnnouncementKind(models.TextChoices):
    MAINTENANCE = "maintenance", "Maintenance"
    FEATURE = "feature", "New feature"
    PROMOTION = "promotion", "Promotion"
    EMERGENCY = "emergency", "Emergency"


class Placement(models.TextChoices):
    HOME = "home", "Attendee homepage"
    ORGANIZER = "organizer", "Organizer dashboard"
    ADMIN = "admin", "Admin console"
    ALL = "all", "Everywhere"


class Announcement(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=20, choices=AnnouncementKind.choices)
    placement = models.CharField(max_length=20, choices=Placement.choices, default=Placement.HOME)
    title = models.CharField(max_length=TITLE_MAX)
    body = models.CharField(max_length=BODY_MAX, blank=True, default="")
    #: An optional call to action. Stored as a path, not a full URL — an
    #: operator-controlled banner that can point anywhere on the internet is a
    #: phishing vector on the platform's own front page.
    link_path = models.CharField(max_length=200, blank=True, default="")
    link_label = models.CharField(max_length=40, blank=True, default="")

    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    #: A kill switch independent of the window, so an operator can pull a live
    #: banner without editing its schedule.
    is_active = models.BooleanField(default=True)
    #: An emergency notice should not be dismissible; a promotion should.
    dismissible = models.BooleanField(default=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "announcements_announcement"
        ordering = ["-created_at"]
        indexes = [
            # The read path's exact query: what is showing here, right now.
            models.Index(
                fields=["placement", "starts_at"],
                name="ann_live_idx",
                condition=models.Q(is_active=True),
            ),
        ]

    def __str__(self) -> str:
        return f"{self.kind}: {self.title}"


SOURCE_MAX = 40


def normalize_email(value: str) -> str:
    """Trim and case-fold, so one person is one row.

    The local part of an address is technically case-SENSITIVE per RFC 5321,
    but no mail provider anyone actually uses treats it that way. Storing both
    `Ann@example.com` and `ann@example.com` would mean the same person gets
    every campaign twice and can only ever unsubscribe one of them — the
    single worst outcome for a list nobody is obliged to be on.

    Called from `Subscriber.save()` AND from the repository, deliberately.
    `save()` alone is not enough: `bulk_create()` and `QuerySet.update()` both
    bypass it, and a normalisation that only holds on one write path is a
    normalisation that does not hold.
    """
    return value.strip().lower()


class Subscriber(models.Model):
    """Somebody who asked to hear from Curatix by email.

    ── UNSUBSCRIBING SETS A TIMESTAMP; IT NEVER DELETES THE ROW ─────────────

    Deleting would mean the address re-subscribes itself on the next campaign
    the moment anyone re-imports a list, and we would have no record that the
    person ever said no. The row is the evidence of the decision, so it has to
    outlive the decision.

    ── `user` IS NULLABLE AND `SET_NULL` ───────────────────────────────────

    A subscription is an agreement about an ADDRESS, not about an account.
    Most people subscribe from the marketing card before they have signed up,
    and somebody who later deletes their account has not thereby withdrawn
    consent to the newsletter — that is a separate decision they make with the
    unsubscribe link. `CASCADE` would silently revoke a live subscription as a
    side effect of an unrelated deletion.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="announcement_subscriptions",
    )
    #: Where they subscribed from — "homepage_card", "footer", "event_page".
    #: Constrained to a slug at the boundary (see schemas.py) because it is
    #: written by an unauthenticated caller and read back in an admin table.
    source = models.CharField(max_length=SOURCE_MAX, blank=True, default="")
    #: Null means subscribed. See the class docstring for why this is a
    #: timestamp rather than a deletion or a boolean: an operator asking "when
    #: did they leave" is a question a boolean cannot answer.
    unsubscribed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "announcements_subscriber"
        ordering = ["-created_at"]
        indexes = [
            # The broadcast's recipient query, exactly: every active
            # subscriber, oldest first. Partial on `unsubscribed_at IS NULL`
            # so the index holds only the rows a campaign will ever read, and
            # ordered by `created_at` so the chunked fan-out is deterministic
            # without a sort.
            models.Index(
                fields=["created_at"],
                name="subscriber_active_idx",
                condition=models.Q(unsubscribed_at__isnull=True),
            ),
        ]

    def __str__(self) -> str:
        return self.email

    def save(self, *args, **kwargs) -> None:
        self.email = normalize_email(self.email)
        super().save(*args, **kwargs)


class AnnouncementDelivery(models.Model):
    """One announcement, one subscriber: the send record and the measurement.

    ── THE UNIQUE CONSTRAINT IS THE POINT ──────────────────────────────────

    `UNIQUE (announcement, subscriber)` is what makes "send this announcement"
    safe to press twice. A retried broadcast, a duplicated task delivery and
    an operator clicking the button again all collide on the database rather
    than on a check somebody remembered to write — and re-broadcasting after
    the list has grown reaches exactly the people who were not reached before.

    ── WHAT IS DELIBERATELY NOT HERE: AN OPEN PIXEL ────────────────────────

    There is no `opened_at`, and there will not be one. A tracking pixel is
    blocked outright by Gmail's image proxy caching, by every mail client that
    defaults images off, and by Apple Mail Privacy Protection — which fetches
    the pixel for EVERY message whether or not anyone looked at it. An "opens"
    figure would therefore be wrong in a knowable direction (inflated by Apple,
    deflated by everyone with images off) and wrong by an amount nobody can
    estimate. This platform does not put numbers on screen that it cannot
    stand behind, so the measurement is CLICKS: somebody pressed a link and
    arrived, which is a fact about a request we served.

    `clicked_at` carries one known bias of its own and it is written down
    here rather than glossed: corporate mail scanners pre-fetch links, so a
    small number of clicks belong to a security appliance rather than a
    person. That is a much smaller distortion than the pixel's and it is in
    one direction, but it is not zero — `click_rate` is an engagement signal,
    not a headcount.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    announcement = models.ForeignKey(
        Announcement, on_delete=models.CASCADE, related_name="deliveries"
    )
    subscriber = models.ForeignKey(Subscriber, on_delete=models.CASCADE, related_name="deliveries")
    #: The `notifications.NotificationLog` row that owns the actual send.
    #:
    #: A plain UUID rather than a ForeignKey, deliberately. The delivery row is
    #: created FIRST (in the operator's transaction) and handed to
    #: `notifications` afterwards, so for a moment there is legitimately no log
    #: to point at; and a hard FK would make this module's schema depend on
    #: another module's table for a column that is a trace, not a relationship
    #: anything traverses. Null means "created, not yet handed over".
    notification_log_id = models.UUIDField(null=True, blank=True)
    #: First click wins — see `AnnouncementDeliveryRepository.stamp_click`.
    clicked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "announcements_delivery"
        constraints = [
            models.UniqueConstraint(
                fields=["announcement", "subscriber"], name="announcement_delivery_unique"
            ),
        ]
        indexes = [
            # The fan-out query, exactly: this announcement's rows that have
            # not been handed to notifications yet, oldest first. Partial, so
            # the index empties itself as the campaign completes instead of
            # growing with every delivery ever made.
            models.Index(
                fields=["announcement", "created_at"],
                name="anndelivery_pending_idx",
                condition=models.Q(notification_log_id__isnull=True),
            ),
        ]

    def __str__(self) -> str:
        return f"{self.announcement_id} -> {self.subscriber_id}"
