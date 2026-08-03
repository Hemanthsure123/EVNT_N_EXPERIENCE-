"""Thin views for the CMS.

TWO CACHE POSTURES, and the split is the whole point of this module:

- `GET /homepage` is PUBLIC and identical for everyone in a city scope, so it
  gets `public` + `s-maxage` + `stale-while-revalidate` and an ETag. It is the
  front page; a CDN should absorb it. This is the same treatment the public
  events browse endpoints get, for the same reason.
- Every `/admin/homepage*` write is `private, no-store`.
"""

from __future__ import annotations

from typing import cast
from uuid import UUID

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from core.http_caching import is_not_modified, make_etag, with_cache_headers

from . import selectors
from .models import Collection
from .permissions import IsPlatformAdmin
from .repositories import (
    CategoryRepository,
    FeaturedCityRepository,
    FeaturedRepository,
    PopularSearchRepository,
)
from .schemas import (
    AdminFeaturedSerializer,
    CategorySerializer,
    FeaturedCitySerializer,
    FeatureEventSerializer,
    HomepageSerializer,
    PatchCategorySerializer,
    PatchFeaturedCitySerializer,
    PatchPopularSearchSerializer,
    PopularSearchSerializer,
    ReorderSerializer,
    UpdateHomepageSerializer,
    WriteCategorySerializer,
    WriteFeaturedCitySerializer,
    WritePopularSearchSerializer,
)

#: Short, because an operator publishing a homepage change wants to see it. The
#: generation counter busts the server cache instantly; these control the edge.
_MAX_AGE = 30
_S_MAXAGE = 60
_SWR = 300


def _no_store(response: Response) -> Response:
    response["Cache-Control"] = "private, no-store"
    return response


def _service():
    from config.di import build_homepage_service

    return build_homepage_service()


class HomepageView(APIView):
    """The front page's content, in one request."""

    permission_classes = [AllowAny]

    @extend_schema(
        parameters=[OpenApiParameter("city", str, description="Scopes city-targeted slots")],
        responses={200: HomepageSerializer},
    )
    def get(self, request: Request) -> Response:
        payload = selectors.get_homepage(city=request.query_params.get("city"))
        etag = make_etag(payload)
        if is_not_modified(request, etag):
            return Response(status=status.HTTP_304_NOT_MODIFIED)
        return with_cache_headers(
            Response(payload),
            etag=etag,
            max_age_seconds=_MAX_AGE,
            private=False,
            s_maxage_seconds=_S_MAXAGE,
            stale_while_revalidate_seconds=_SWR,
        )


class AdminView(APIView):
    permission_classes: list[type[BasePermission]] = [IsPlatformAdmin]


class HomepageContentView(AdminView):
    """The CMS's own read/write of the homepage row.

    The GET here is NOT `/homepage`. That one is cached for ten minutes and
    served from the edge — which means its `version` is a cached number, and
    an editor seeding its optimistic lock from it would send a stale version
    and 409 on every save. This read goes straight to the row, uncached and
    `private, no-store`.
    """

    @extend_schema(responses={200: None})
    def get(self, request: Request) -> Response:
        from .repositories import HomepageRepository

        content = HomepageRepository().get_or_create_singleton()
        return _no_store(
            Response(
                {
                    "version": content.version,
                    "hero_headline": content.hero_headline,
                    "hero_description": content.hero_description,
                    "hero_primary_cta": content.hero_primary_cta,
                    "hero_secondary_cta": content.hero_secondary_cta,
                    "search_placeholder": content.search_placeholder,
                    "ribbon_text": content.ribbon_text,
                    "ribbon_enabled": content.ribbon_enabled,
                    "trust_badges": content.trust_badges or [],
                    "footer_note": content.footer_note,
                }
            )
        )

    @extend_schema(request=UpdateHomepageSerializer, responses={200: None})
    def patch(self, request: Request) -> Response:
        payload = UpdateHomepageSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = dict(payload.validated_data)
        version = data.pop("version")

        content = _service().update_content(
            actor_id=cast(User, request.user).id, expected_version=version, fields=data
        )
        return _no_store(Response({"version": content.version}))


class FeaturedListView(AdminView):
    @extend_schema(responses={200: AdminFeaturedSerializer(many=True)})
    def get(self, request: Request) -> Response:
        rows = [
            {
                "id": entry.id,
                "collection": entry.collection,
                "position": entry.position,
                "city": entry.city,
                "starts_at": entry.starts_at,
                "ends_at": entry.ends_at,
                "created_at": entry.created_at,
                "event_id": entry.event_id,
                "event_title": entry.event.title,
                "event_status": entry.event.status,
                "event_starts_at": entry.event.starts_at,
            }
            for entry in FeaturedRepository().list_all()
        ]
        return _no_store(Response({"data": AdminFeaturedSerializer(rows, many=True).data}))

    @extend_schema(request=FeatureEventSerializer, responses={201: None})
    def post(self, request: Request) -> Response:
        payload = FeatureEventSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        entry = _service().feature_event(
            actor_id=cast(User, request.user).id, **payload.validated_data
        )
        return _no_store(Response({"id": str(entry.id)}, status=status.HTTP_201_CREATED))


