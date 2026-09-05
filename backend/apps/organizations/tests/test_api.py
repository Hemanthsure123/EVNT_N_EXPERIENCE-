from typing import cast

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import User
from apps.accounts.repositories import UserRepository
from apps.organizations.repositories import OrganizationRepository


def _access_token_for(user: User) -> str:
    # simplejwt's own type hints are inaccurate for for_user() — see the
    # same note in apps/accounts/services.py.
    return str(cast(RefreshToken, RefreshToken.for_user(user)).access_token)


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def owner():
    return UserRepository().create_user(email="api-owner@example.com", password="s3cur3pass")


@pytest.fixture
def authed_client(api_client, owner) -> APIClient:
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {_access_token_for(owner)}")
    return api_client


@pytest.mark.django_db
def test_create_organization_returns_201(authed_client, owner):
    resp = authed_client.post("/api/v1/organizations/", {"name": "Acme Events"}, format="json")

    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Acme Events"
    assert body["owner_id"] == str(owner.id)
    assert body["verified_level"] == "unverified"


@pytest.mark.django_db
def test_create_organization_requires_authentication(api_client):
    resp = api_client.post("/api/v1/organizations/", {"name": "Acme Events"}, format="json")

    assert resp.status_code == 401


@pytest.mark.django_db
def test_create_organization_rejects_blank_name(authed_client):
    resp = authed_client.post("/api/v1/organizations/", {"name": ""}, format="json")

    assert resp.status_code == 400


@pytest.mark.django_db
def test_get_organization_detail_returns_200_with_etag_and_cache_control(authed_client, owner):
    org = OrganizationRepository().create(owner_id=owner.id, name="Acme Events")

    resp = authed_client.get(f"/api/v1/organizations/{org.id}")

    assert resp.status_code == 200
    assert resp.json()["name"] == "Acme Events"
    assert resp.headers["ETag"]
    assert resp.headers["Cache-Control"] == "private, max-age=30"


@pytest.mark.django_db
def test_get_organization_detail_returns_304_when_if_none_match_matches(authed_client, owner):
    org = OrganizationRepository().create(owner_id=owner.id, name="Acme Events")

    first = authed_client.get(f"/api/v1/organizations/{org.id}")
    etag = first.headers["ETag"]

    second = authed_client.get(f"/api/v1/organizations/{org.id}", HTTP_IF_NONE_MATCH=etag)

    assert second.status_code == 304


@pytest.mark.django_db
def test_get_organization_detail_returns_404_for_missing_org(authed_client):
    missing_id = "00000000-0000-0000-0000-000000000000"

    resp = authed_client.get(f"/api/v1/organizations/{missing_id}")

    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "organization_not_found"


@pytest.mark.django_db
def test_organization_detail_hits_the_db_once_on_a_cold_cache_then_zero_more_times_when_warm(
    authed_client, owner, django_assert_num_queries
):
    org = OrganizationRepository().create(owner_id=owner.id, name="Acme Events")
    url = f"/api/v1/organizations/{org.id}"

    # cold: 1 query to resolve the JWT-authenticated user, 1 to load the org
    with django_assert_num_queries(2):
        resp = authed_client.get(url)
    assert resp.status_code == 200

    # warm: only the auth lookup remains — the org itself comes from Redis
    with django_assert_num_queries(1):
        resp = authed_client.get(url)
    assert resp.status_code == 200


@pytest.mark.django_db
def test_the_detail_payload_never_carries_the_raw_payout_account_id(authed_client, owner):
    """The organization's Razorpay linked-account id is not in a shared body.

    `org:{id}` is ONE cached payload read by every signed-in visitor — a
    follower opening a brand they follow gets the same body its owner does. It
    used to include `payout_account_id`, and organization ids are not secret:
    every public event card carries `organization_id`, so any account could
    read a public event, lift the id, and ask this endpoint for that business's
    payout account.
    """
    repository = OrganizationRepository()
    org = repository.create(owner_id=owner.id, name="Acme Events")
    org.payout_account_id = "acc_TESTLINKED123"
    org.save(update_fields=["payout_account_id"])

    resp = authed_client.get(f"/api/v1/organizations/{org.id}")

    assert resp.status_code == 200
    body = resp.json()
    assert "payout_account_id" not in body
    assert "acc_TESTLINKED123" not in resp.content.decode()
    # What the product actually needs, and all it ever needed.
    assert body["payout_account_linked"] is True


