"""BaseRepository is abstract infrastructure with no concrete model of its
own, so it's exercised here through the accounts UserRepository — any
repository subclass gets get_by_id/save/delete for free."""

import pytest

from apps.accounts.repositories import UserRepository


@pytest.fixture
def repo() -> UserRepository:
    return UserRepository()


@pytest.mark.django_db
def test_get_by_id_returns_the_matching_row(repo):
    user = repo.create_user(email="byid@example.com", password="s3cur3pass")

    assert repo.get_by_id(user.id) == user


@pytest.mark.django_db
def test_get_by_id_returns_none_when_missing(repo):
    assert repo.get_by_id("00000000-0000-0000-0000-000000000000") is None


@pytest.mark.django_db
def test_save_persists_changes(repo):
    user = repo.create_user(email="save@example.com", password="s3cur3pass")

    user.full_name = "Updated Name"
    repo.save(user)

    assert repo.get_by_id(user.id).full_name == "Updated Name"


@pytest.mark.django_db
def test_delete_removes_the_row(repo):
    user = repo.create_user(email="delete@example.com", password="s3cur3pass")

    repo.delete(user)

    assert repo.get_by_id(user.id) is None
