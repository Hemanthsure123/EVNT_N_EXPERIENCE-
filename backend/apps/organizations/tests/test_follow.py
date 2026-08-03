"""Following an organization: the repository queries, the service rules, and
the HTTP surface.

The concurrent double-follow — the one case a check-then-insert gets wrong —
is in test_concurrency.py, because it needs a real committed transaction per
thread.
"""

from typing import cast

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import User
from apps.accounts.repositories import UserRepository
from apps.organizations.models import OrganizationFollow
from apps.organizations.repositories import OrganizationFollowRepository, OrganizationRepository
from apps.organizations.services import OrganizationFollowService


def _access_token_for(user: User) -> str:
    # simplejwt's own type hints are inaccurate for for_user() — see the
    # same note in apps/accounts/services.py.
    return str(cast(RefreshToken, RefreshToken.for_user(user)).access_token)


@pytest.fixture
def owner():
    return UserRepository().create_user(email="follow-owner@example.com", password="s3cur3pass")


@pytest.fixture
def follower():
    return UserRepository().create_user(email="follower@example.com", password="s3cur3pass")


@pytest.fixture
def org(owner):
    return OrganizationRepository().create(owner_id=owner.id, name="Acme Events")


@pytest.fixture
def follows() -> OrganizationFollowRepository:
    return OrganizationFollowRepository()


@pytest.fixture
def service(follows) -> OrganizationFollowService:
    # Built directly from repositories, never via config.di — a unit test must
    # not depend on which backends Django settings selected.
    return OrganizationFollowService(follows=follows, organizations=OrganizationRepository())


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def authed_client(api_client, follower) -> APIClient:
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {_access_token_for(follower)}")
    return api_client


# --- the service's rules ---------------------------------------------------


@pytest.mark.django_db
def test_following_twice_leaves_one_row_and_one_follower(service, follower, org):
    first = service.follow(user_id=follower.id, organization_id=org.id)
    second = service.follow(user_id=follower.id, organization_id=org.id)

    assert first.is_following is True
    assert second.is_following is True
    assert second.follower_count == 1
    assert OrganizationFollow.objects.filter(user=follower, organization=org).count() == 1


@pytest.mark.django_db
def test_a_new_follow_notifies_by_default(service, follower, org):
    state = service.follow(user_id=follower.id, organization_id=org.id)

    assert state.notify is True


@pytest.mark.django_db
def test_a_follow_can_opt_out_of_notifications_up_front(service, follower, org):
    state = service.follow(user_id=follower.id, organization_id=org.id, notify=False)

    assert state.is_following is True
    assert state.notify is False


@pytest.mark.django_db
def test_pressing_follow_again_does_not_re_enable_muted_notifications(service, follower, org):
    """A repeat press with no `notify` in the body means "no opinion". Silently
    turning notifications back on would be a subscription nobody asked for."""
    service.follow(user_id=follower.id, organization_id=org.id, notify=False)

    state = service.follow(user_id=follower.id, organization_id=org.id)

    assert state.notify is False


@pytest.mark.django_db
def test_a_repeat_follow_that_does_carry_notify_applies_it(service, follower, org):
    service.follow(user_id=follower.id, organization_id=org.id, notify=False)

    state = service.follow(user_id=follower.id, organization_id=org.id, notify=True)

    assert state.notify is True


@pytest.mark.django_db
def test_unfollowing_is_idempotent(service, follower, org):
    service.follow(user_id=follower.id, organization_id=org.id)

    first = service.unfollow(user_id=follower.id, organization_id=org.id)
    second = service.unfollow(user_id=follower.id, organization_id=org.id)

    assert first.is_following is False
    assert first.follower_count == 0
    assert second.is_following is False
    assert not OrganizationFollow.objects.filter(user=follower, organization=org).exists()


@pytest.mark.django_db
def test_notify_toggles_without_dropping_the_follow(service, follower, org):
    service.follow(user_id=follower.id, organization_id=org.id)

    muted = service.set_notify(user_id=follower.id, organization_id=org.id, notify=False)
    assert muted.is_following is True
    assert muted.notify is False
    assert muted.follower_count == 1

    unmuted = service.set_notify(user_id=follower.id, organization_id=org.id, notify=True)
    assert unmuted.notify is True
    assert OrganizationFollow.objects.filter(user=follower, organization=org).count() == 1


@pytest.mark.django_db
def test_setting_notify_without_following_is_not_found(service, follower, org):
    from apps.organizations.exceptions import NotFollowingError

    with pytest.raises(NotFollowingError):
        service.set_notify(user_id=follower.id, organization_id=org.id, notify=True)


@pytest.mark.django_db
def test_following_a_missing_organization_is_not_found(service, follower):
    from apps.organizations.exceptions import OrganizationNotFoundError

    with pytest.raises(OrganizationNotFoundError):
        service.follow(user_id=follower.id, organization_id="00000000-0000-0000-0000-000000000000")


@pytest.mark.django_db
def test_following_a_soft_deleted_organization_is_not_found(service, follower, org):
    from apps.organizations.exceptions import OrganizationNotFoundError

    org.deleted_at = timezone.now()
    org.save(update_fields=["deleted_at"])

    with pytest.raises(OrganizationNotFoundError):
        service.follow(user_id=follower.id, organization_id=org.id)