@pytest.mark.django_db
def test_a_stranger_reading_a_warm_cache_gets_no_payout_account_either(
    api_client, authed_client, owner
):
    """The regression that matters, because the payload is SHARED and CACHED.

    A redaction applied per-request but not to the cached body would refuse the
    first reader and serve every one after them from Redis.
    """
    repository = OrganizationRepository()
    org = repository.create(owner_id=owner.id, name="Acme Events")
    org.payout_account_id = "acc_TESTLINKED456"
    org.save(update_fields=["payout_account_id"])

    assert authed_client.get(f"/api/v1/organizations/{org.id}").status_code == 200  # warms it

    stranger = UserRepository().create_user(email="stranger@example.com", password="s3cur3pass")
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {_access_token_for(stranger)}")

    resp = api_client.get(f"/api/v1/organizations/{org.id}")

    assert resp.status_code == 200
    assert "acc_TESTLINKED456" not in resp.content.decode()


@pytest.mark.django_db
def test_payout_account_linked_is_false_before_one_is_linked(authed_client, owner):
    """False, not absent: the signup screen branches on it to offer the link
    step, and a missing key would read as 'already linked' under a truthiness
    check somewhere down the line."""
    org = OrganizationRepository().create(owner_id=owner.id, name="Acme Events")

    body = authed_client.get(f"/api/v1/organizations/{org.id}").json()

    assert body["payout_account_linked"] is False


@pytest.mark.django_db
def test_patch_organization_by_owner_updates_and_invalidates_the_cache(
    authed_client, owner, django_capture_on_commit_callbacks
):
    org = OrganizationRepository().create(owner_id=owner.id, name="Old Name")
    authed_client.get(f"/api/v1/organizations/{org.id}")  # warm the cache

    with django_capture_on_commit_callbacks(execute=True):
        resp = authed_client.patch(
            f"/api/v1/organizations/{org.id}", {"name": "New Name"}, format="json"
        )
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"

    # cache was invalidated by the write, so this GET reflects the update
    # rather than serving the pre-update cached payload.
    follow_up = authed_client.get(f"/api/v1/organizations/{org.id}")
    assert follow_up.json()["name"] == "New Name"


@pytest.mark.django_db
def test_patch_organization_by_non_owner_returns_403(api_client, owner):
    org = OrganizationRepository().create(owner_id=owner.id, name="Acme Events")
    other = UserRepository().create_user(email="intruder@example.com", password="s3cur3pass")

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {_access_token_for(other)}")

    resp = api_client.patch(f"/api/v1/organizations/{org.id}", {"name": "Hijacked"}, format="json")

    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "not_organization_owner"


@pytest.mark.django_db
def test_list_my_organizations_returns_only_mine(authed_client, owner):
    OrganizationRepository().create(owner_id=owner.id, name="Mine")
    other = UserRepository().create_user(email="other-owner@example.com", password="s3cur3pass")
    OrganizationRepository().create(owner_id=other.id, name="Theirs")

    resp = authed_client.get("/api/v1/organizations/")

    assert resp.status_code == 200
    names = [item["name"] for item in resp.json()["data"]]
    assert names == ["Mine"]


@pytest.mark.django_db
def test_list_my_organizations_requires_authentication(api_client):
    resp = api_client.get("/api/v1/organizations/")

    assert resp.status_code == 401


@pytest.mark.django_db
def test_list_my_organizations_first_page_is_served_from_cache_on_repeat_requests(
    authed_client, owner, django_assert_num_queries
):
    OrganizationRepository().create(owner_id=owner.id, name="Acme Events")
    url = "/api/v1/organizations/"

    with django_assert_num_queries(2):  # auth lookup + the list query
        first = authed_client.get(url)
    assert first.status_code == 200

    with django_assert_num_queries(1):  # auth lookup only; list served from cache
        second = authed_client.get(url)
    assert second.json() == first.json()


