"""Read-side of this module (CQRS-lite), with cache-aside caching for the
two hottest reads: an organization's own detail page, and a user's own org
list. Cache keys/TTLs are documented in CLAUDE.md's Performance checklist —
keep that doc in sync with any change here.

`get_organization_detail_payload` caches the already-serializer-rendered
dict rather than a raw DTO. This couples it to schemas.py, which selectors
don't normally depend on — a deliberate, narrow exception: the cached value
IS the HTTP response body, and re-serializing a cached dict through the
serializer again would be pointless. Don't copy this pattern into a
selector that doesn't have the same justification.
"""

from __future__ import annotations

import uuid

from django.db.models import QuerySet

from core.ports.cache_port import CachePort

from .models import Organization
from .repositories import OrganizationRepository

ORG_DETAIL_TTL_SECONDS = 60
ORG_LIST_TTL_SECONDS = 30
_LOCK_TIMEOUT_SECONDS = 5


def _default_cache() -> CachePort:
    from config.di import cache_port

    return cache_port()


def org_detail_cache_key(organization_id: uuid.UUID | str) -> str:
    return f"org:{organization_id}"


def org_owner_list_cache_key(owner_id: uuid.UUID | str) -> str:
    return f"orgs:owner:{owner_id}"


def list_my_organizations(
    owner_id: uuid.UUID | str, *, organizations: OrganizationRepository | None = None
) -> QuerySet[Organization]:
    organizations = organizations or OrganizationRepository()
    return organizations.list_active_by_owner(owner_id)


def get_organization_detail_payload(
    organization_id: uuid.UUID | str,
    *,
    organizations: OrganizationRepository | None = None,
    cache: CachePort | None = None,
) -> dict | None:
    """Cache-aside read for GET /organizations/{id}. Returns None if the
    organization doesn't exist (or is soft-deleted) so the view can raise
    OrganizationNotFoundError itself.

    Stampede protection here is intentionally "basic" (per the project
    brief): a short non-blocking lock means only the request that wins it
    writes the cache entry, but every concurrent miss still reads the DB
    directly rather than queueing — acceptable because a detail-by-PK read
    is already a cheap, index-backed lookup, not the expensive case
    stampede protection usually guards."""
    from .schemas import OrganizationDetailSerializer

    organizations = organizations or OrganizationRepository()
    cache = cache or _default_cache()

    key = org_detail_cache_key(organization_id)
    cached = cache.get(key)
    if cached is not None:
        return cached

    # CachePort.lock() already namespaces its storage key with "lock:" —
    # passing `key` here (not `key` + a suffix) avoids a doubled prefix.
    with cache.lock(key, timeout_seconds=_LOCK_TIMEOUT_SECONDS) as acquired:
        cached = cache.get(key)
        if cached is not None:
            return cached

        org = organizations.get_active_by_id(organization_id)
        if org is None:
            return None

        payload = dict(OrganizationDetailSerializer(org).data)
        if acquired:
            cache.set(key, payload, timeout_seconds=ORG_DETAIL_TTL_SECONDS)
        return payload


def invalidate_organization_cache(
    organization_id: uuid.UUID | str, owner_id: uuid.UUID | str, *, cache: CachePort | None = None
) -> None:
    cache = cache or _default_cache()
    cache.delete(org_detail_cache_key(organization_id))
    cache.delete(org_owner_list_cache_key(owner_id))
