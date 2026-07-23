from __future__ import annotations

from core.base_repository import BaseRepository

from .models import User


class UserRepository(BaseRepository[User]):
    model = User

    def get_by_email(self, email: str) -> User | None:
        return self.get_queryset().filter(email__iexact=email).first()

    def email_exists(self, email: str) -> bool:
        return self.get_queryset().filter(email__iexact=email).exists()

    def create_user(self, *, email: str, password: str, full_name: str = "") -> User:
        return User.objects.create_user(email=email, password=password, full_name=full_name)