@pytest.mark.django_db
def test_creating_an_organization_invalidates_the_owners_list_cache(
    authed_client, owner, django_capture_on_commit_callbacks
):
    authed_client.get("/api/v1/organizations/")  # warms the (empty) list cache

    with django_capture_on_commit_callbacks(execute=True):
        create_resp = authed_client.post(
            "/api/v1/organizations/", {"name": "Acme Events"}, format="json"
        )
    assert create_resp.status_code == 201

    follow_up = authed_client.get("/api/v1/organizations/")
    names = [item["name"] for item in follow_up.json()["data"]]
    assert names == ["Acme Events"]


@pytest.mark.django_db
def test_submit_verification_returns_201(authed_client, owner):
    org = OrganizationRepository().create(owner_id=owner.id, name="Acme Events")

    resp = authed_client.post(f"/api/v1/organizations/{org.id}/verification", {}, format="json")

    assert resp.status_code == 201
    assert resp.json()["status"] == "pending"


@pytest.mark.django_db
def test_reading_verification_before_submitting_is_a_404(authed_client, owner):
    """A brand-new organization, not an error — it is what tells the UI to
    offer the form rather than a status."""
    org = OrganizationRepository().create(owner_id=owner.id, name="Acme Events")

    resp = authed_client.get(f"/api/v1/organizations/{org.id}/verification")

    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "verification_not_found"


@pytest.mark.django_db
def test_the_owner_can_read_a_rejection_and_its_reason(authed_client, owner):
    """The whole point of the endpoint. A rejected organization has NO
    pending record, so the operator-facing query cannot answer this — and a
    rejection with no reason shown is one the organizer cannot act on."""
    repo = OrganizationRepository()
    org = repo.create(owner_id=owner.id, name="Acme Events")
    record = repo.create_verification_record(organization_id=org.id)
    record.status = "rejected"
    record.notes = "Registration certificate was unreadable."
    repo.save_verification_record(record)

    body = authed_client.get(f"/api/v1/organizations/{org.id}/verification").json()

    assert body["status"] == "rejected"
    assert body["notes"] == "Registration certificate was unreadable."


@pytest.mark.django_db
def test_the_latest_submission_wins_over_an_older_one(authed_client, owner):
    """Re-submitting after a rejection must show PENDING, not the rejection
    it replaced — otherwise the organizer sees the old refusal forever."""
    repo = OrganizationRepository()
    org = repo.create(owner_id=owner.id, name="Acme Events")
    first = repo.create_verification_record(organization_id=org.id)
    first.status = "rejected"
    repo.save_verification_record(first)
    authed_client.post(f"/api/v1/organizations/{org.id}/verification", {}, format="json")

    assert (
        authed_client.get(f"/api/v1/organizations/{org.id}/verification").json()["status"]
        == "pending"
    )


@pytest.mark.django_db
def test_verification_status_is_never_shared_cached(authed_client, owner):
    org = OrganizationRepository().create(owner_id=owner.id, name="Acme Events")
    authed_client.post(f"/api/v1/organizations/{org.id}/verification", {}, format="json")

    resp = authed_client.get(f"/api/v1/organizations/{org.id}/verification")

    assert "no-store" in resp["Cache-Control"]


@pytest.mark.django_db
def test_link_payout_account_returns_200_and_reports_the_link(authed_client, owner):
    """The response confirms payouts can now reach them — it does not echo the
    identifier back.

    It used to assert the raw `payout_account_id` in the body. That field is
    gone from this serializer because the same serializer renders the SHARED,
    CACHED `GET /organizations/{id}` payload that any signed-in reader can
    fetch. The linking organizer needs to know the step succeeded, which is
    what the boolean says; nothing in the product ever displayed the id.
    """
    repository = OrganizationRepository()
    org = repository.create(owner_id=owner.id, name="Acme Events")

    resp = authed_client.post(f"/api/v1/organizations/{org.id}/payout-account", {}, format="json")

    assert resp.status_code == 200
    assert resp.json()["payout_account_linked"] is True
    assert "payout_account_id" not in resp.json()
    # The link really happened — the column is set, it is just not published.
    stored = repository.get_active_by_id(org.id)
    assert stored is not None
    assert stored.payout_account_id.startswith("fake_linked_account_")