# --- the fan-out -----------------------------------------------------------


@pytest.mark.django_db
def test_the_fan_out_returns_only_notify_true_followers_in_one_query(
    service, follows, org, django_assert_num_queries
):
    wants = UserRepository().create_user(email="wants@example.com", password="s3cur3pass")
    muted = UserRepository().create_user(email="muted@example.com", password="s3cur3pass")
    other = UserRepository().create_user(email="elsewhere@example.com", password="s3cur3pass")
    other_org = OrganizationRepository().create(owner_id=other.id, name="Other Co")

    service.follow(user_id=wants.id, organization_id=org.id)
    service.follow(user_id=muted.id, organization_id=org.id, notify=False)
    service.follow(user_id=other.id, organization_id=other_org.id)

    with django_assert_num_queries(1):
        ids = follows.follower_user_ids_for_notify(org.id)

    assert ids == [wants.id]


@pytest.mark.django_db
def test_the_follower_count_includes_followers_who_muted(service, follows, org):
    """Somebody who follows without notifications is still a follower — the
    count is of the audience, not of the mailing list."""
    wants = UserRepository().create_user(email="count-a@example.com", password="s3cur3pass")
    muted = UserRepository().create_user(email="count-b@example.com", password="s3cur3pass")

    service.follow(user_id=wants.id, organization_id=org.id)
    state = service.follow(user_id=muted.id, organization_id=org.id, notify=False)

    assert state.follower_count == 2
    assert follows.follower_user_ids_for_notify(org.id) == [wants.id]


# --- HTTP ------------------------------------------------------------------


