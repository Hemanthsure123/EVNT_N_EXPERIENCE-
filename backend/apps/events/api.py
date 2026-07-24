"""Thin views: validate at the boundary, call one service/selector, serialize.

Two audiences, two caching postures:
- **Public reads** (GET list + detail) are unauthenticated and identical for
  everyone, so they're genuinely CDN-cacheable: `Cache-Control: public,
  s-maxage=...` + an ETag lets an edge/CDN absorb the bulk of discovery
  traffic (the biggest frontend-latency win). Short TTLs; publish/edit is the
  change signal (it invalidates our Redis copy immediately and the edge copy
  within its TTL).
- **Owner reads/writes** (organizer list, create/edit/publish) depend on who's
  asking and can contain drafts, so they're `private, no-store` — never edge-
  or browser-cached.

Ownership is enforced in the service (it already loads the row), so there's
no DRF object-permission here (see permissions.py's note).
"""

from __future__ import annotations

from typing import cast

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from config.di import build_event_service, cache_port
from core.http_caching import is_not_modified, make_etag, with_cache_headers

from .exceptions import EventNotFoundError
from .pagination import EventCursorPagination, OrganizerEventCursorPagination
from .schemas import (
    CreateEventRequestSerializer,
    EventCardSerializer,
    EventDetailSerializer,
    EventSearchQuerySerializer,
    OrganizerEventSummarySerializer,
    UpdateEventRequestSerializer,
)
from .selectors import (
    EVENT_LIST_TTL_SECONDS,
    compute_filter_hash,
    events_list_cache_key,
    get_event_detail_payload,
    get_events_list_generation,
    list_owner_events,
    list_published_events,
)

# Edge/browser TTLs for the public reads. Short by design: our own Redis cache
# is invalidated instantly on publish/edit, and these bound how long a CDN may
# still serve a just-changed page (an accepted tradeoff — see module docstring).
_PUBLIC_LIST_MAX_AGE = 15
_PUBLIC_LIST_S_MAXAGE = 30
_PUBLIC_DETAIL_MAX_AGE = 30
_PUBLIC_DETAIL_S_MAXAGE = 60
_PUBLIC_SWR = 30


def _no_store(response: Response) -> Response:
    """Owner-specific / draft-bearing responses must never be cached by a
    browser or a shared cache."""
    response["Cache-Control"] = "private, no-store"
    return response


class EventListCreateView(APIView):
    pagination_class = EventCursorPagination

    def get_permissions(self) -> list[BasePermission]:
        # Public browse/search on GET; authenticated create on POST.
        if self.request.method == "POST":
            return [IsAuthenticated()]
        return [AllowAny()]

    @extend_schema(
        parameters=[EventSearchQuerySerializer],
        responses={200: EventCardSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        query = EventSearchQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        validated = query.validated_data
        filters = {
            "search": validated.get("q") or None,
            "city": validated.get("city") or None,
            "starts_after": validated.get("starts_after"),
            "starts_before": validated.get("starts_before"),
        }

        cache = cache_port()
        is_first_page = "cursor" not in request.query_params
        cache_key = events_list_cache_key(
            get_events_list_generation(cache),
            compute_filter_hash({**filters, "page_size": request.query_params.get("page_size")}),
        )

        if is_first_page:
            cached = cache.get(cache_key)
            if cached is not None:
                return self._public_list_response(request, cached)

        queryset = list_published_events(filters)
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        # drf-stubs types .data as ReturnDict even with many=True (really a list).
        data = cast(list, EventCardSerializer(page, many=True).data)
        body = paginator.get_paginated_response(data).data

        if is_first_page:
            cache.set(cache_key, body, timeout_seconds=EVENT_LIST_TTL_SECONDS)

        return self._public_list_response(request, body)

    def _public_list_response(self, request: Request, body: dict) -> Response:
        etag = make_etag(body)
        if is_not_modified(request, etag):
            return Response(status=status.HTTP_304_NOT_MODIFIED)
        return with_cache_headers(
            Response(body),
            etag=etag,
            max_age_seconds=_PUBLIC_LIST_MAX_AGE,
            private=False,
            s_maxage_seconds=_PUBLIC_LIST_S_MAXAGE,
            stale_while_revalidate_seconds=_PUBLIC_SWR,
        )

    @extend_schema(request=CreateEventRequestSerializer, responses={201: EventDetailSerializer})
    def post(self, request: Request) -> Response:
        payload = CreateEventRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        service = build_event_service()
        event = service.create_event(actor_id=cast(User, request.user).id, **payload.validated_data)

        return _no_store(
            Response(EventDetailSerializer(event).data, status=status.HTTP_201_CREATED)
        )


class EventDetailView(APIView):
    def get_permissions(self) -> list[BasePermission]:
        if self.request.method == "PATCH":
            return [IsAuthenticated()]
        return [AllowAny()]

    @extend_schema(responses={200: EventDetailSerializer})
    def get(self, request: Request, event_id: str) -> Response:
        payload = get_event_detail_payload(event_id)
        if payload is None:
            raise EventNotFoundError(str(event_id))

        etag = make_etag(payload)
        if is_not_modified(request, etag):
            return Response(status=status.HTTP_304_NOT_MODIFIED)

        # public: only published events reach here and the content is identical
        # for every viewer, so a CDN may cache and share it.
        return with_cache_headers(
            Response(payload),
            etag=etag,
            max_age_seconds=_PUBLIC_DETAIL_MAX_AGE,
            private=False,
            s_maxage_seconds=_PUBLIC_DETAIL_S_MAXAGE,
            stale_while_revalidate_seconds=_PUBLIC_SWR,
        )

    @extend_schema(request=UpdateEventRequestSerializer, responses={200: EventDetailSerializer})
    def patch(self, request: Request, event_id: str) -> Response:
        payload = UpdateEventRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = dict(payload.validated_data)

        version = data.pop("version")
        poster = data.pop("poster", None)

        service = build_event_service()
        event = service.update_event(
            event_id=event_id,
            actor_id=cast(User, request.user).id,
            expected_version=version,
            changes=data,
            poster=poster,
        )

        return _no_store(Response(EventDetailSerializer(event).data))


class EventPublishView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: EventDetailSerializer})
    def post(self, request: Request, event_id: str) -> Response:
        service = build_event_service()
        event = service.publish_event(event_id=event_id, actor_id=cast(User, request.user).id)
        return _no_store(Response(EventDetailSerializer(event).data))


class OrganizerEventListView(APIView):
    permission_classes = [IsAuthenticated]
    pagination_class = OrganizerEventCursorPagination

    @extend_schema(responses={200: OrganizerEventSummarySerializer(many=True)})
    def get(self, request: Request) -> Response:
        # Contains drafts and is per-user — never cached (no Redis entry, and
        # no-store on the wire).
        queryset = list_owner_events(cast(User, request.user).id)
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        data = cast(list, OrganizerEventSummarySerializer(page, many=True).data)
        return _no_store(paginator.get_paginated_response(data))
