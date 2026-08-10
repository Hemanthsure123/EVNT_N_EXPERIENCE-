"""Thin views for reviews.

Cache policy, stated once: the two PUBLIC reads (an event's reviews and its
summary) are identical for everybody and safe for a CDN, so they carry the same
`public` headers the events browse endpoints do. Everything keyed to WHO is
asking — eligibility, pending prompts — is `private, no-store`, because a
shared cache serving one person's "you can review this" to another is the
failure the events module's own note warns about.
"""

from __future__ import annotations

from typing import cast
from uuid import UUID

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config.di import build_review_service
from core.http_caching import is_not_modified, make_etag, with_cache_headers
from core.pagination import CursorPagination
from core.throttling import ReviewWriteThrottle

from .repositories import ReviewRepository
from .schemas import (
    EligibilitySerializer,
    ModerationRequestSerializer,
    PendingReviewSerializer,
    ReviewSerializer,
    ReviewSummarySerializer,
    SubmitReviewRequestSerializer,
)
from .selectors import get_review_summary


def _no_store(response: Response) -> Response:
    response["Cache-Control"] = "private, no-store"
    return response


#: A minute in the browser, five at the edge, and a further five where a stale
#: copy may be served while the edge refreshes. Reviews change rarely and are
#: identical for everybody, so this is the same shape the public events
#: endpoints use — the edge absorbs the traffic a popular event generates.
_PUBLIC_MAX_AGE = 60
_PUBLIC_S_MAXAGE = 300
_PUBLIC_SWR = 300


def _public(request: Request, body: dict) -> Response:
    """A public, CDN-cacheable read with an ETag and a 304 short-circuit."""
    etag = make_etag(body)
    if is_not_modified(request, etag):
        return Response(status=status.HTTP_304_NOT_MODIFIED)
    return with_cache_headers(
        Response(body),
        etag=etag,
        max_age_seconds=_PUBLIC_MAX_AGE,
        private=False,
        s_maxage_seconds=_PUBLIC_S_MAXAGE,
        stale_while_revalidate_seconds=_PUBLIC_SWR,
    )


class ReviewPagination(CursorPagination):
    #: Matches `review_event_recent_idx` and the repository's ordering. A
    #: paginator whose ordering disagrees with its queryset does not fail — it
    #: returns wrong pages silently, which is why this is restated rather than
    #: inherited.
    ordering = ("-created_at", "-id")


class EventReviewsView(APIView):
    """`GET` the public list, `POST` your own. Two audiences, one URL."""

    permission_classes = [AllowAny]

    def get_permissions(self):
        # Reading is public; writing is not. Declared here rather than as two
        # views so the URL stays the resource.
        if self.request.method == "POST":
            return [IsAuthenticated()]
        return [AllowAny()]

    def get_throttles(self):
        # Only the write side is metered. Throttling the public read would
        # rate-limit a CDN origin fetch.
        return [ReviewWriteThrottle()] if self.request.method == "POST" else []

    @extend_schema(responses=ReviewSerializer(many=True), tags=["reviews"])
    def get(self, request: Request, event_id: UUID) -> Response:
        rows = ReviewRepository().list_published(event_id)
        paginator = ReviewPagination()
        page = paginator.paginate_queryset(rows, request, view=self)
        data = cast(list, ReviewSerializer(page or [], many=True).data)
        return _public(request, paginator.get_paginated_response(data).data)

    @extend_schema(
        request=SubmitReviewRequestSerializer,
        responses={201: ReviewSerializer},
        tags=["reviews"],
    )
    def post(self, request: Request, event_id: UUID) -> Response:
        payload = SubmitReviewRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        review = build_review_service().submit(
            event_id=event_id,
            user_id=request.user.id,
            rating=payload.validated_data["rating"],
            body=payload.validated_data.get("body", ""),
        )
        return _no_store(Response(ReviewSerializer(review).data, status=status.HTTP_201_CREATED))


class EventReviewSummaryView(APIView):
    """Average, count and the 1-5 distribution."""

    permission_classes = [AllowAny]

    @extend_schema(responses=ReviewSummarySerializer, tags=["reviews"])
    def get(self, request: Request, event_id: UUID) -> Response:
        summary = get_review_summary(event_id)
        return _public(
            request,
            {
                "average": summary.average,
                "count": summary.count,
                "distribution": summary.distribution,
            },
        )


class MyEventReviewView(APIView):
    """Your own review of this event: read it, or change it."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: ReviewSerializer}, tags=["reviews"])
    def get(self, request: Request, event_id: UUID) -> Response:
        review = ReviewRepository().get_for_user(event_id=event_id, user_id=request.user.id)
        if review is None:
            # 204 rather than 404: the EVENT exists and the request was
            # answered — there is simply nothing of yours on it. A 404 here
            # reads as a broken URL in a client's error handling.
            return _no_store(Response(status=status.HTTP_204_NO_CONTENT))
        return _no_store(Response(ReviewSerializer(review).data))

    @extend_schema(
        request=SubmitReviewRequestSerializer, responses={200: ReviewSerializer}, tags=["reviews"]
    )
    def patch(self, request: Request, event_id: UUID) -> Response:
        payload = SubmitReviewRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        review = build_review_service().update(
            event_id=event_id,
            user_id=request.user.id,
            rating=payload.validated_data["rating"],
            body=payload.validated_data.get("body", ""),
        )
        return _no_store(Response(ReviewSerializer(review).data))


class ReviewEligibilityView(APIView):
    """May I review this? Answered by the same service the write uses.

    Exists so the UI can show the right thing instead of a form that 422s — it
    is NOT the enforcement point. `submit` re-checks every rule.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=EligibilitySerializer, tags=["reviews"])
    def get(self, request: Request, event_id: UUID) -> Response:
        result = build_review_service().check_eligibility(
            event_id=event_id, user_id=request.user.id
        )
        return _no_store(
            Response(
                {
                    "allowed": result.allowed,
                    "reason": result.reason,
                    "verified_attendee": result.verified_attendee,
                }
            )
        )


class PendingReviewsView(APIView):
    """What to prompt this person about. Derived, never stored."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=PendingReviewSerializer(many=True), tags=["reviews"])
    def get(self, request: Request) -> Response:
        pending = build_review_service().pending_for_user(user_id=request.user.id)
        return _no_store(Response({"data": PendingReviewSerializer(pending, many=True).data}))


class AdminReviewsView(APIView):
    """The moderation queue. Staff only."""

    permission_classes = [IsAdminUser]

    @extend_schema(
        parameters=[OpenApiParameter("status", str)],
        responses=ReviewSerializer(many=True),
        tags=["reviews"],
    )
    def get(self, request: Request) -> Response:
        rows = ReviewRepository().list_for_moderation(
            status=request.query_params.get("status") or None
        )
        paginator = ReviewPagination()
        page = paginator.paginate_queryset(rows, request, view=self)
        data = cast(list, ReviewSerializer(page or [], many=True).data)
        return _no_store(paginator.get_paginated_response(data))


class AdminReviewModerationView(APIView):
    permission_classes = [IsAdminUser]

    @extend_schema(
        request=ModerationRequestSerializer, responses={200: ReviewSerializer}, tags=["reviews"]
    )
    def post(self, request: Request, review_id: UUID) -> Response:
        payload = ModerationRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        review = build_review_service().set_moderation(
            review_id=review_id, status=payload.validated_data["status"]
        )
        return _no_store(Response(ReviewSerializer(review).data))
