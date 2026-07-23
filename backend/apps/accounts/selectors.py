"""Read-side of this module (CQRS-lite): queries live here, separate from
the write-side business rules in services.py, so read paths can be
optimised independently later (e.g. joining org memberships) without
touching command handling."""

from __future__ import annotations

from .models import User


def get_profile(user: User) -> User:
    return user
