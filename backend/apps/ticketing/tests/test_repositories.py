from __future__ import annotations

import pytest

from apps.ticketing.repositories import TicketTypeRepository


@pytest.fixture
def repo() -> TicketTypeRepository:
    return TicketTypeRepository()


@pytest.mark.django_db
def test_create_defaults(repo, event):
    tt = repo.create(event_id=event.id, name="Gold", price_minor=5000, quantity=50)

    assert tt.sold == 0
    assert tt.reserved == 0
    assert tt.version == 1
    assert tt.max_per_order == 10


@pytest.mark.django_db
def test_list_for_event_orders_cheapest_first(repo, event, make_ticket_type):
    make_ticket_type(name="Premium", price_minor=9000)
    make_ticket_type(name="Basic", price_minor=1000)
    make_ticket_type(name="Gold", price_minor=5000)

    names = [t.name for t in repo.list_for_event(event.id)]

    assert names == ["Basic", "Gold", "Premium"]


@pytest.mark.django_db
def test_list_for_event_excludes_soft_deleted(repo, make_ticket_type):
    from apps.ticketing.models import TicketType

    keep = make_ticket_type(name="Keep")
    gone = make_ticket_type(name="Gone")
    from django.utils import timezone

    TicketType.objects.filter(pk=gone.id).update(deleted_at=timezone.now())

    names = [t.name for t in repo.list_for_event(keep.event_id)]
    assert names == ["Keep"]


@pytest.mark.django_db
def test_list_for_event_is_one_query(repo, event, make_ticket_type, django_assert_num_queries):
    for i in range(5):
        make_ticket_type(name=f"Tier {i}", price_minor=1000 * (i + 1))

    with django_assert_num_queries(1):
        list(repo.list_for_event(event.id))


@pytest.mark.django_db
def test_exists_for_event(repo, event, make_ticket_type):
    assert repo.exists_for_event(event.id) is False
    make_ticket_type()
    assert repo.exists_for_event(event.id) is True


@pytest.mark.django_db
def test_aggregate_event_availability(repo, event, make_ticket_type):
    make_ticket_type(name="Basic", price_minor=1000, quantity=100, reserved=10)
    make_ticket_type(name="Gold", price_minor=5000, quantity=50, sold=5)

    agg = repo.aggregate_event_availability(event.id)

    assert agg["from_price_minor"] == 1000  # cheapest tier
    assert agg["tickets_available"] == (100 - 10) + (50 - 5)  # 90 + 45 = 135


@pytest.mark.django_db
def test_aggregate_event_availability_with_no_tiers(repo, event):
    agg = repo.aggregate_event_availability(event.id)

    assert agg["from_price_minor"] is None
    assert agg["tickets_available"] == 0


@pytest.mark.django_db
def test_update_if_version_matches(repo, make_ticket_type):
    tt = make_ticket_type(name="Old", price_minor=1000)

    applied = repo.update_if_version_matches(
        ticket_type_id=tt.id, expected_version=1, changes={"name": "New", "price_minor": 2000}
    )

    assert applied is True
    refreshed = repo.get_active_by_id(tt.id)
    assert refreshed.name == "New"
    assert refreshed.price_minor == 2000
    assert refreshed.version == 2


@pytest.mark.django_db
def test_update_if_version_matches_rejects_stale_version(repo, make_ticket_type):
    tt = make_ticket_type(name="Old")

    applied = repo.update_if_version_matches(
        ticket_type_id=tt.id, expected_version=99, changes={"name": "Hijacked"}
    )

    assert applied is False
    assert repo.get_active_by_id(tt.id).name == "Old"


@pytest.mark.django_db
def test_lock_for_update_loads_the_pricing_columns_in_the_same_query(
    repo, make_ticket_type, django_assert_num_queries
):
    """The price decision happens inside the lock, so its inputs must come
    back with the locked row. If they were dropped from `_LOCK_FIELDS` this
    would be two queries — the second one outside the lock's read, which is
    exactly the pre-lock read the module forbids."""
    from django.db import transaction

    tt = make_ticket_type(price_minor=50_000, early_bird_price_minor=30_000, early_bird_quantity=5)

    with transaction.atomic(), django_assert_num_queries(1):
        locked = repo.lock_for_update(tt.id)
        assert locked.early_bird_state().effective_price_minor == 30_000


@pytest.mark.django_db
def test_get_with_event_owner_loads_owner_in_one_query(
    repo, make_ticket_type, owner, django_assert_num_queries
):
    tt = make_ticket_type()

    with django_assert_num_queries(1):
        loaded = repo.get_with_event_owner(tt.id)
        owner_id = loaded.event.organization.owner_id  # no extra query (select_related)

    assert str(owner_id) == str(owner.id)
