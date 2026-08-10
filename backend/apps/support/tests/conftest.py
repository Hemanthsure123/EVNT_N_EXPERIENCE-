"""Fixtures for support.

Three users, because every rule in this module is about which of them is
asking: the person who raised the query, somebody else entirely, and an
operator.
"""

from __future__ import annotations

import pytest

from apps.accounts.models import User


@pytest.fixture
def user(db) -> User:
    return User.objects.create_user(
        email="asker@example.com", password="Sufficiently-Long-Pass-1", full_name="Asha Kumar"
    )


@pytest.fixture
def other_user(db) -> User:
    """Not party to anything. Exists to prove they cannot read somebody's thread."""
    return User.objects.create_user(
        email="stranger@example.com", password="Sufficiently-Long-Pass-1", full_name="Stranger"
    )


@pytest.fixture
def staff_user(db) -> User:
    return User.objects.create_user(
        email="ops@example.com",
        password="Sufficiently-Long-Pass-1",
        full_name="Ops Person",
        is_staff=True,
    )
