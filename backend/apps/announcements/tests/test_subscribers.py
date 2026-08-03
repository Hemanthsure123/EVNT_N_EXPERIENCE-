"""Subscribing to Curatix.

The themes: it is idempotent on the address, re-subscribing clears the leaving
timestamp rather than erroring, and the endpoint reveals nothing about whether
it already knew the address.
"""

from __future__ import annotations

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from apps.announcements.models import Subscriber
from apps.announcements.repositories import SubscriberRepository
from apps.announcements.services import SubscriptionService
from apps.announcements.throttling import SubscribeThrottle
from core.errors import InvalidInputError

SUBSCRIBE = "/api/v1/subscribers"
UNSUBSCRIBE = "/api/v1/subscribers/unsubscribe"


@pytest.fixture(autouse=True)
def _clean_throttle_cache():
    """Throttle counters live in Django's cache and do not reset between tests.

    Without this, the first test to spend the subscribe budget leaves the next
    one already throttled — a 429 in a test that has nothing to do with rate
    limiting, appearing only in a particular run order. Same precedent as
    `core/tests/test_throttling.py` and the accounts suite.
    """
    cache.clear()
    yield
    cache.clear()


@pytest.mark.django_db
class TestSubscribeService:
    def test_a_new_address_is_stored_lowercased(self, subscriptions: SubscriptionService) -> None:
        subscriptions.subscribe(email="  Reader@Example.COM ", source="homepage_card")

        stored = Subscriber.objects.get()
        assert stored.email == "reader@example.com"
        assert stored.source == "homepage_card"
        assert stored.unsubscribed_at is None

    def test_subscribing_twice_is_one_row(self, subscriptions: SubscriptionService) -> None:
        first = subscriptions.subscribe(email="reader@example.com", source="homepage_card")
        second = subscriptions.subscribe(email="READER@example.com", source="footer")

        assert first.id == second.id
        assert Subscriber.objects.count() == 1

    def test_a_repeat_does_not_rewrite_where_they_came_from(
        self, subscriptions: SubscriptionService
    ) -> None:
        """`source` is an acquisition record, not a record of the last button
        somebody happened to press."""
        subscriptions.subscribe(email="reader@example.com", source="homepage_card")
        subscriptions.subscribe(email="reader@example.com", source="footer")

        assert Subscriber.objects.get().source == "homepage_card"

    def test_resubscribing_clears_the_flag(self, subscriptions: SubscriptionService) -> None:
        subscriber = subscriptions.subscribe(email="reader@example.com")
        Subscriber.objects.filter(pk=subscriber.pk).update(unsubscribed_at=timezone.now())

        again = subscriptions.subscribe(email="reader@example.com")

        assert again.id == subscriber.id
        assert again.unsubscribed_at is None

    def test_unsubscribing_keeps_the_row(self, subscriptions: SubscriptionService) -> None:
        """Deleting would mean the address re-subscribes itself on the next
        list import, with no record that the person ever said no."""
        subscriber = subscriptions.subscribe(email="reader@example.com")

        subscriptions.unsubscribe(token=subscriptions.make_unsubscribe_token(subscriber.id))

        subscriber.refresh_from_db()
        assert Subscriber.objects.count() == 1
        assert subscriber.unsubscribed_at is not None

    def test_unsubscribing_twice_keeps_the_first_timestamp(
        self, subscriptions: SubscriptionService
    ) -> None:
        subscriber = subscriptions.subscribe(email="reader@example.com")
        token = subscriptions.make_unsubscribe_token(subscriber.id)

        subscriptions.unsubscribe(token=token)
        subscriber.refresh_from_db()
        first_time = subscriber.unsubscribed_at

        subscriptions.unsubscribe(token=token)
        subscriber.refresh_from_db()
        assert subscriber.unsubscribed_at == first_time

    def test_a_tampered_token_is_refused(self, subscriptions: SubscriptionService) -> None:
        subscriber = subscriptions.subscribe(email="reader@example.com")
        token = subscriptions.make_unsubscribe_token(subscriber.id)
        tampered = token[:-1] + ("x" if token[-1] != "x" else "y")

        with pytest.raises(InvalidInputError):
            subscriptions.unsubscribe(token=tampered)

        subscriber.refresh_from_db()
        assert subscriber.unsubscribed_at is None

    def test_a_token_for_a_vanished_row_completes_quietly(
        self, subscriptions: SubscriptionService
    ) -> None:
        """Which case the caller was in is not something a public endpoint
        gets to tell them."""
        subscriber = subscriptions.subscribe(email="reader@example.com")
        token = subscriptions.make_unsubscribe_token(subscriber.id)
        Subscriber.objects.all().delete()

        subscriptions.unsubscribe(token=token)  # no exception


