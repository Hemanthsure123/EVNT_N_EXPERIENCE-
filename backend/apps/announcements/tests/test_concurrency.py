"""The two races this module actually has, proven rather than asserted.

`transaction=True` gives each thread a real committed transaction, so the
database constraint and the conditional UPDATE are exercised for real instead
of inside one rolled-back outer transaction where nothing ever conflicts.

Nothing here moves money, but both races produce something a person sees: a
second copy of the same email, or a click counted twice.
"""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import IntegrityError, connection
from django.utils import timezone

from apps.announcements.models import (
    Announcement,
    AnnouncementDelivery,
    AnnouncementKind,
    Subscriber,
)
from apps.announcements.repositories import (
    AnnouncementDeliveryRepository,
    SubscriberRepository,
)


def run_concurrently(fn, n: int) -> list:
    def worker(index: int):
        try:
            return fn(index)
        finally:
            # Each thread gets its own connection; leaking them exhausts the
            # pool and turns a race test into a flaky timeout.
            connection.close()

    with ThreadPoolExecutor(max_workers=n) as executor:
        return list(executor.map(worker, range(n)))


@pytest.fixture
def campaign(transactional_db) -> tuple[Announcement, Subscriber]:
    announcement = Announcement.objects.create(
        kind=AnnouncementKind.FEATURE, title="Concurrent campaign"
    )
    subscriber = Subscriber.objects.create(email="reader@example.com")
    return announcement, subscriber


@pytest.mark.django_db(transaction=True)
def test_one_person_gets_one_delivery_row_however_many_sends_race(campaign) -> None:
    """The unique constraint is the guarantee, not a check somebody remembered.

    Two operators pressing Send at the same moment — or one operator and a
    redelivered task — must not produce two rows for the same reader, because
    two rows is two emails and a doubled recipient count.
    """
    announcement, subscriber = campaign
    deliveries = AnnouncementDeliveryRepository()

    def queue(_index: int) -> int:
        return deliveries.create_for_subscribers(
            announcement_id=announcement.id, subscriber_ids=[subscriber.id]
        )

    created = run_concurrently(queue, 8)

    assert AnnouncementDelivery.objects.count() == 1
    # Exactly one racer inserted the row; every other one saw it already there.
    assert sum(created) == 1


@pytest.mark.django_db(transaction=True)
def test_the_constraint_holds_even_against_a_direct_insert(campaign) -> None:
    """Defense in depth: `ignore_conflicts` is how the application avoids the
    error, not what makes the duplicate impossible."""
    announcement, subscriber = campaign
    AnnouncementDelivery.objects.create(announcement=announcement, subscriber=subscriber)

    with pytest.raises(IntegrityError):
        AnnouncementDelivery.objects.create(announcement=announcement, subscriber=subscriber)


@pytest.mark.django_db(transaction=True)
def test_simultaneous_clicks_stamp_exactly_once(campaign) -> None:
    """The conditional UPDATE is the race guard.

    A reader double-tapping in a mail client, or a scanner and the person
    arriving together, must count as one click — otherwise `clicked` exceeds
    the number of people and `click_rate` is a number with nothing behind it.
    """
    announcement, subscriber = campaign
    delivery = AnnouncementDelivery.objects.create(announcement=announcement, subscriber=subscriber)
    deliveries = AnnouncementDeliveryRepository()

    def click(_index: int) -> bool:
        return deliveries.stamp_click(
            delivery_id=delivery.id,
            announcement_id=announcement.id,
            when=timezone.now(),
        )

    results = run_concurrently(click, 8)

    # EXACTLY ONE update landed; the other seven re-evaluated the WHERE against
    # the committed first and matched zero rows.
    assert sum(results) == 1
    delivery.refresh_from_db()
    assert delivery.clicked_at is not None


@pytest.mark.django_db(transaction=True)
def test_simultaneous_subscribes_of_one_address_are_one_row(transactional_db) -> None:
    """A double-submitted form must not 500 on the loser. `get_or_create`
    catches the unique violation and re-reads the winner."""
    subscribers = SubscriberRepository()

    def subscribe(_index: int) -> uuid.UUID:
        return subscribers.upsert_active(
            email="reader@example.com", source="homepage_card", user_id=None
        ).id

    ids = run_concurrently(subscribe, 8)

    assert Subscriber.objects.count() == 1
    assert len(set(ids)) == 1
