import pytest

from apps.accounts.repositories import UserRepository
from apps.organizations.repositories import OrganizationRepository
from apps.organizations.selectors import (
    get_organization_detail_payload,
    invalidate_organization_cache,
    org_detail_cache_key,
    org_owner_list_cache_key,
)
from core.adapters.local.locmem_cache import LocMemCacheAdapter


@pytest.fixture
def owner():
    return UserRepository().create_user(email="sel-owner@example.com", password="s3cur3pass")


@pytest.fixture
def cache() -> LocMemCacheAdapter:
    return LocMemCacheAdapter()


@pytest.mark.django_db
def test_returns_none_for_a_missing_organization(cache):
    missing_id = "00000000-0000-0000-0000-000000000000"
    assert get_organization_detail_payload(missing_id, cache=cache) is None


@pytest.mark.django_db
def test_populates_the_cache_on_a_miss(owner, cache):
    org = OrganizationRepository().create(owner_id=owner.id, name="Acme Events")

    payload = get_organization_detail_payload(org.id, cache=cache)

    assert payload is not None
    assert payload["name"] == "Acme Events"
    assert cache.get(org_detail_cache_key(org.id)) == payload


@pytest.mark.django_db
def test_serves_from_cache_without_hitting_the_db(owner, cache, django_assert_num_queries):
    org = OrganizationRepository().create(owner_id=owner.id, name="Acme Events")
    get_organization_detail_payload(org.id, cache=cache)  # warm it

    with django_assert_num_queries(0):
        payload = get_organization_detail_payload(org.id, cache=cache)

    assert payload is not None
    assert payload["name"] == "Acme Events"


@pytest.mark.django_db
def test_still_returns_data_when_the_stampede_lock_is_already_held(owner, cache):
    org = OrganizationRepository().create(owner_id=owner.id, name="Acme Events")
    key = org_detail_cache_key(org.id)
    # Simulate a concurrent request already rebuilding this key.
    cache.set(f"lock:{key}", "1", timeout_seconds=30)

    payload = get_organization_detail_payload(org.id, cache=cache)

    assert payload is not None
    assert payload["name"] == "Acme Events"
    # The request that didn't win the lock still serves correct data, but
    # deliberately doesn't write the cache (avoids two concurrent writers).
    assert cache.get(key) is None


@pytest.mark.django_db
def test_invalidate_organization_cache_clears_both_detail_and_list_keys(owner, cache):
    org = OrganizationRepository().create(owner_id=owner.id, name="Acme Events")
    get_organization_detail_payload(org.id, cache=cache)
    cache.set(org_owner_list_cache_key(owner.id), {"data": []}, timeout_seconds=30)

    invalidate_organization_cache(org.id, owner.id, cache=cache)

    assert cache.get(org_detail_cache_key(org.id)) is None
    assert cache.get(org_owner_list_cache_key(owner.id)) is None
