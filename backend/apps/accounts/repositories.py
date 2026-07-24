from __future__ import annotations

import uuid
from collections.abc import Iterable

from django.db.models import QuerySet

from core.base_repository import BaseRepository

from .models import User


class UserRepository(BaseRepository[User]):
    model = User

    def get_by_email(self, email: str) -> User | None:
        return self.get_queryset().filter(email__iexact=email).first()

    def list_by_ids(self, ids: Iterable[uuid.UUID | str]) -> QuerySet[User]:
        """Fetch many users in ONE query (e.g. all a reminder's recipients),
        so a fan-out never N+1s a lookup per id."""
        return self.get_queryset().filter(id__in=list(ids))

    def email_exists(self, email: str) -> bool:
        return self.get_queryset().filter(email__iexact=email).exists()

    def create_user(self, *, email: str, password: str, full_name: str = "") -> User:
        return User.objects.create_user(email=email, password=password, full_name=full_name)
