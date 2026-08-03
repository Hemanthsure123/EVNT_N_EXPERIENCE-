"""The one case a check-then-insert gets wrong: two Follow presses landing at
the same instant.

`transaction=True` so each worker thread runs a REAL committed transaction
against Postgres — under the default `@pytest.mark.django_db` every
"transaction" is a savepoint on one shared connection, which cannot reproduce
genuine concurrency and so cannot exercise the unique constraint's race guard
at all.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import connection

from apps.accounts.repositories import UserRepository
from apps.organizations.models import OrganizationFollow
from apps.organizations.repositories import OrganizationFollowRepository, OrganizationRepository
from apps.organizations.services import OrganizationFollowService


def _run_concurrently(fn, n: int) -> list:
    """Run fn(i) on n threads. Each thread closes its own DB connection
    afterwards so the pool doesn't leak connections between workers."""

    def worker(i: int):
        try:
            return fn(i)
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=n) as executor:
        return list(executor.map(worker, range(n)))


@pytest.fixture
def service() -> OrganizationFollowService:
    return OrganizationFollowService(
        follows=OrganizationFollowRepository(), organizations=OrganizationRepository()
    )


@pytest.mark.django_db(transaction=True)
def test_concurrent_follows_of_the_same_organization_create_exactly_one_row(service):
    """Twelve simultaneous presses, one follower.

    A check-then-insert passes all twelve checks before any of them writes.
    What makes this correct is `org_follow_user_org_uniq` plus `get_or_create`
    re-reading on the IntegrityError — so every caller is told it succeeded
    (which it did: the user follows the organization) and exactly one row
    exists.
    """
    owner = UserRepository().create_user(email="race-owner@example.com", password="s3cur3pass")
    follower = UserRepository().create_user(email="race-follower@example.com", password="s3cur3p")
    org = OrganizationRepository().create(owner_id=owner.id, name="Race Co")

    states = _run_concurrently(
        lambda _i: service.follow(user_id=follower.id, organization_id=org.id), 12
    )

    assert all(state.is_following for state in states)
    assert OrganizationFollow.objects.filter(user=follower, organization=org).count() == 1
    # And the count nobody may invent is 1, not 12 — every caller re-counted
    # from the rows rather than incrementing its own read.
    assert OrganizationFollowRepository().count_followers(org.id) == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_follow_and_unfollow_leave_no_orphan(service):
    """The follow/unfollow pair racing each other. Whichever lands last wins,
    but the table must never end up with more than one row for the pair —
    which is the failure a second "notification subscription" table would make
    possible."""
    owner = UserRepository().create_user(email="race2-owner@example.com", password="s3cur3pass")
    follower = UserRepository().create_user(email="race2-follower@example.com", password="s3cur3p")
    org = OrganizationRepository().create(owner_id=owner.id, name="Race Two Co")

    def press(i: int) -> bool:
        if i % 2:
            return service.unfollow(user_id=follower.id, organization_id=org.id).is_following
        return service.follow(user_id=follower.id, organization_id=org.id).is_following

    _run_concurrently(press, 12)

    assert OrganizationFollow.objects.filter(user=follower, organization=org).count() <= 1