@pytest.mark.django_db
def test_follow_endpoint_returns_the_state_and_is_never_cached(authed_client, org):
    resp = authed_client.post(f"/api/v1/organizations/{org.id}/follow", {}, format="json")

    assert resp.status_code == 200
    body = resp.json()
    assert body["is_following"] is True
    assert body["notify"] is True
    assert body["follower_count"] == 1
    assert body["organization_id"] == str(org.id)
    assert resp.headers["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
def test_follow_endpoint_accepts_a_notify_flag(authed_client, org):
    resp = authed_client.post(
        f"/api/v1/organizations/{org.id}/follow", {"notify": False}, format="json"
    )

    assert resp.json()["notify"] is False


@pytest.mark.django_db
def test_follow_endpoint_is_idempotent_over_http(authed_client, org):
    first = authed_client.post(f"/api/v1/organizations/{org.id}/follow", {}, format="json")
    second = authed_client.post(f"/api/v1/organizations/{org.id}/follow", {}, format="json")

    assert first.status_code == second.status_code == 200
    assert second.json()["follower_count"] == 1


@pytest.mark.django_db
def test_unfollow_endpoint_is_idempotent_over_http(authed_client, org):
    authed_client.post(f"/api/v1/organizations/{org.id}/follow", {}, format="json")

    first = authed_client.delete(f"/api/v1/organizations/{org.id}/follow")
    second = authed_client.delete(f"/api/v1/organizations/{org.id}/follow")

    assert first.status_code == second.status_code == 200
    assert first.json()["is_following"] is False
    assert second.json()["follower_count"] == 0


@pytest.mark.django_db
def test_patch_toggles_notify_only(authed_client, org, follower):
    authed_client.post(f"/api/v1/organizations/{org.id}/follow", {}, format="json")

    resp = authed_client.patch(
        f"/api/v1/organizations/{org.id}/follow", {"notify": False}, format="json"
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "organization_id": str(org.id),
        "is_following": True,
        "notify": False,
        "follower_count": 1,
    }
    assert OrganizationFollow.objects.get(user=follower, organization=org).notify is False


@pytest.mark.django_db
def test_patch_without_a_follow_is_404(authed_client, org):
    resp = authed_client.patch(
        f"/api/v1/organizations/{org.id}/follow", {"notify": True}, format="json"
    )

    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_following"


@pytest.mark.django_db
def test_patch_requires_the_notify_field(authed_client, org):
    authed_client.post(f"/api/v1/organizations/{org.id}/follow", {}, format="json")

    resp = authed_client.patch(f"/api/v1/organizations/{org.id}/follow", {}, format="json")

    assert resp.status_code == 400


@pytest.mark.django_db
def test_get_follow_state_reports_the_callers_own_state(authed_client, org):
    before = authed_client.get(f"/api/v1/organizations/{org.id}/follow")
    assert before.json()["is_following"] is False
    assert before.json()["notify"] is False

    authed_client.post(f"/api/v1/organizations/{org.id}/follow", {}, format="json")

    after = authed_client.get(f"/api/v1/organizations/{org.id}/follow")
    assert after.json()["is_following"] is True
    assert after.headers["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
def test_one_users_follow_is_not_another_users(api_client, org, follower):
    stranger = UserRepository().create_user(email="stranger@example.com", password="s3cur3pass")

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {_access_token_for(follower)}")
    api_client.post(f"/api/v1/organizations/{org.id}/follow", {}, format="json")

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {_access_token_for(stranger)}")
    body = api_client.get(f"/api/v1/organizations/{org.id}/follow").json()

    assert body["is_following"] is False
    # ...but the crowd-size number is the same for both of them.
    assert body["follower_count"] == 1


@pytest.mark.django_db
def test_the_follow_endpoints_require_authentication(api_client, org):
    assert api_client.get(f"/api/v1/organizations/{org.id}/follow").status_code == 401
    assert (
        api_client.post(f"/api/v1/organizations/{org.id}/follow", {}, format="json").status_code
        == 401
    )
    assert api_client.delete(f"/api/v1/organizations/{org.id}/follow").status_code == 401


@pytest.mark.django_db
def test_following_an_unknown_organization_over_http_is_404(authed_client):
    missing = "00000000-0000-0000-0000-000000000000"

    resp = authed_client.post(f"/api/v1/organizations/{missing}/follow", {}, format="json")

    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "organization_not_found"


# --- the organization payload ---------------------------------------------


@pytest.mark.django_db
def test_the_organization_payload_carries_a_real_follower_count(authed_client, org, service):
    a = UserRepository().create_user(email="det-a@example.com", password="s3cur3pass")
    b = UserRepository().create_user(email="det-b@example.com", password="s3cur3pass")
    service.follow(user_id=a.id, organization_id=org.id)
    service.follow(user_id=b.id, organization_id=org.id)

    body = authed_client.get(f"/api/v1/organizations/{org.id}").json()

    assert body["follower_count"] == 2


@pytest.mark.django_db
def test_the_shared_organization_payload_never_carries_per_user_follow_state(authed_client, org):
    """`org:{id}` is one cached body shared by every reader. If `is_following`
    were in it, the second visitor would be told they follow an organization
    they have never heard of."""
    authed_client.post(f"/api/v1/organizations/{org.id}/follow", {}, format="json")

    body = authed_client.get(f"/api/v1/organizations/{org.id}").json()

    assert "is_following" not in body
    assert "notify" not in body


@pytest.mark.django_db
def test_the_organization_detail_read_is_still_one_query_with_the_count_on_it(
    authed_client, org, django_assert_num_queries
):
    """The follower count rides on the detail row's own lookup as a join, so
    the documented query budget for this endpoint does not move."""
    url = f"/api/v1/organizations/{org.id}"

    with django_assert_num_queries(2):  # the JWT user lookup + the org SELECT
        assert authed_client.get(url).status_code == 200

    with django_assert_num_queries(1):  # auth only; the org comes from cache
        assert authed_client.get(url).status_code == 200


# --- GET /me/following -----------------------------------------------------


@pytest.mark.django_db
def test_following_list_returns_the_callers_organizations_only(authed_client, follower, service):
    other_owner = UserRepository().create_user(email="list-owner@example.com", password="s3cur3p")
    repo = OrganizationRepository()
    mine = repo.create(owner_id=other_owner.id, name="Followed Co")
    theirs = repo.create(owner_id=other_owner.id, name="Unfollowed Co")
    stranger = UserRepository().create_user(email="list-stranger@example.com", password="s3cur3p")

    service.follow(user_id=follower.id, organization_id=mine.id, notify=False)
    service.follow(user_id=stranger.id, organization_id=theirs.id)

    resp = authed_client.get("/api/v1/organizations/me/following")

    assert resp.status_code == 200
    rows = resp.json()["data"]
    assert [row["name"] for row in rows] == ["Followed Co"]
    assert rows[0]["organization_id"] == str(mine.id)
    assert rows[0]["notify"] is False
    assert rows[0]["followed_at"]
    assert resp.headers["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
def test_following_list_hides_soft_deleted_organizations(authed_client, follower, service):
    owner = UserRepository().create_user(email="gone-owner@example.com", password="s3cur3pass")
    gone = OrganizationRepository().create(owner_id=owner.id, name="Gone Co")
    service.follow(user_id=follower.id, organization_id=gone.id)

    gone.deleted_at = timezone.now()
    gone.save(update_fields=["deleted_at"])

    assert authed_client.get("/api/v1/organizations/me/following").json()["data"] == []


@pytest.mark.django_db
def test_following_list_is_two_queries_however_many_organizations_are_on_it(
    authed_client, follower, service, django_assert_num_queries
):
    """The N+1 guard: the organization card fields come back through the same
    join, so a page of ten costs exactly what a page of one does."""
    owner = UserRepository().create_user(email="many-owner@example.com", password="s3cur3pass")
    repo = OrganizationRepository()
    for i in range(10):
        org = repo.create(owner_id=owner.id, name=f"Org {i}")
        service.follow(user_id=follower.id, organization_id=org.id)

    with django_assert_num_queries(2):  # the JWT user lookup + one page query
        resp = authed_client.get("/api/v1/organizations/me/following")

    assert len(resp.json()["data"]) == 10


@pytest.mark.django_db
def test_following_list_requires_authentication(api_client):
    assert api_client.get("/api/v1/organizations/me/following").status_code == 401
