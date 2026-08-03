"""Business rules for admin-authored homepage content.

Every method here is a PLATFORM OPERATOR's action: there is no ownership
question to ask, the same way `console` has none. Authorization is enforced at
the view (`IsPlatformAdmin`), and every write records an audit entry — this is
the module where "who changed the homepage" is a question somebody will
eventually need answered.
"""

from __future__ import annotations

import uuid

from django.db import IntegrityError, transaction

from core.audit import record_audit
from core.errors import ConflictError, InvalidInputError, NotFoundError
from core.unit_of_work import UnitOfWork

from .models import HomepageContent
from .repositories import (
    CategoryRepository,
    FeaturedCityRepository,
    FeaturedRepository,
    HomepageRepository,
    PopularSearchRepository,
)
from .selectors import invalidate_homepage_cache


class StaleHomepageVersionError(ConflictError):
    code = "stale_homepage_version"

    def __init__(self) -> None:
        super().__init__("Someone else edited the homepage. Reload and reapply your changes.")


class HomepageService:
    def __init__(
        self,
        *,
        homepage: HomepageRepository,
        featured: FeaturedRepository,
        categories: CategoryRepository,
        cities: FeaturedCityRepository,
        popular: PopularSearchRepository,
    ) -> None:
        self._homepage = homepage
        self._featured = featured
        self._categories = categories
        self._cities = cities
        self._popular = popular

    # ------------------------------------------------------------- copy

    def update_content(
        self, *, actor_id: uuid.UUID | str, expected_version: int, fields: dict
    ) -> HomepageContent:
        badges = fields.get("trust_badges")
        if badges is not None:
            if not isinstance(badges, list) or any(not isinstance(item, str) for item in badges):
                raise InvalidInputError("Trust badges must be a list of short strings.")
            # Bounded so a paste cannot make the hero unreadable. Length caps
            # per badge come from the serializer; this bounds the COUNT.
            if len(badges) > 4:
                raise InvalidInputError("At most four trust badges fit in the hero.")

        # Ensure the row exists before the conditional UPDATE. It is created
        # lazily on first read, and the very first edit can arrive before
        # anybody has loaded the homepage — without this, a conditional update
        # against zero rows is indistinguishable from a version conflict, and
        # the CMS reports "someone else edited this" on a brand-new platform.
        self._homepage.get_or_create_singleton()

        with UnitOfWork():
            if not self._homepage.update_if_version_matches(
                expected_version=expected_version, actor_id=actor_id, fields=fields
            ):
                raise StaleHomepageVersionError()
            record_audit(
                actor_id=str(actor_id),
                action="homepage.updated",
                target_type="homepage",
                target_id="singleton",
                metadata={"fields": sorted(fields.keys())},
            )
            # AFTER commit — invalidating earlier lets a concurrent reader
            # repopulate the cache with the pre-write copy.
            transaction.on_commit(invalidate_homepage_cache)

        return self._homepage.get_or_create_singleton()

    # -------------------------------------------------------- curation

    def feature_event(
        self,
        *,
        actor_id: uuid.UUID | str,
        event_id: uuid.UUID | str,
        collection: str,
        position: int = 0,
        city: str = "",
        starts_at=None,
        ends_at=None,
    ):
        if not self._featured.event_is_publishable(event_id):
            # The moderation gate would be pointless if the homepage could
            # surface a draft from a different screen.
            raise InvalidInputError("Only an approved, upcoming event can be featured.")
        if starts_at and ends_at and ends_at <= starts_at:
            raise InvalidInputError("The scheduled window must end after it starts.")

        try:
            with UnitOfWork():
                entry = self._featured.create(
                    event_id=event_id,
                    collection=collection,
                    position=position,
                    city=city,
                    starts_at=starts_at,
                    ends_at=ends_at,
                    created_by_id=actor_id,
                )
                record_audit(
                    actor_id=str(actor_id),
                    action="homepage.featured_added",
                    target_type="event",
                    target_id=str(event_id),
                    metadata={"collection": collection, "city": city},
                )
                transaction.on_commit(invalidate_homepage_cache)
        except IntegrityError as exc:
            raise ConflictError("That event is already in this collection.") from exc
        return entry

    def unfeature(self, *, actor_id: uuid.UUID | str, entry_id: uuid.UUID | str) -> None:
        with UnitOfWork():
            if not self._featured.delete(entry_id):
                raise NotFoundError("No such featured slot.")
            record_audit(
                actor_id=str(actor_id),
                action="homepage.featured_removed",
                target_type="featured_entry",
                target_id=str(entry_id),
            )
            transaction.on_commit(invalidate_homepage_cache)

    def reorder(self, *, actor_id: uuid.UUID | str, order: list[dict]) -> None:
        """Reposition several slots in one transaction.

        All-or-nothing: a half-applied reorder leaves two cards claiming the
        same position, which the read path resolves arbitrarily.
        """
        with UnitOfWork():
            for item in order:
                self._featured.set_position(entry_id=item["id"], position=int(item["position"]))
            record_audit(
                actor_id=str(actor_id),
                action="homepage.featured_reordered",
                target_type="homepage",
                target_id="singleton",
                metadata={"count": len(order)},
            )
            transaction.on_commit(invalidate_homepage_cache)

    # ------------------------------------------------------ categories

    def create_category(self, *, actor_id: uuid.UUID | str, **fields):
        try:
            with UnitOfWork():
                category = self._categories.create(**fields)
                record_audit(
                    actor_id=str(actor_id),
                    action="category.created",
                    target_type="category",
                    target_id=str(category.id),
                    metadata={"slug": category.slug},
                )
                transaction.on_commit(invalidate_homepage_cache)
        except IntegrityError as exc:
            raise ConflictError("A category with that slug already exists.") from exc
        return category

    def update_category(self, *, actor_id: uuid.UUID | str, category_id: uuid.UUID | str, **fields):
        with UnitOfWork():
            if not self._categories.update(category_id, **fields):
                raise NotFoundError("No such category.")
            record_audit(
                actor_id=str(actor_id),
                action="category.updated",
                target_type="category",
                target_id=str(category_id),
                metadata={"fields": sorted(fields.keys())},
            )
            transaction.on_commit(invalidate_homepage_cache)
        return self._categories.get(category_id)

    def archive_category(self, *, actor_id: uuid.UUID | str, category_id: uuid.UUID | str) -> None:
        with UnitOfWork():
            if not self._categories.archive(category_id):
                raise NotFoundError("No such category, or it is already archived.")
            record_audit(
                actor_id=str(actor_id),
                action="category.archived",
                target_type="category",
                target_id=str(category_id),
            )
            transaction.on_commit(invalidate_homepage_cache)

    # ── Featured cities and popular searches ────────────────────────────
    #
    # Same shape as the category methods above: one UnitOfWork, an audit row
    # naming what changed, and cache invalidation ON COMMIT — never before, or
    # a concurrent read could repopulate the homepage cache with pre-write data
    # in the window before the write lands.

    def create_featured_city(self, *, actor_id: uuid.UUID | str, **fields):
        try:
            with UnitOfWork():
                city = self._cities.create(**fields)
                record_audit(
                    actor_id=str(actor_id),
                    action="featured_city.created",
                    target_type="featured_city",
                    target_id=str(city.id),
                    metadata={"name": city.name},
                )
                transaction.on_commit(invalidate_homepage_cache)
        except IntegrityError as exc:
            raise ConflictError("That city is already featured.") from exc
        return city

    def update_featured_city(
        self, *, actor_id: uuid.UUID | str, city_id: uuid.UUID | str, **fields
    ):
        try:
            with UnitOfWork():
                if not self._cities.update(city_id, **fields):
                    raise NotFoundError("No such featured city.")
                record_audit(
                    actor_id=str(actor_id),
                    action="featured_city.updated",
                    target_type="featured_city",
                    target_id=str(city_id),
                    metadata=dict(fields),
                )
                transaction.on_commit(invalidate_homepage_cache)
        except IntegrityError as exc:
            raise ConflictError("That city is already featured.") from exc
        return self._cities.list_all().get(pk=city_id)

    def delete_featured_city(self, *, actor_id: uuid.UUID | str, city_id: uuid.UUID | str) -> None:
        with UnitOfWork():
            if not self._cities.delete(city_id):
                raise NotFoundError("No such featured city.")
            record_audit(
                actor_id=str(actor_id),
                action="featured_city.deleted",
                target_type="featured_city",
                target_id=str(city_id),
            )
            transaction.on_commit(invalidate_homepage_cache)

    def create_popular_search(self, *, actor_id: uuid.UUID | str, **fields):
        try:
            with UnitOfWork():
                row = self._popular.create(**fields)
                record_audit(
                    actor_id=str(actor_id),
                    action="popular_search.created",
                    target_type="popular_search",
                    target_id=str(row.id),
                    metadata={"label": row.label},
                )
                transaction.on_commit(invalidate_homepage_cache)
        except IntegrityError as exc:
            raise ConflictError("A suggested search with that label already exists.") from exc
        return row

    def update_popular_search(
        self, *, actor_id: uuid.UUID | str, search_id: uuid.UUID | str, **fields
    ):
        try:
            with UnitOfWork():
                if not self._popular.update(search_id, **fields):
                    raise NotFoundError("No such suggested search.")
                record_audit(
                    actor_id=str(actor_id),
                    action="popular_search.updated",
                    target_type="popular_search",
                    target_id=str(search_id),
                    metadata=dict(fields),
                )
                transaction.on_commit(invalidate_homepage_cache)
        except IntegrityError as exc:
            raise ConflictError("A suggested search with that label already exists.") from exc
        return self._popular.list_all().get(pk=search_id)

    def delete_popular_search(
        self, *, actor_id: uuid.UUID | str, search_id: uuid.UUID | str
    ) -> None:
        with UnitOfWork():
            if not self._popular.delete(search_id):
                raise NotFoundError("No such suggested search.")
            record_audit(
                actor_id=str(actor_id),
                action="popular_search.deleted",
                target_type="popular_search",
                target_id=str(search_id),
            )
            transaction.on_commit(invalidate_homepage_cache)
