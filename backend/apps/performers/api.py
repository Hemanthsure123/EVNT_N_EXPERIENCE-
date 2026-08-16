"""Thin views for the marketplace.

Three audiences, three cache postures, and the split is the important part:

- **Public browse and profile** are identical for every visitor, so they carry
  the same edge-cache treatment as the public events surface — a CDN absorbing
  marketplace traffic is the single biggest latency win available here.
- **Owner and customer surfaces** are per-person and `private, no-store`. A
  draft profile, a brief and a quote are nobody else's business, and a shared
  cache must never serve one to another caller.
- **Moderation** is staff-only, reusing the console's own permission class
  rather than inventing a second answer to "is this caller an operator".
"""

from __future__ import annotations

from typing import cast
from uuid import UUID

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.console.permissions import IsPlatformAdmin
from core.errors import NotFoundError
from core.http_caching import is_not_modified, make_etag, with_cache_headers
from core.throttling import UploadThrottle

from . import selectors
from .models import RequestKind
from .pagination import (
    BookingRequestPagination,
    OpenRequestPagination,
    PerformerBrowsePagination,
    PerformerModerationHistoryPagination,
    PerformerModerationPagination,
    PerformerOwnerPagination,
)
from .permissions import IsMarketplaceUser
from .repositories import (
    BookingRequestRepository,
    PerformerMediaRepository,
    PerformerRepository,
    QuoteRepository,
)
from .schemas import (
    BookingRequestSerializer,
    CreateBookingRequestSerializer,
    CreatePerformerRequestSerializer,
    FeatureDecisionSerializer,
    MarketplaceFacetsSerializer,
    ModerationDecisionSerializer,
    OpenRequestSerializer,
    OwnerPerformerSerializer,
    PauseSerializer,
    PerformerCardSerializer,
    PerformerDetailSerializer,
    PerformerPhotoSerializer,
    PerformerQuoteSerializer,
    PerformerSitemapEntrySerializer,
    QuoteSerializer,
    ReadinessSerializer,
    SubmitQuoteSerializer,
    UpdatePerformerRequestSerializer,
    UploadPhotoRequestSerializer,
)
from .services import readiness_problems

# Edge/browser TTLs for the public reads. Short by design: the server-side
# cache is invalidated instantly on publish, and these bound how long a CDN may
# still serve a just-changed profile.
_SITEMAP_MAX_AGE = 600
_SITEMAP_S_MAXAGE = 3600
_PUBLIC_MAX_AGE = 30
_PUBLIC_S_MAXAGE = 60
_PUBLIC_SWR = 30


def _no_store(response: Response) -> Response:
    """Owner/customer-specific responses must never reach a shared cache."""
    response["Cache-Control"] = "private, no-store"
    return response


def _with_photos(performers: list) -> list:
    """Attach each performer's photos, in ONE grouped query for the whole page.

    `OwnerPerformerSerializer.get_photos` reads what this hangs on the
    instance. Doing it here rather than in the serializer is what keeps a
    twenty-row list at one photo query instead of twenty.
    """
    if not performers:
        return performers
    grouped = PerformerMediaRepository().all_media_for_many([row.id for row in performers])
    for performer in performers:
        performer.loaded_photos = grouped.get(performer.id, [])
    return performers


def _int_param(request: Request, name: str) -> int | None:
    raw = request.query_params.get(name)
    if not raw:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        # A malformed filter is an absent filter, not a 400. The browse is
        # public and already safe; a 400 would blank a page over a typo.
        return None


# --------------------------------------------------------------- public


