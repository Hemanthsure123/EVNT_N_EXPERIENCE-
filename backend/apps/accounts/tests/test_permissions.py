from unittest.mock import MagicMock

import pytest

from apps.accounts.permissions import IsSelf
from apps.accounts.repositories import UserRepository


@pytest.mark.django_db
def test_is_self_allows_the_owning_user():
    user = UserRepository().create_user(email="self@example.com", password="s3cur3pass")
    request = MagicMock(user=user)

    assert IsSelf().has_object_permission(request, MagicMock(), user) is True


@pytest.mark.django_db
def test_is_self_denies_a_different_user():
    repo = UserRepository()
    user = repo.create_user(email="self2@example.com", password="s3cur3pass")
    other = repo.create_user(email="other@example.com", password="s3cur3pass")
    request = MagicMock(user=user)

    assert IsSelf().has_object_permission(request, MagicMock(), other) is False