@pytest.mark.django_db
class TestSubscribeEndpoint:
    def test_anyone_can_subscribe(self) -> None:
        response = APIClient().post(SUBSCRIBE, {"email": "reader@example.com"}, format="json")

        assert response.status_code == 200
        assert response.json() == {"status": "subscribed"}
        assert Subscriber.objects.count() == 1

    def test_a_repeat_is_indistinguishable_from_a_first_time(self) -> None:
        """The whole point: no 201-then-200, no "already subscribed", no
        different error. Otherwise this endpoint answers "does this address
        have an account here" for anyone who cares to ask."""
        client = APIClient()
        first = client.post(SUBSCRIBE, {"email": "reader@example.com"}, format="json")
        second = client.post(SUBSCRIBE, {"email": "reader@example.com"}, format="json")

        assert (first.status_code, first.json()) == (second.status_code, second.json())
        assert Subscriber.objects.count() == 1

    def test_the_full_leave_and_return_round_trip(self, subscriptions: SubscriptionService) -> None:
        client = APIClient()
        client.post(SUBSCRIBE, {"email": "reader@example.com"}, format="json")
        subscriber = Subscriber.objects.get()
        token = subscriptions.make_unsubscribe_token(subscriber.id)

        assert APIClient().post(UNSUBSCRIBE, {"token": token}, format="json").status_code == 200
        subscriber.refresh_from_db()
        assert subscriber.unsubscribed_at is not None

        client.post(SUBSCRIBE, {"email": "reader@example.com"}, format="json")
        subscriber.refresh_from_db()
        assert subscriber.unsubscribed_at is None

    def test_a_bad_address_is_refused(self) -> None:
        response = APIClient().post(SUBSCRIBE, {"email": "not-an-address"}, format="json")
        assert response.status_code == 400

    def test_source_must_be_a_slug(self) -> None:
        """It is written by an unauthenticated caller and read back in an
        operator's table."""
        response = APIClient().post(
            SUBSCRIBE,
            {"email": "reader@example.com", "source": "<script>alert(1)</script>"},
            format="json",
        )
        assert response.status_code == 400
        assert Subscriber.objects.count() == 0

    def test_a_tampered_unsubscribe_token_is_refused(self) -> None:
        response = APIClient().post(UNSUBSCRIBE, {"token": "nope.nope"}, format="json")
        assert response.status_code == 422


@pytest.mark.django_db
def test_the_public_write_is_throttled() -> None:
    """An unauthenticated INSERT with no ceiling is how a signup form becomes
    somebody else's subscription-bombing tool.

    Asserts against the SHIPPED rate rather than an override: DRF resolves the
    limit once per request, and a test that passed against an injected rate
    would prove nothing about the number that actually ships.
    """
    limit = int(SubscribeThrottle().num_requests)  # type: ignore[attr-defined]
    client = APIClient()

    codes = [
        client.post(SUBSCRIBE, {"email": f"r{index}@example.com"}, format="json").status_code
        for index in range(limit + 1)
    ]

    assert codes[:limit] == [200] * limit
    assert codes[-1] == 429
    assert Subscriber.objects.count() == limit


@pytest.mark.django_db
def test_an_authenticated_subscribe_still_only_writes_one_row(staff) -> None:
    """A signed-in visitor is not a different code path. The endpoint takes no
    user field at all, so nobody can subscribe an address on somebody else's
    behalf."""
    client = APIClient()
    client.force_authenticate(user=staff)

    assert client.post(SUBSCRIBE, {"email": "reader@example.com"}, format="json").status_code == 200
    assert SubscriberRepository().active_ids() == list(
        Subscriber.objects.values_list("id", flat=True)
    )
