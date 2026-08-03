"""ORM access for announcements — the banner rows and the email side."""

from __future__ import annotations

import datetime as dt
import uuid
from collections.abc import Sequence

from django.db.models import Count, Exists, OuterRef, Q, QuerySet

from .models import Announcement, AnnouncementDelivery, Placement, Subscriber, normalize_email


class AnnouncementRepository:
    def list_live(self, *, placement: str, now: dt.datetime) -> QuerySet[Announcement]:
        """What is showing at this placement, right now.

        `ALL` is included alongside the requested placement, so a platform-wide
        notice needs one row rather than three.
        """
        return (
            Announcement.objects.filter(
                Q(starts_at__isnull=True) | Q(starts_at__lte=now),
                Q(ends_at__isnull=True) | Q(ends_at__gt=now),
                Q(placement=placement) | Q(placement=Placement.ALL),
                is_active=True,
            )
            .only(
                "id",
                "kind",
                "placement",
                "title",
                "body",
                "link_path",
                "link_label",
                "dismissible",
                "starts_at",
                "ends_at",
            )
            .order_by("-created_at")
        )

    def list_all(self) -> QuerySet[Announcement]:
        """The admin view: scheduled and expired rows included, because that
        is precisely what an operator is managing."""
        return Announcement.objects.all()

    def get(self, announcement_id: uuid.UUID | str) -> Announcement | None:
        return Announcement.objects.filter(pk=announcement_id).first()

    def create(self, **fields) -> Announcement:
        return Announcement.objects.create(**fields)

    def update(self, announcement_id: uuid.UUID | str, **fields) -> bool:
        return Announcement.objects.filter(pk=announcement_id).update(**fields) == 1

    def delete(self, announcement_id: uuid.UUID | str) -> int:
        deleted, _ = Announcement.objects.filter(pk=announcement_id).delete()
        return deleted


class SubscriberRepository:
    def get_by_id(self, subscriber_id: uuid.UUID | str) -> Subscriber | None:
        return Subscriber.objects.filter(pk=subscriber_id).first()

    def upsert_active(
        self, *, email: str, source: str, user_id: uuid.UUID | str | None
    ) -> Subscriber:
        """Subscribe this address, or reactivate it. Never raises on a repeat.

        `get_or_create` is the race guard: it catches the unique violation a
        concurrent identical subscribe produces and re-reads the winner, in its
        own savepoint, so the loser's insert is the only thing that rolls back.
        A check-then-insert would leave a window both requests pass, and the
        loser would surface a 500 on what is, to the person pressing the
        button, an entirely successful subscribe.
        """
        email = normalize_email(email)
        subscriber, created = Subscriber.objects.get_or_create(
            email=email, defaults={"source": source, "user_id": user_id}
        )
        if created:
            return subscriber

        # Re-subscribing clears the flag. `source` is deliberately NOT
        # overwritten: it records where somebody first came from, and rewriting
        # it on every repeat press would turn an acquisition record into a
        # record of the last button they happened to hit.
        #
        # `user_id` is only ever filled IN, never replaced — learning the
        # account behind an address is new information, whereas overwriting one
        # account with another would silently reassign somebody's subscription.
        fields: dict[str, object] = {"unsubscribed_at": None}
        if user_id is not None and subscriber.user_id is None:
            fields["user_id"] = user_id
        Subscriber.objects.filter(pk=subscriber.pk).update(**fields)
        subscriber.refresh_from_db()
        return subscriber

    def mark_unsubscribed(self, subscriber_id: uuid.UUID | str, *, when: dt.datetime) -> bool:
        """Idempotent: a second unsubscribe matches zero rows and keeps the
        ORIGINAL timestamp, which is the one that answers "when did they
        leave"."""
        return (
            Subscriber.objects.filter(pk=subscriber_id, unsubscribed_at__isnull=True).update(
                unsubscribed_at=when
            )
            == 1
        )

    def active_ids(self) -> list[uuid.UUID]:
        """Every current subscriber's id, oldest first.

        Ids only — the fan-out inserts a row per recipient and needs nothing
        else, and pulling whole rows for a large list is how a broadcast
        becomes the slowest thing the admin console does. Matches
        `subscriber_active_idx` exactly (partial on active, ordered by
        created_at), so this is an index-only scan of precisely the rows a
        campaign will use.
        """
        return list(
            Subscriber.objects.filter(unsubscribed_at__isnull=True)
            .order_by("created_at")
            .values_list("id", flat=True)
        )


#: How many delivery rows go in one INSERT. Large enough that a 50k list is a
#: handful of statements rather than 50k, small enough that no single statement
#: holds a lock or a parameter list long enough to matter.
INSERT_CHUNK = 1000


