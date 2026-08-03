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
def test_list_for_event_is_n_plus_1_free(repo, event, make_ticket_type, django_assert_num_queries):
    """Two statements however many tiers there are: the tier list plus ONE
    prefetch for every schedule. The number that matters is that it does not
    grow with the tier count — five tiers here, and five phase schedules,
    still two queries."""
    for i in range(5):
        make_ticket_type(
            name=f"Tier {i}",
            price_minor=1000 * (i + 1),
            phases=[{"name": "Early bird", "price_minor": 500 * (i + 1), "quantity": 5}],
        )

    with django_assert_num_queries(2):
        tiers = list(repo.list_for_event(event.id))
        # Touching the prefetched schedules must not issue a query per tier.
        assert [len(t.phases.all()) for t in tiers] == [1] * 5


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
    back with the locked row. `price_minor` and the counters are in
    `_LOCK_FIELDS`; reading any of them must not trigger a deferred re-fetch,
    which would be a second query issued from inside the locked section."""
    from django.db import transaction

    tt = make_ticket_type(
        price_minor=50_000,
        phases=[{"name": "Early bird", "price_minor": 30_000, "quantity": 5}],
    )

    with transaction.atomic(), django_assert_num_queries(1):
        locked = repo.lock_for_update(tt.id)
        assert (locked.price_minor, locked.sold, locked.reserved) == (50_000, 0, 0)


@pytest.mark.django_db
def test_phases_for_pricing_is_the_one_extra_statement_in_the_lock(
    repo, make_ticket_type, django_assert_num_queries
):
    """The schedule is a child table, so it cannot ride the locked row's
    SELECT — it is exactly ONE more indexed statement, and it comes back in
    schedule order without a sort of its own (the `(ticket_type, position)`
    unique index provides it)."""
    from django.db import transaction

    tt = make_ticket_type(
        price_minor=50_000,
        phases=[
            {"name": "Early bird", "price_minor": 30_000, "quantity": 5},
            {"name": "Phase 1", "price_minor": 40_000, "quantity": 20},
        ],
    )

    with transaction.atomic(), django_assert_num_queries(2):
        repo.lock_for_update(tt.id)
        phases = repo.phases_for_pricing(tt.id)

    assert [(p.name, p.price_minor, p.position) for p in phases] == [
        ("Early bird", 30_000, 0),
        ("Phase 1", 40_000, 1),
    ]


@pytest.mark.django_db
def test_get_with_event_owner_loads_owner_without_walking_the_fks(
    repo, make_ticket_type, owner, django_assert_num_queries
):
    """One joined query for the tier + its event's organization, plus the one
    phases prefetch. Reading the owner two FKs deep must add nothing — that
    traversal is what `select_related` is here to pay for once."""
    tt = make_ticket_type()

    with django_assert_num_queries(2):
        loaded = repo.get_with_event_owner(tt.id)
        owner_id = loaded.event.organization.owner_id  # no extra query (select_related)
        assert list(loaded.phases.all()) == []  # prefetched, not lazily fetched

    assert str(owner_id) == str(owner.id)
