import pytest

from apps.accounts.repositories import UserRepository


@pytest.fixture
def repo() -> UserRepository:
    return UserRepository()


@pytest.mark.django_db
def test_create_user_hashes_the_password(repo):
    user = repo.create_user(email="repo@example.com", password="s3cur3pass")

    assert user.check_password("s3cur3pass")
    assert user.password != "s3cur3pass"


@pytest.mark.django_db
def test_get_by_email_is_case_insensitive(repo):
    repo.create_user(email="Case@Example.com", password="s3cur3pass")

    assert repo.get_by_email("case@example.com") is not None


@pytest.mark.django_db
def test_get_by_email_returns_none_when_missing(repo):
    assert repo.get_by_email("missing@example.com") is None


@pytest.mark.django_db
def test_email_exists(repo):
    assert repo.email_exists("nope@example.com") is False

    repo.create_user(email="nope@example.com", password="s3cur3pass")

    assert repo.email_exists("nope@example.com") is True