class AnnouncementDeliveryRepository:
    def create_for_subscribers(
        self, *, announcement_id: uuid.UUID | str, subscriber_ids: Sequence[uuid.UUID]
    ) -> int:
        """Insert one row per subscriber, skipping anyone already recorded.

        `ignore_conflicts` leans on `announcement_delivery_unique`, which is
        what makes pressing Send twice safe: the second press inserts rows only
        for subscribers who joined since the first.

        ── COUNTING WHAT WAS ACTUALLY CREATED ──────────────────────────────

        With `ignore_conflicts=True` Postgres does not report which rows it
        kept, so `bulk_create`'s return value cannot answer this. Counting the
        table before and after cannot either — two operators pressing Send
        together each see zero before and one after, and BOTH report having
        reached a person only one of them reached.

        So the primary keys are generated HERE and the created rows are
        counted by probing for exactly those ids. A row carrying one of our
        UUIDs can only have come from our INSERT; a concurrent press generated
        different ones. The figure is then exact under any amount of
        contention, which matters because it is the receipt an operator reads
        to decide whether the campaign has already gone out.
        """
        created = 0
        for start in range(0, len(subscriber_ids), INSERT_CHUNK):
            chunk = subscriber_ids[start : start + INSERT_CHUNK]
            rows = [
                AnnouncementDelivery(
                    id=uuid.uuid4(),
                    announcement_id=announcement_id,
                    subscriber_id=subscriber_id,
                )
                for subscriber_id in chunk
            ]
            AnnouncementDelivery.objects.bulk_create(rows, ignore_conflicts=True)
            created += AnnouncementDelivery.objects.filter(id__in=[row.id for row in rows]).count()
        return created

    def count_for_announcement(self, announcement_id: uuid.UUID | str) -> int:
        return AnnouncementDelivery.objects.filter(announcement_id=announcement_id).count()

    def list_pending(
        self, *, announcement_id: uuid.UUID | str, limit: int
    ) -> list[AnnouncementDelivery]:
        """Rows not yet handed to notifications, oldest first.

        `select_related("subscriber")` because the very next thing the caller
        does is read `subscriber.email` for every row — without it this is a
        textbook N+1 with the batch size as N.
        """
        return list(
            AnnouncementDelivery.objects.filter(
                announcement_id=announcement_id, notification_log_id__isnull=True
            )
            .select_related("subscriber")
            .only(
                "id",
                "announcement_id",
                "subscriber_id",
                "created_at",
                "subscriber__id",
                "subscriber__email",
                "subscriber__unsubscribed_at",
            )
            .order_by("created_at")[:limit]
        )

    def attach_notification_log(
        self, delivery_id: uuid.UUID | str, notification_log_id: uuid.UUID | str
    ) -> bool:
        """Conditional on the column still being null, so two fan-outs racing
        the same row cannot overwrite each other's trace."""
        return (
            AnnouncementDelivery.objects.filter(
                pk=delivery_id, notification_log_id__isnull=True
            ).update(notification_log_id=notification_log_id)
            == 1
        )

    def stamp_click(
        self,
        *,
        delivery_id: uuid.UUID | str,
        announcement_id: uuid.UUID | str,
        when: dt.datetime,
    ) -> bool:
        """First click wins. Returns True only for the click that landed.

        ONE conditional `UPDATE ... WHERE clicked_at IS NULL`, not a
        read-modify-write and not a row lock. The predicate IS the race guard:
        Postgres serialises concurrent updates to a row, so the second one
        re-evaluates the WHERE against the committed first and matches zero
        rows. A `SELECT ... FOR UPDATE` would be the same answer with a lock
        held on the click path, which is a person waiting on a redirect.

        Scoped to the announcement as well as the delivery so a link edited to
        point at another campaign's id cannot stamp a row it does not belong
        to.
        """
        return (
            AnnouncementDelivery.objects.filter(
                pk=delivery_id, announcement_id=announcement_id, clicked_at__isnull=True
            ).update(clicked_at=when)
            == 1
        )

    def aggregate_engagement(self, announcement_id: uuid.UUID | str) -> dict[str, int]:
        """The four figures the admin shows, in ONE query, computed in Postgres.

        Counting rows in Python would mean shipping every delivery for a
        campaign to the application to add them up — for the announcement most
        worth measuring, that is the whole list.

        `delivered` is a CORRELATED `EXISTS` against the notification log by
        primary key rather than an `IN (SELECT ... WHERE status = 'sent')`.
        The latter would build the set of every sent notification on the
        platform to intersect with a few thousand rows; this one is a PK probe
        per delivery. It reads notifications' table directly (a one-way
        dependency, announcements -> notifications, which is the same
        direction the fan-out already runs) because the alternative is a
        second module growing a reporting method only this one calls.
        """
        from apps.notifications.models import NotificationLog, NotificationStatus

        sent = NotificationLog.objects.filter(
            pk=OuterRef("notification_log_id"), status=NotificationStatus.SENT
        )
        return AnnouncementDelivery.objects.filter(announcement_id=announcement_id).aggregate(
            recipients=Count("id"),
            delivered=Count("id", filter=Q(Exists(sent))),
            clicked=Count("id", filter=Q(clicked_at__isnull=False)),
        )
