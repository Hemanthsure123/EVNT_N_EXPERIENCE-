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
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from config.di import build_event_service, cache_port
from core.errors import InvalidInputError
from core.http_caching import is_not_modified, make_etag, with_cache_headers
from core.throttling import UploadThrottle

from .exceptions import EventNotFoundError
from .models import MediaKind
from .pagination import EventCursorPagination, OrganizerEventCursorPagination
from .repositories import SavedEventRepository
from .schemas import (
    CancelEventRequestSerializer,
    CancelEventResultSerializer,
    CreateEventRequestSerializer,
    CreateEventSlotSerializer,
    EventCardSerializer,
    EventContentSerializer,
    EventDetailSerializer,
    EventFaqSerializer,
    EventMediaListSerializer,
    EventMediaSerializer,
    EventSearchQuerySerializer,
    EventSitemapEntrySerializer,
    EventSlotSerializer,
    EventTimelineSerializer,
    OrganizerEventSummarySerializer,
    ReorderEventMediaSerializer,
    SavedEventSerializer,
    SavedIdsSerializer,
    SaveEventsRequestSerializer,
    UpdateEventFaqSerializer,
    UpdateEventMediaSerializer,
    UpdateEventRequestSerializer,
    UpdateEventSlotSerializer,
    UpdateEventTimelineSerializer,
    WriteEventFaqSerializer,
    WriteEventMediaSerializer,
    WriteEventTimelineSerializer,
)
from .selectors import (
    EVENT_LIST_TTL_SECONDS,
    compute_filter_hash,
    events_list_cache_key,
    get_event_detail_payload,
    get_events_list_generation,
    get_events_sitemap_payload,
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

# The sitemap is read by crawlers on their own schedule, not on a visitor's
# path, so it is cached for far longer than the discovery reads above — and it
# is the one response here where serving a slightly stale copy costs nothing.
_SITEMAP_MAX_AGE = 600
_SITEMAP_S_MAXAGE = 3600
_SITEMAP_SWR = 3600


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
            "category": validated.get("category") or None,
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


class EventSitemapView(APIView):
    """Every publicly-reachable event URL, for the frontend's `/sitemap.xml`.

    ── WHY THIS ENDPOINT EXISTS ──────────────────────────────────────────────
    Event detail pages are the ones carrying `Event` structured data and the
    ones eligible for rich results, and until now they appeared in no sitemap
    at all — a crawler could reach them only by walking landing pages that show
    twenty events each with no paginated URLs. Everything below the twentieth
    soonest event in a city was, in practice, undiscoverable.

    ── NOT THE BROWSE ENDPOINT WITH A BIG page_size ──────────────────────────
    That one is cursor-paginated (so a sitemap build would issue N requests),
    bounded to UPCOMING events (a past event's page still resolves and should
    still be indexed), and returns a full card payload per row. This returns
    three columns and the whole set.

    Public and edge-cacheable with a long TTL: it is identical for everyone and
    is read by crawlers, not by visitors.
    """

    permission_classes = [AllowAny]

    @extend_schema(responses={200: EventSitemapEntrySerializer(many=True)})
    def get(self, request: Request) -> Response:
        body = {"data": get_events_sitemap_payload()}

        etag = make_etag(body)
        if is_not_modified(request, etag):
            return Response(status=status.HTTP_304_NOT_MODIFIED)

        return with_cache_headers(
            Response(body),
            etag=etag,
            max_age_seconds=_SITEMAP_MAX_AGE,
            private=False,
            s_maxage_seconds=_SITEMAP_S_MAXAGE,
            stale_while_revalidate_seconds=_SITEMAP_SWR,
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


class EventArchiveView(APIView):
    """Retire an event. Organizer-only, and the ONLY route to `archived`.

    A POST rather than a PATCH on purpose: `status` is not in the update
    serializer's editable set, because a lifecycle change has source-state
    rules a blind field write would skip.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: EventDetailSerializer})
    def post(self, request: Request, event_id: str) -> Response:
        service = build_event_service()
        event = service.archive_event(event_id=event_id, actor_id=cast(User, request.user).id)
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


class EventCancelView(APIView):
    """POST /events/{id}/cancel — the organiser calls their own event off.

    A lifecycle transition with source-state rules and real financial
    consequences, so it is its own endpoint rather than a `status` a PATCH may
    set — `status` is deliberately absent from the update serializer's
    editable set, which is what keeps every route to a terminal state
    auditable and gated.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=CancelEventRequestSerializer, responses={200: CancelEventResultSerializer}
    )
    def post(self, request: Request, event_id: str) -> Response:
        payload = CancelEventRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        result = build_event_service().cancel_event(
            event_id=event_id,
            actor_id=cast(User, request.user).id,
            reason=payload.validated_data["reason"],
        )
        return _no_store(Response(CancelEventResultSerializer(result).data))


class EventContentView(APIView):
    """Read every content collection for one event in a single request.

    PUBLIC on GET, because this is what the event page renders — and it is the
    same for every visitor, so it carries the same edge-cache treatment as the
    event detail itself. Writes are per-collection below and are owner-only.
    """

    permission_classes = [AllowAny]

    @extend_schema(responses={200: EventContentSerializer})
    def get(self, request: Request, event_id: str) -> Response:
        from .repositories import EventContentRepository, EventSlotRepository

        repository = EventContentRepository()
        body = {
            "media": EventMediaSerializer(repository.media_for(event_id), many=True).data,
            "faqs": EventFaqSerializer(repository.faqs_for(event_id), many=True).data,
            "timeline": EventTimelineSerializer(repository.timeline_for(event_id), many=True).data,
            # Active only. A session an organiser switched off is still a row
            # they can see in their own list; to the public it is simply not
            # on sale, and rendering it greyed out invites the question.
            "slots": EventSlotSerializer(
                EventSlotRepository().list_for_event(event_id), many=True
            ).data,
        }
        etag = make_etag(body)
        if is_not_modified(request, etag):
            return Response(status=status.HTTP_304_NOT_MODIFIED)
        return with_cache_headers(
            Response(body),
            etag=etag,
            max_age_seconds=_PUBLIC_DETAIL_MAX_AGE,
            private=False,
            s_maxage_seconds=_PUBLIC_DETAIL_S_MAXAGE,
            stale_while_revalidate_seconds=_PUBLIC_SWR,
        )


class _OwnerWriteView(APIView):
    """Shared base for the content writes.

    Authenticated at the request layer; OWNERSHIP is proven inside
    `EventContentService`, which already loads the row — an object-level DRF
    permission would fetch the same row a second time per request. Same
    reasoning as the rest of this module.
    """

    permission_classes: list = [IsAuthenticated]

    @property
    def _service(self):
        from config.di import build_event_content_service

        return build_event_content_service()

    @property
    def _actor(self):
        return cast(User, self.request.user).id


class EventMediaView(_OwnerWriteView):
    @extend_schema(request=WriteEventMediaSerializer, responses={201: EventMediaSerializer})
    def post(self, request: Request, event_id: str) -> Response:
        payload = WriteEventMediaSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        media = self._service.add_media(
            event_id=event_id, actor_id=self._actor, **payload.validated_data
        )
        return _no_store(Response(EventMediaSerializer(media).data, status=status.HTTP_201_CREATED))

    @extend_schema(request=ReorderEventMediaSerializer, responses={200: EventMediaListSerializer})
    def patch(self, request: Request, event_id: str) -> Response:
        """Reorder the gallery in one request — a drag-and-drop is one intent."""
        payload = ReorderEventMediaSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        media = self._service.reorder_media(
            event_id=event_id, actor_id=self._actor, items=payload.validated_data["items"]
        )
        return _no_store(Response({"media": EventMediaSerializer(media, many=True).data}))


class EventMediaUploadView(_OwnerWriteView):
    """Upload a file and attach it, in one multipart request.

    `MultiPartParser` only — this endpoint exists to receive a file, and
    accepting JSON here would just produce a confusing 400 for anyone who
    guessed wrong.
    """

    parser_classes = [MultiPartParser, FormParser]
    # Bytes in, content validation, storage cost — keyed on the uploader.
    throttle_classes = [UploadThrottle]

    @extend_schema(request=None, responses={201: EventMediaSerializer})
    def post(self, request: Request, event_id: str) -> Response:
        upload = request.FILES.get("file")
        if upload is None:
            raise InvalidInputError("No file was uploaded — send one as `file`.")

        media = self._service.upload_media(
            event_id=event_id,
            actor_id=self._actor,
            upload=upload,
            kind=request.data.get("kind", MediaKind.GALLERY),
            alt_text=str(request.data.get("alt_text", "")),
            caption=str(request.data.get("caption", "")),
            position=int(request.data.get("position") or 0),
        )
        return _no_store(Response(EventMediaSerializer(media).data, status=status.HTTP_201_CREATED))


class EventMediaDetailView(_OwnerWriteView):
    @extend_schema(request=UpdateEventMediaSerializer, responses={200: EventMediaSerializer})
    def patch(self, request: Request, event_id: str, media_id: str) -> Response:
        payload = UpdateEventMediaSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        media = self._service.update_media(
            event_id=event_id,
            actor_id=self._actor,
            media_id=media_id,
            changes=dict(payload.validated_data),
        )
        return _no_store(Response(EventMediaSerializer(media).data))

    @extend_schema(responses={204: None})
    def delete(self, request: Request, event_id: str, media_id: str) -> Response:
        self._service.remove_media(event_id=event_id, actor_id=self._actor, media_id=media_id)
        return _no_store(Response(status=status.HTTP_204_NO_CONTENT))


class EventFaqView(_OwnerWriteView):
    @extend_schema(request=WriteEventFaqSerializer, responses={201: EventFaqSerializer})
    def post(self, request: Request, event_id: str) -> Response:
        payload = WriteEventFaqSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        faq = self._service.add_faq(
            event_id=event_id, actor_id=self._actor, **payload.validated_data
        )
        return _no_store(Response(EventFaqSerializer(faq).data, status=status.HTTP_201_CREATED))


class EventFaqDetailView(_OwnerWriteView):
    @extend_schema(request=UpdateEventFaqSerializer, responses={200: EventFaqSerializer})
    def patch(self, request: Request, event_id: str, faq_id: str) -> Response:
        payload = UpdateEventFaqSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        faq = self._service.update_faq(
            event_id=event_id,
            actor_id=self._actor,
            faq_id=faq_id,
            changes=dict(payload.validated_data),
        )
        return _no_store(Response(EventFaqSerializer(faq).data))

    @extend_schema(responses={204: None})
    def delete(self, request: Request, event_id: str, faq_id: str) -> Response:
        self._service.remove_faq(event_id=event_id, actor_id=self._actor, faq_id=faq_id)
        return _no_store(Response(status=status.HTTP_204_NO_CONTENT))


class EventSlotView(_OwnerWriteView):
    """The organiser's session list, and adding one.

    GET is owner-scoped and includes INACTIVE slots, unlike the public
    content payload — the only way to bring a switched-off session back is to
    be able to see it.
    """

    @extend_schema(responses={200: EventSlotSerializer(many=True)})
    def get(self, request: Request, event_id: str) -> Response:
        slots = self._service.list_slots(event_id=event_id, actor_id=self._actor)
        return _no_store(Response(EventSlotSerializer(slots, many=True).data))

    @extend_schema(request=CreateEventSlotSerializer, responses={201: EventSlotSerializer})
    def post(self, request: Request, event_id: str) -> Response:
        payload = CreateEventSlotSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        slot = self._service.add_slot(
            event_id=event_id, actor_id=self._actor, **payload.validated_data
        )
        return _no_store(Response(EventSlotSerializer(slot).data, status=status.HTTP_201_CREATED))


class EventSlotDetailView(_OwnerWriteView):
    @extend_schema(request=UpdateEventSlotSerializer, responses={200: EventSlotSerializer})
    def patch(self, request: Request, event_id: str, slot_id: str) -> Response:
        payload = UpdateEventSlotSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        slot = self._service.update_slot(
            event_id=event_id,
            actor_id=self._actor,
            slot_id=slot_id,
            changes=dict(payload.validated_data),
        )
        return _no_store(Response(EventSlotSerializer(slot).data))

    @extend_schema(responses={204: None})
    def delete(self, request: Request, event_id: str, slot_id: str) -> Response:
        self._service.remove_slot(event_id=event_id, actor_id=self._actor, slot_id=slot_id)
        return _no_store(Response(status=status.HTTP_204_NO_CONTENT))


class EventTimelineView(_OwnerWriteView):
    @extend_schema(request=WriteEventTimelineSerializer, responses={201: EventTimelineSerializer})
    def post(self, request: Request, event_id: str) -> Response:
        payload = WriteEventTimelineSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        entry = self._service.add_timeline_entry(
            event_id=event_id, actor_id=self._actor, **payload.validated_data
        )
        return _no_store(
            Response(EventTimelineSerializer(entry).data, status=status.HTTP_201_CREATED)
        )


class EventTimelineDetailView(_OwnerWriteView):
    @extend_schema(request=UpdateEventTimelineSerializer, responses={200: EventTimelineSerializer})
    def patch(self, request: Request, event_id: str, entry_id: str) -> Response:
        payload = UpdateEventTimelineSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        entry = self._service.update_timeline_entry(
            event_id=event_id,
            actor_id=self._actor,
            entry_id=entry_id,
            changes=dict(payload.validated_data),
        )
        return _no_store(Response(EventTimelineSerializer(entry).data))

    @extend_schema(responses={204: None})
    def delete(self, request: Request, event_id: str, entry_id: str) -> Response:
        self._service.remove_timeline_entry(
            event_id=event_id, actor_id=self._actor, entry_id=entry_id
        )
        return _no_store(Response(status=status.HTTP_204_NO_CONTENT))


class SavedEventsView(APIView):
    """A signed-in user's saved events.

    ── WHY SAVING IS NOT GATED BEHIND SIGN-IN ───────────────────────────

    Browsing needs no account on this platform, and a heart that demands one
    before it will fill removes the affordance for exactly the people still
    deciding whether to make an account. So the FRONTEND keeps saving to
    `localStorage` while anonymous and MERGES that set here on sign-in — see
    the POST body's `event_ids`.

    That merge is why this endpoint takes a list rather than a single id: it
    has to be idempotent over a set somebody has been building for a week.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: SavedEventSerializer(many=True)})
    def get(self, request: Request) -> Response:
        rows = SavedEventRepository().list_cards(user_id=cast(User, request.user).id)
        # `private, no-store`: this is per-user data, and a shared cache must
        # never hand one person's saved list to another.
        return _no_store(Response({"data": SavedEventSerializer(rows, many=True).data}))

    @extend_schema(request=SaveEventsRequestSerializer, responses={200: SavedIdsSerializer})
    def post(self, request: Request) -> Response:
        """Save one or many. Returns the full set of saved ids.

        Returning the whole set rather than just what changed means the client
        can replace its local state outright instead of reconciling — which is
        what makes the anonymous-to-signed-in merge a single call.
        """
        payload = SaveEventsRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        repository = SavedEventRepository()
        user_id = cast(User, request.user).id
        for event_id in payload.validated_data["event_ids"]:
            repository.save(user_id=user_id, event_id=event_id)

        return _no_store(Response({"event_ids": repository.saved_ids(user_id=user_id)}))


class SavedEventDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={204: None})
    def delete(self, request: Request, event_id: str) -> Response:
        """Unsave. A 204 whether or not it was saved — the caller's intent is
        "this should not be saved", and that is true either way."""
        SavedEventRepository().unsave(user_id=cast(User, request.user).id, event_id=event_id)
        return _no_store(Response(status=status.HTTP_204_NO_CONTENT))