class PerformerBrowseView(APIView):
    """The marketplace. Public, edge-cached, filter-driven."""

    permission_classes = [AllowAny]
    pagination_class = PerformerBrowsePagination

    @extend_schema(
        parameters=[
            OpenApiParameter("q", str, description="Free-text over name, tagline and bio"),
            OpenApiParameter("type", str),
            OpenApiParameter("city", str),
            OpenApiParameter("budget_max", int, description="Minor units"),
            OpenApiParameter("language", str),
            OpenApiParameter("genre", str),
            OpenApiParameter("occasion", str),
            OpenApiParameter("min_experience", int),
            OpenApiParameter("verified", str, description="'true' for verified organisations only"),
            OpenApiParameter("featured", str),
        ],
        responses={200: PerformerCardSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        queryset = PerformerRepository().list_published(
            search=request.query_params.get("q"),
            performer_type=request.query_params.get("type"),
            city=request.query_params.get("city"),
            budget_max_minor=_int_param(request, "budget_max"),
            language=request.query_params.get("language"),
            genre=request.query_params.get("genre"),
            occasion=request.query_params.get("occasion"),
            min_experience=_int_param(request, "min_experience"),
            verified_only=request.query_params.get("verified") == "true",
            featured_only=request.query_params.get("featured") == "true",
        )
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        rows = selectors.decorate_cards(list(page or []))
        data = cast(list, PerformerCardSerializer(rows, many=True).data)
        response = paginator.get_paginated_response(data)
        return with_cache_headers(
            response,
            etag=make_etag(response.data),
            max_age_seconds=_PUBLIC_MAX_AGE,
            private=False,
            s_maxage_seconds=_PUBLIC_S_MAXAGE,
            stale_while_revalidate_seconds=_PUBLIC_SWR,
        )


class PerformerSitemapView(APIView):
    """Every published performer URL, for the frontend's `/sitemap.xml`.

    These profiles are indexable and carry a canonical tag, and they appeared
    in no sitemap and had no public inbound link — so a crawler had no route to
    them at all. This is the route.

    It returns an EMPTY list while nothing is published, and that is the
    correct answer rather than a problem to work around: the sitemap then
    simply carries no performer URLs, which is exactly the state it was in
    before. Nothing here invents a page.

    Long edge TTL — crawler traffic, not visitor traffic.
    """

    permission_classes = [AllowAny]

    @extend_schema(responses={200: PerformerSitemapEntrySerializer(many=True)})
    def get(self, request: Request) -> Response:
        rows = PerformerRepository().list_for_sitemap()
        body = {"data": cast(list, PerformerSitemapEntrySerializer(rows, many=True).data)}

        etag = make_etag(body)
        if is_not_modified(request, etag):
            return Response(status=status.HTTP_304_NOT_MODIFIED)

        return with_cache_headers(
            Response(body),
            etag=etag,
            max_age_seconds=_SITEMAP_MAX_AGE,
            private=False,
            s_maxage_seconds=_SITEMAP_S_MAXAGE,
            stale_while_revalidate_seconds=_SITEMAP_S_MAXAGE,
        )


class PerformerDetailView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(responses={200: PerformerDetailSerializer})
    def get(self, request: Request, performer_id: UUID) -> Response:
        payload = selectors.get_performer_detail_payload(performer_id)
        if payload is None:
            # A draft, a rejected profile and a nonexistent id are ALL 404 —
            # a distinct response would confirm the profile exists to anyone
            # guessing.
            raise NotFoundError("No performer with that id.")
        etag = make_etag(payload)
        if is_not_modified(request, etag):
            return Response(status=status.HTTP_304_NOT_MODIFIED)
        return with_cache_headers(
            Response(PerformerDetailSerializer(payload).data),
            etag=etag,
            max_age_seconds=_PUBLIC_MAX_AGE,
            private=False,
            s_maxage_seconds=_PUBLIC_S_MAXAGE,
            stale_while_revalidate_seconds=_PUBLIC_SWR,
        )


class MarketplaceFacetsView(APIView):
    """What the filter panel may offer, derived from live rows."""

    permission_classes = [AllowAny]

    @extend_schema(responses={200: MarketplaceFacetsSerializer})
    def get(self, request: Request) -> Response:
        payload = selectors.get_marketplace_facets()
        return with_cache_headers(
            Response(MarketplaceFacetsSerializer(payload).data),
            etag=make_etag(payload),
            max_age_seconds=_PUBLIC_MAX_AGE,
            private=False,
            s_maxage_seconds=_PUBLIC_S_MAXAGE,
            stale_while_revalidate_seconds=_PUBLIC_SWR,
        )


# ----------------------------------------------------------- owner side


class PerformerListCreateView(APIView):
    permission_classes = [IsMarketplaceUser]
    pagination_class = PerformerOwnerPagination

    @extend_schema(responses={200: OwnerPerformerSerializer(many=True)})
    def get(self, request: Request) -> Response:
        queryset = PerformerRepository().list_by_owner(cast(User, request.user).id)
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        data = cast(list, OwnerPerformerSerializer(_with_photos(list(page or [])), many=True).data)
        return _no_store(paginator.get_paginated_response(data))

    @extend_schema(
        request=CreatePerformerRequestSerializer, responses={201: OwnerPerformerSerializer}
    )
    def post(self, request: Request) -> Response:
        from config.di import build_performer_service

        payload = CreatePerformerRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = dict(payload.validated_data)

        performer = build_performer_service().create_performer(
            organization_id=data.pop("organization_id"),
            actor_id=cast(User, request.user).id,
            **data,
        )
        return _no_store(
            Response(
                OwnerPerformerSerializer(_with_photos([performer])[0]).data,
                status=status.HTTP_201_CREATED,
            )
        )


class PerformerOwnerDetailView(APIView):
    permission_classes = [IsMarketplaceUser]

    @extend_schema(responses={200: OwnerPerformerSerializer})
    def get(self, request: Request, performer_id: UUID) -> Response:
        performer = PerformerRepository().get_active_by_id(performer_id)
        # NotFound rather than PermissionDenied for somebody else's profile —
        # see the module's permissions docstring.
        if performer is None or str(performer.organization.owner_id) != str(request.user.id):
            raise NotFoundError("No performer with that id.")
        return _no_store(Response(OwnerPerformerSerializer(_with_photos([performer])[0]).data))

    @extend_schema(
        request=UpdatePerformerRequestSerializer, responses={200: OwnerPerformerSerializer}
    )
    def patch(self, request: Request, performer_id: UUID) -> Response:
        from config.di import build_performer_service

        payload = UpdatePerformerRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = dict(payload.validated_data)
        version = data.pop("version")

        performer = build_performer_service().update_performer(
            performer_id=performer_id,
            actor_id=cast(User, request.user).id,
            expected_version=version,
            changes=data,
        )
        return _no_store(Response(OwnerPerformerSerializer(_with_photos([performer])[0]).data))


class PerformerReadinessView(APIView):
    """What still stands between this draft and a submission.

    Its own endpoint so the studio can show the list BEFORE the owner presses
    submit — discovering the requirements from a rejected request is the
    failure mode this replaces.
    """

    permission_classes = [IsMarketplaceUser]

    @extend_schema(responses={200: ReadinessSerializer})
    def get(self, request: Request, performer_id: UUID) -> Response:
        performer = PerformerRepository().get_active_by_id(performer_id)
        if performer is None or str(performer.organization.owner_id) != str(request.user.id):
            raise NotFoundError("No performer with that id.")
        problems = readiness_problems(
            performer, PerformerMediaRepository().count_media(performer.id)
        )
        return _no_store(
            Response(ReadinessSerializer({"ready": not problems, "problems": problems}).data)
        )


class PerformerSubmitView(APIView):
    permission_classes = [IsMarketplaceUser]

    @extend_schema(request=None, responses={200: OwnerPerformerSerializer})
    def post(self, request: Request, performer_id: UUID) -> Response:
        from config.di import build_performer_service

        performer = build_performer_service().submit_for_review(
            performer_id=performer_id, actor_id=cast(User, request.user).id
        )
        return _no_store(Response(OwnerPerformerSerializer(_with_photos([performer])[0]).data))


class PerformerPauseView(APIView):
    permission_classes = [IsMarketplaceUser]

    @extend_schema(request=PauseSerializer, responses={200: OwnerPerformerSerializer})
    def post(self, request: Request, performer_id: UUID) -> Response:
        from config.di import build_performer_service

        payload = PauseSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        performer = build_performer_service().set_paused(
            performer_id=performer_id,
            actor_id=cast(User, request.user).id,
            paused=payload.validated_data["paused"],
        )
        return _no_store(Response(OwnerPerformerSerializer(_with_photos([performer])[0]).data))


class PerformerPhotoView(APIView):
    permission_classes = [IsMarketplaceUser]
    parser_classes = [MultiPartParser, FormParser]
    throttle_classes = [UploadThrottle]

    @extend_schema(request=UploadPhotoRequestSerializer, responses={201: PerformerPhotoSerializer})
    def post(self, request: Request, performer_id: UUID) -> Response:
        from config.di import build_performer_service

        payload = UploadPhotoRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        media = build_performer_service().upload_photo(
            performer_id=performer_id,
            actor_id=cast(User, request.user).id,
            upload=data["file"],
            alt_text=data["alt_text"],
            caption=data.get("caption", ""),
            position=data.get("position", 0),
        )
        return _no_store(
            Response(
                PerformerPhotoSerializer(
                    {
                        "id": str(media.id),
                        "url": media.url,
                        "alt_text": media.alt_text,
                        "caption": media.caption,
                        "position": media.position,
                    }
                ).data,
                status=status.HTTP_201_CREATED,
            )
        )


class PerformerPhotoDetailView(APIView):
    permission_classes = [IsMarketplaceUser]

    @extend_schema(responses={204: None})
    def delete(self, request: Request, performer_id: UUID, media_id: UUID) -> Response:
        from config.di import build_performer_service

        build_performer_service().remove_photo(
            performer_id=performer_id,
            actor_id=cast(User, request.user).id,
            media_id=media_id,
        )
        return _no_store(Response(status=status.HTTP_204_NO_CONTENT))


# -------------------------------------------------------- customer side


class BookingRequestListCreateView(APIView):
    """Serves BOTH flows; the URL decides which.

    `hire/requests`  -> kind=marketplace (a brief acts quote on)
    `hire/enquiries` -> kind=enquiry     (an operator answers it)

    Bound with `as_view(kind=...)` rather than sniffed from the path, so the
    routing table is the single statement of which URL means what and a new
    route cannot silently inherit the wrong flow. `kind` is declared here
    because Django's `as_view` refuses initkwargs that are not class
    attributes — the default is the safer of the two.
    """

    permission_classes = [IsMarketplaceUser]
    pagination_class = BookingRequestPagination
    kind = RequestKind.ENQUIRY

    @extend_schema(responses={200: BookingRequestSerializer(many=True)})
    def get(self, request: Request) -> Response:
        queryset = BookingRequestRepository().list_for_customer(
            cast(User, request.user).id, kind=self.kind
        )
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        rows = selectors.decorate_requests(list(page or []))
        data = cast(list, BookingRequestSerializer(rows, many=True).data)
        return _no_store(paginator.get_paginated_response(data))

    @extend_schema(
        request=CreateBookingRequestSerializer, responses={201: BookingRequestSerializer}
    )
    def post(self, request: Request) -> Response:
        from config.di import build_marketplace_service

        payload = CreateBookingRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        booking_request = build_marketplace_service().create_request(
            kind=self.kind, customer_id=cast(User, request.user).id, **payload.validated_data
        )
        rows = selectors.decorate_requests([booking_request])
        return _no_store(
            Response(BookingRequestSerializer(rows[0]).data, status=status.HTTP_201_CREATED)
        )


class BookingRequestDetailView(APIView):
    permission_classes = [IsMarketplaceUser]

    @extend_schema(responses={200: BookingRequestSerializer})
    def get(self, request: Request, request_id: UUID) -> Response:
        booking_request = BookingRequestRepository().get_by_id(request_id)
        if booking_request is None or str(booking_request.customer_id) != str(request.user.id):
            raise NotFoundError("No booking request with that id.")
        rows = selectors.decorate_requests([booking_request])
        return _no_store(Response(BookingRequestSerializer(rows[0]).data))

    @extend_schema(request=None, responses={200: BookingRequestSerializer})
    def delete(self, request: Request, request_id: UUID) -> Response:
        from config.di import build_marketplace_service

        booking_request = build_marketplace_service().cancel_request(
            request_id=request_id, customer_id=cast(User, request.user).id
        )
        rows = selectors.decorate_requests([booking_request])
        return _no_store(Response(BookingRequestSerializer(rows[0]).data))


class RequestQuotesView(APIView):
    """The quotes on one brief, cheapest first. Customer-only."""

    permission_classes = [IsMarketplaceUser]

    @extend_schema(responses={200: QuoteSerializer(many=True)})
    def get(self, request: Request, request_id: UUID) -> Response:
        booking_request = BookingRequestRepository().get_by_id(request_id)
        if booking_request is None or str(booking_request.customer_id) != str(request.user.id):
            raise NotFoundError("No booking request with that id.")
        rows = selectors.decorate_quotes(list(QuoteRepository().list_for_request(request_id)))
        return _no_store(Response({"data": QuoteSerializer(rows, many=True).data}))

    @extend_schema(request=SubmitQuoteSerializer, responses={201: PerformerQuoteSerializer})
    def post(self, request: Request, request_id: UUID) -> Response:
        """A PERFORMER answers this brief. Same URL, different actor — the
        service proves the caller owns the performer being quoted for."""
        from config.di import build_marketplace_service

        payload = SubmitQuoteSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        quote = build_marketplace_service().submit_quote(
            request_id=request_id,
            performer_id=payload.validated_data["performer_id"],
            actor_id=cast(User, request.user).id,
            amount_minor=payload.validated_data["amount_minor"],
            message=payload.validated_data.get("message", ""),
        )
        rows = selectors.decorate_performer_quotes([QuoteRepository().get_by_id(quote.id)])
        return _no_store(
            Response(PerformerQuoteSerializer(rows[0]).data, status=status.HTTP_201_CREATED)
        )


class QuoteAcceptView(APIView):
    permission_classes = [IsMarketplaceUser]

    @extend_schema(request=None, responses={200: QuoteSerializer})
    def post(self, request: Request, quote_id: UUID) -> Response:
        from config.di import build_marketplace_service

        quote = build_marketplace_service().accept_quote(
            quote_id=quote_id, customer_id=cast(User, request.user).id
        )
        rows = selectors.decorate_quotes([quote])
        return _no_store(Response(QuoteSerializer(rows[0]).data))


class QuoteWithdrawView(APIView):
    permission_classes = [IsMarketplaceUser]

    @extend_schema(request=None, responses={200: PerformerQuoteSerializer})
    def post(self, request: Request, quote_id: UUID) -> Response:
        from config.di import build_marketplace_service

        quote = build_marketplace_service().withdraw_quote(
            quote_id=quote_id, actor_id=cast(User, request.user).id
        )
        rows = selectors.decorate_performer_quotes([quote])
        return _no_store(Response(PerformerQuoteSerializer(rows[0]).data))


# ------------------------------------------------------- performer leads


class PerformerLeadsView(APIView):
    """Open briefs this act can serve. Matched on type, city and budget."""

    permission_classes = [IsMarketplaceUser]
    pagination_class = OpenRequestPagination

    @extend_schema(responses={200: OpenRequestSerializer(many=True)})
    def get(self, request: Request, performer_id: UUID) -> Response:
        performer = PerformerRepository().get_active_by_id(performer_id)
        if performer is None or str(performer.organization.owner_id) != str(request.user.id):
            raise NotFoundError("No performer with that id.")

        queryset = BookingRequestRepository().list_open_for_performer(performer)
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        rows = selectors.decorate_open_requests(list(page or []))
        data = cast(list, OpenRequestSerializer(rows, many=True).data)
        return _no_store(paginator.get_paginated_response(data))


class PerformerQuotesView(APIView):
    permission_classes = [IsMarketplaceUser]

    @extend_schema(responses={200: PerformerQuoteSerializer(many=True)})
    def get(self, request: Request, performer_id: UUID) -> Response:
        performer = PerformerRepository().get_active_by_id(performer_id)
        if performer is None or str(performer.organization.owner_id) != str(request.user.id):
            raise NotFoundError("No performer with that id.")
        rows = selectors.decorate_performer_quotes(
            list(QuoteRepository().list_for_performer(performer_id))
        )
        return _no_store(Response({"data": PerformerQuoteSerializer(rows, many=True).data}))


# ------------------------------------------------------------ moderation


class PerformerModerationQueueView(APIView):
    """The queue, or the record of past decisions. Staff only."""

    permission_classes = [IsPlatformAdmin]
    pagination_class = PerformerModerationPagination

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "status", str, description="pending_review (default) | live | rejected | archived"
            )
        ],
        responses={200: OwnerPerformerSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        wanted = request.query_params.get("status")
        queryset = PerformerRepository().list_for_moderation(status=wanted)
        # The paginator's ordering MUST match the queryset's — cursor
        # pagination does not check, and a mismatch silently returns wrong
        # pages rather than failing.
        paginator = (
            self.pagination_class()
            if wanted in (None, "", "pending_review")
            else PerformerModerationHistoryPagination()
        )
        page = paginator.paginate_queryset(queryset, request, view=self)
        data = cast(list, OwnerPerformerSerializer(_with_photos(list(page or [])), many=True).data)
        return _no_store(paginator.get_paginated_response(data))


class PerformerModerationDecisionView(APIView):
    permission_classes = [IsPlatformAdmin]

    @extend_schema(request=ModerationDecisionSerializer, responses={200: OwnerPerformerSerializer})
    def post(self, request: Request, performer_id: UUID) -> Response:
        from config.di import build_performer_moderation_service

        payload = ModerationDecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        performer = build_performer_moderation_service().moderate(
            performer_id=performer_id,
            actor_id=cast(User, request.user).id,
            approve=payload.validated_data["approve"],
            note=payload.validated_data.get("note", ""),
        )
        return _no_store(Response(OwnerPerformerSerializer(_with_photos([performer])[0]).data))


class PerformerFeatureView(APIView):
    permission_classes = [IsPlatformAdmin]

    @extend_schema(request=FeatureDecisionSerializer, responses={200: OwnerPerformerSerializer})
    def post(self, request: Request, performer_id: UUID) -> Response:
        from config.di import build_performer_moderation_service

        payload = FeatureDecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        performer = build_performer_moderation_service().set_featured(
            performer_id=performer_id,
            actor_id=cast(User, request.user).id,
            featured=payload.validated_data["featured"],
        )
        return _no_store(Response(OwnerPerformerSerializer(_with_photos([performer])[0]).data))
