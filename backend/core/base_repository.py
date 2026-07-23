"""Base repository: the ONLY layer allowed to run ORM queries.

Services depend on repositories, never on `Model.objects` directly. This
keeps query logic testable in isolation and means swapping the ORM (or
sharding a table, or moving a module to its own service) only touches the
matching repository, not the business rules that call it.
"""

from __future__ import annotations

import uuid
from typing import Generic, TypeVar

from django.db.models import Model, QuerySet

ModelT = TypeVar("ModelT", bound=Model)


class BaseRepository(Generic[ModelT]):
    model: type[ModelT]

    def get_queryset(self) -> QuerySet[ModelT]:
        # django-stubs can't see `.objects` through a TypeVar bound only to
        # `Model` — concrete subclasses (e.g. UserRepository) have it typed
        # correctly, so this is a stub limitation, not a real risk.
        return self.model.objects.all()  # type: ignore[attr-defined]

    def get_by_id(self, id: uuid.UUID | int | str) -> ModelT | None:
        return self.get_queryset().filter(pk=id).first()

    def save(self, instance: ModelT) -> ModelT:
        instance.save()
        return instance

    def delete(self, instance: ModelT) -> None:
        instance.delete()
