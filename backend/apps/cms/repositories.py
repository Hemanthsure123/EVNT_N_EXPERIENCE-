"""ORM access for admin-authored homepage content."""

from __future__ import annotations

import datetime as dt
import uuid

from django.db.models import Q, QuerySet
from django.utils import timezone

from apps.events.models import Event, EventStatus

from .defaults import initial_hero
from .models import (
    Category,
    Collection,
    FeaturedCity,
    FeaturedEntry,
    HomepageContent,
    PopularSearch,
)


class HomepageRepository:
    def get_or_create_singleton(self) -> HomepageContent:
        """The one row, created WITH its default copy on first read.

        `get_or_create` on the unique `singleton` column, so two concurrent
        first-reads cannot both insert — the loser hits the constraint and
        `get_or_create` returns the winner's row.

        `defaults=` is the important part, and it is not cosmetic. This method
        is on the READ path, so a platform with no row lazily creates one here.
        Created empty — as it was — every hero field is `""` and the front page
        is blank, permanently and silently: the seed migration is deliberately
        non-destructive, so it cannot repair a row that already exists. See
        `apps/cms/defaults.py` for why the defaults live there rather than only
        in that migration.
        """
        content, _ = HomepageContent.objects.get_or_create(singleton=True, defaults=initial_hero())
        return content

    def update_if_version_matches(
        self, *, expected_version: int, actor_id: uuid.UUID | str, fields: dict
    ) -> bool:
        """One conditional UPDATE, never read-modify-write.

        Two operators editing the hero at once is the realistic case in a CMS,
        and the second must be told rather than silently win.
        """
        updated = HomepageContent.objects.filter(singleton=True, version=expected_version).update(
            version=expected_version + 1,
            updated_by_id=actor_id,
            updated_at=timezone.now(),
            **fields,
        )
        return updated == 1


class FeaturedRepository:
    def list_for_read(self, *, city: str | None, now: dt.datetime) -> QuerySet[FeaturedEntry]:
        """Every slot live right now, with its event joined.

        Three filters do all the work: the scheduling window, the city scope,
        and — the important one — the event still being publicly visible. A
        curated event that was later taken down must vanish from the homepage
        without anybody remembering to unpin it.
        """
        return (
            FeaturedEntry.objects.filter(
                Q(starts_at__isnull=True) | Q(starts_at__lte=now),
                Q(ends_at__isnull=True) | Q(ends_at__gt=now),
                Q(city="") | Q(city__iexact=city or ""),
                event__status=EventStatus.LIVE,
                event__deleted_at__isnull=True,
                event__starts_at__gte=now,
            )
            .select_related("event", "event__organization")
            .only(
                "id",
                "collection",
                "position",
                "city",
                "starts_at",
                "ends_at",
                "event__id",
                "event__title",
                "event__venue",
                "event__city",
                "event__starts_at",
                "event__poster_url",
                "event__from_price_minor",
                "event__tickets_available",
                "event__organization__id",
                "event__organization__name",
            )
            .order_by("collection", "position", "event__starts_at")
        )

    def list_all(self) -> QuerySet[FeaturedEntry]:
        """The admin view: every slot, including scheduled and expired ones."""
        return (
            FeaturedEntry.objects.select_related("event")
            .only(
                "id",
                "collection",
                "position",
                "city",
                "starts_at",
                "ends_at",
                "created_at",
                "event__id",
                "event__title",
                "event__status",
                "event__starts_at",
            )
            .order_by("collection", "position")
        )

    def create(self, **fields) -> FeaturedEntry:
        return FeaturedEntry.objects.create(**fields)

    def delete(self, entry_id: uuid.UUID | str) -> int:
        deleted, _ = FeaturedEntry.objects.filter(pk=entry_id).delete()
        return deleted

    def set_position(self, *, entry_id: uuid.UUID | str, position: int) -> bool:
        return FeaturedEntry.objects.filter(pk=entry_id).update(position=position) == 1

    def event_is_publishable(self, event_id: uuid.UUID | str) -> bool:
        """Only an APPROVED event may be curated.

        The moderation gate would be pointless if an operator could pin a
        draft onto the homepage from a different screen.
        """
        return Event.objects.filter(
            pk=event_id, status=EventStatus.LIVE, deleted_at__isnull=True
        ).exists()


class CategoryRepository:
    def list_public(self) -> QuerySet[Category]:
        return (
            Category.objects.filter(is_visible=True, archived_at__isnull=True)
            .only("id", "slug", "label", "icon", "search_term", "position")
            .order_by("position", "label")
        )

    def list_all(self) -> QuerySet[Category]:
        return Category.objects.order_by("position", "label")

    def get(self, category_id: uuid.UUID | str) -> Category | None:
        return Category.objects.filter(pk=category_id).first()

    def create(self, **fields) -> Category:
        return Category.objects.create(**fields)

    def update(self, category_id: uuid.UUID | str, **fields) -> bool:
        return Category.objects.filter(pk=category_id).update(**fields) == 1

    def archive(self, category_id: uuid.UUID | str) -> bool:
        """Hide from navigation; the landing page keeps resolving."""
        return (
            Category.objects.filter(pk=category_id, archived_at__isnull=True).update(
                archived_at=timezone.now(), is_visible=False
            )
            == 1
        )


COLLECTIONS = tuple(choice.value for choice in Collection)


class FeaturedCityRepository:
    def list_public(self) -> QuerySet[FeaturedCity]:
        return FeaturedCity.objects.filter(is_visible=True).only(
            "id", "name", "image_url", "position"
        )

    def list_all(self) -> QuerySet[FeaturedCity]:
        return FeaturedCity.objects.all()

    def create(self, **fields) -> FeaturedCity:
        return FeaturedCity.objects.create(**fields)

    def update(self, city_id: uuid.UUID | str, **fields) -> bool:
        return FeaturedCity.objects.filter(pk=city_id).update(**fields) == 1

    def delete(self, city_id: uuid.UUID | str) -> int:
        # A hard delete, unlike Category's archive. Nothing links to a
        # featured city — it is a tile on one page, and the city's landing
        # page resolves from `Event.city`, not from this row. There is no
        # bookmark to keep working.
        deleted, _ = FeaturedCity.objects.filter(pk=city_id).delete()
        return deleted


class PopularSearchRepository:
    def list_public(self) -> QuerySet[PopularSearch]:
        return PopularSearch.objects.filter(is_visible=True).only(
            "id", "label", "query", "position"
        )

    def list_all(self) -> QuerySet[PopularSearch]:
        return PopularSearch.objects.all()

    def create(self, **fields) -> PopularSearch:
        return PopularSearch.objects.create(**fields)

    def update(self, search_id: uuid.UUID | str, **fields) -> bool:
        return PopularSearch.objects.filter(pk=search_id).update(**fields) == 1

    def delete(self, search_id: uuid.UUID | str) -> int:
        deleted, _ = PopularSearch.objects.filter(pk=search_id).delete()
        return deleted
