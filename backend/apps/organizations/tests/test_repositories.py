import pytest

from apps.accounts.repositories import UserRepository
from apps.organizations.repositories import OrganizationRepository


@pytest.fixture
def owner():
    return UserRepository().create_user(email="owner@example.com", password="s3cur3pass")


@pytest.fixture
def repo() -> OrganizationRepository:
    return OrganizationRepository()


@pytest.mark.django_db
def test_create_and_get_active_by_id(repo, owner):
    org = repo.create(owner_id=owner.id, name="Acme Events")

    fetched = repo.get_active_by_id(org.id)

    assert fetched is not None
    assert fetched.name == "Acme Events"
    assert fetched.owner_id == owner.id


@pytest.mark.django_db
def test_get_active_by_id_excludes_soft_deleted(repo, owner):
    from django.utils import timezone

    org = repo.create(owner_id=owner.id, name="Deleted Co")
    org.deleted_at = timezone.now()
    org.save(update_fields=["deleted_at"])

    assert repo.get_active_by_id(org.id) is None


@pytest.mark.django_db
def test_list_active_by_owner_orders_newest_first(repo, owner):
    first = repo.create(owner_id=owner.id, name="First")
    second = repo.create(owner_id=owner.id, name="Second")

    results = list(repo.list_active_by_owner(owner.id))

    assert [o.id for o in results] == [second.id, first.id]


@pytest.mark.django_db
def test_list_active_by_owner_excludes_other_owners(repo, owner):
    other_owner = UserRepository().create_user(email="other@example.com", password="s3cur3pass")
    repo.create(owner_id=owner.id, name="Mine")
    repo.create(owner_id=other_owner.id, name="Theirs")

    results = list(repo.list_active_by_owner(owner.id))

    assert [o.name for o in results] == ["Mine"]


@pytest.mark.django_db
def test_verification_record_lifecycle(repo, owner):
    org = repo.create(owner_id=owner.id, name="Acme Events")

    record = repo.create_verification_record(organization_id=org.id)
    assert repo.get_verification_record(record.id).id == record.id

    record.notes = "looks good"
    repo.save_verification_record(record)

    assert repo.get_verification_record(record.id).notes == "looks good"