class FeaturedDetailView(AdminView):
    @extend_schema(responses={204: None})
    def delete(self, request: Request, entry_id: UUID) -> Response:
        _service().unfeature(actor_id=cast(User, request.user).id, entry_id=entry_id)
        return _no_store(Response(status=status.HTTP_204_NO_CONTENT))


class FeaturedReorderView(AdminView):
    @extend_schema(request=ReorderSerializer, responses={200: None})
    def post(self, request: Request) -> Response:
        payload = ReorderSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        _service().reorder(
            actor_id=cast(User, request.user).id,
            order=[
                {"id": item["id"], "position": item["position"]}
                for item in payload.validated_data["order"]
            ],
        )
        return _no_store(Response({"ok": True}))


class CategoryListView(AdminView):
    @extend_schema(responses={200: CategorySerializer(many=True)})
    def get(self, request: Request) -> Response:
        rows = CategoryRepository().list_all()
        return _no_store(Response({"data": CategorySerializer(rows, many=True).data}))

    @extend_schema(request=WriteCategorySerializer, responses={201: CategorySerializer})
    def post(self, request: Request) -> Response:
        payload = WriteCategorySerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        category = _service().create_category(
            actor_id=cast(User, request.user).id, **payload.validated_data
        )
        return _no_store(
            Response(CategorySerializer(category).data, status=status.HTTP_201_CREATED)
        )


class CategoryDetailView(AdminView):
    @extend_schema(request=PatchCategorySerializer, responses={200: CategorySerializer})
    def patch(self, request: Request, category_id: UUID) -> Response:
        payload = PatchCategorySerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        category = _service().update_category(
            actor_id=cast(User, request.user).id,
            category_id=category_id,
            **payload.validated_data,
        )
        return _no_store(Response(CategorySerializer(category).data))

    @extend_schema(responses={204: None})
    def delete(self, request: Request, category_id: UUID) -> Response:
        """Archives rather than deletes — a linked category keeps resolving."""
        _service().archive_category(actor_id=cast(User, request.user).id, category_id=category_id)
        return _no_store(Response(status=status.HTTP_204_NO_CONTENT))


COLLECTIONS = [choice.value for choice in Collection]


class FeaturedCityListView(AdminView):
    """Which cities the homepage promotes, and in what order."""

    @extend_schema(responses={200: FeaturedCitySerializer(many=True)})
    def get(self, request: Request) -> Response:
        rows = FeaturedCityRepository().list_all()
        return _no_store(Response({"data": FeaturedCitySerializer(rows, many=True).data}))

    @extend_schema(request=WriteFeaturedCitySerializer, responses={201: FeaturedCitySerializer})
    def post(self, request: Request) -> Response:
        payload = WriteFeaturedCitySerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        city = _service().create_featured_city(
            actor_id=cast(User, request.user).id, **payload.validated_data
        )
        return _no_store(
            Response(FeaturedCitySerializer(city).data, status=status.HTTP_201_CREATED)
        )


class FeaturedCityDetailView(AdminView):
    @extend_schema(request=PatchFeaturedCitySerializer, responses={200: FeaturedCitySerializer})
    def patch(self, request: Request, city_id: UUID) -> Response:
        payload = PatchFeaturedCitySerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        city = _service().update_featured_city(
            actor_id=cast(User, request.user).id,
            city_id=city_id,
            **payload.validated_data,
        )
        return _no_store(Response(FeaturedCitySerializer(city).data))

    @extend_schema(responses={204: None})
    def delete(self, request: Request, city_id: UUID) -> Response:
        _service().delete_featured_city(actor_id=cast(User, request.user).id, city_id=city_id)
        return _no_store(Response(status=status.HTTP_204_NO_CONTENT))


class PopularSearchListView(AdminView):
    """Suggested searches for the search panel's empty state.

    "Popular" is a CURATION decision, not a measurement — the platform has no
    search-term log, and a number invented from nothing is exactly what this
    codebase refuses to show elsewhere.
    """

    @extend_schema(responses={200: PopularSearchSerializer(many=True)})
    def get(self, request: Request) -> Response:
        rows = PopularSearchRepository().list_all()
        return _no_store(Response({"data": PopularSearchSerializer(rows, many=True).data}))

    @extend_schema(request=WritePopularSearchSerializer, responses={201: PopularSearchSerializer})
    def post(self, request: Request) -> Response:
        payload = WritePopularSearchSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        row = _service().create_popular_search(
            actor_id=cast(User, request.user).id, **payload.validated_data
        )
        return _no_store(
            Response(PopularSearchSerializer(row).data, status=status.HTTP_201_CREATED)
        )


class PopularSearchDetailView(AdminView):
    @extend_schema(request=PatchPopularSearchSerializer, responses={200: PopularSearchSerializer})
    def patch(self, request: Request, search_id: UUID) -> Response:
        payload = PatchPopularSearchSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        row = _service().update_popular_search(
            actor_id=cast(User, request.user).id,
            search_id=search_id,
            **payload.validated_data,
        )
        return _no_store(Response(PopularSearchSerializer(row).data))

    @extend_schema(responses={204: None})
    def delete(self, request: Request, search_id: UUID) -> Response:
        _service().delete_popular_search(actor_id=cast(User, request.user).id, search_id=search_id)
        return _no_store(Response(status=status.HTTP_204_NO_CONTENT))
