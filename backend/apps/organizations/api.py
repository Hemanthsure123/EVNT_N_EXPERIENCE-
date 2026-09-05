"""Thin views: parse/validate at the boundary (schemas.py), call a service
or selector, serialize the result. No business rules here — ownership
enforcement lives in services.py (see permissions.py's docstring for why)."""

from __future__ import annotations

from typing import cast

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from config.di import (
    build_organization_follow_service,
    build_organization_service,
    cache_port,
)
from core.http_caching import is_not_modified, make_etag, with_cache_headers

from .exceptions import OrganizationNotFoundError, VerificationNotFoundError
from .pagination import FollowingCursorPagination, OrganizationCursorPagination
from .schemas import (
    CreateOrganizationRequestSerializer,
    FollowedOrganizationSerializer,
    FollowRequestSerializer,
    FollowStateSerializer,
    NotifyPreferenceSerializer,
    OrganizationDetailSerializer,
    OrganizationSummarySerializer,
    SubmitVerificationRequestSerializer,
    UpdateOrganizationRequestSerializer,
    VerificationRecordSerializer,
)
from .selectors import (
    ORG_LIST_TTL_SECONDS,
    get_organization_detail_payload,
    list_followed_organizations,
    list_my_organizations,
    org_owner_list_cache_key,
)


def _no_store(response: Response) -> Response:
    """Per-user responses must never be stored by a browser or a shared cache.

    Every follow response is one: `is_following` and `notify` are facts about
    the caller, and a shared cache that kept one would hand somebody else's
    subscription state to the next reader of the same URL.
    """
    response["Cache-Control"] = "private, no-store"
    return response


class OrganizationListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    pagination_class = OrganizationCursorPagination

    @extend_schema(responses={200: OrganizationSummarySerializer(many=True)})
    def get(self, request: Request) -> Response:
        # Cache-aside, first page only: the vast majority of requests to a
        # "my organizations" list want page 1, so that's the only page
        # worth caching — deeper pages (a ?cursor param present) always hit
        # the DB. Caches the fully rendered payload (including DRF's own
        # cursor-encoded "next" link) rather than raw rows, since
        # replicating DRF's cursor token format by hand would be fragile.
        user = cast(User, request.user)
        cache = cache_port()
        is_first_page = "cursor" not in request.query_params
        cache_key = org_owner_list_cache_key(user.id)

        if is_first_page:
            cached = cache.get(cache_key)
            if cached is not None:
                return Response(cached)

        queryset = list_my_organizations(user.id)
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        # drf-stubs types .data as ReturnDict regardless of many=True/False;
        # with many=True it's actually a ReturnList (a list subclass).
        data = cast(list, OrganizationSummarySerializer(page, many=True).data)
        response = paginator.get_paginated_response(data)

        if is_first_page:
            cache.set(cache_key, response.data, timeout_seconds=ORG_LIST_TTL_SECONDS)

        return response

    @extend_schema(
        request=CreateOrganizationRequestSerializer, responses={201: OrganizationDetailSerializer}
    )
    def post(self, request: Request) -> Response:
        payload = CreateOrganizationRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        service = build_organization_service()
        org = service.create_organization(
            owner_id=cast(User, request.user).id, **payload.validated_data
        )

        return Response(OrganizationDetailSerializer(org).data, status=status.HTTP_201_CREATED)


class OrganizationDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: OrganizationDetailSerializer})
    def get(self, request: Request, organization_id: str) -> Response:
        """The organization as any signed-in reader sees it.

        Deliberately NOT owner-scoped: a follower reads this to see who they
        follow and how many others do, which is why the payload is cached under
        one shared `org:{id}` key and why `get_follower_count` refuses to carry
        per-user state.

        WHAT CHANGED, AND WHY IT MATTERED: this used to serialize
        `payout_account_id` — the organization's Razorpay linked-account id —
        into that shared body. Every event card on the public site carries
        `organization_id`, so any signed-in account could read a public event,
        take the id straight off it, and ask this endpoint for the payout
        account of a business they had nothing to do with. The serializer now
        publishes `payout_account_linked`, a boolean, which is the only thing
        any caller ever actually did with the value.
        """
        payload = get_organization_detail_payload(organization_id)
        if payload is None:
            raise OrganizationNotFoundError(str(organization_id))

        etag = make_etag(payload)
        if is_not_modified(request, etag):
            return Response(status=status.HTTP_304_NOT_MODIFIED)

        # private: this response's content depends on the org existing and
        # being readable by this request — never let a shared/CDN cache
        # serve it to a different, unauthenticated requester.
        return with_cache_headers(Response(payload), etag=etag, max_age_seconds=30)

    @extend_schema(
        request=UpdateOrganizationRequestSerializer, responses={200: OrganizationDetailSerializer}
    )
    def patch(self, request: Request, organization_id: str) -> Response:
        payload = UpdateOrganizationRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        service = build_organization_service()
        org = service.update_organization(
            organization_id=organization_id,
            actor_id=cast(User, request.user).id,
            **payload.validated_data,
        )

        return Response(OrganizationDetailSerializer(org).data)


class OrganizationVerificationView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: VerificationRecordSerializer})
    def get(self, request: Request, organization_id: str) -> Response:
        """Where this organization's verification stands, for its OWNER.

        404 when nothing has ever been submitted — a real state, and the one
        that tells the UI to offer the form instead of a status. Never
        cached: it changes the moment an operator decides, and a stale
        "pending" would leave an approved organizer waiting.
        """
        service = build_organization_service()
        record = service.get_latest_verification(
            organization_id=organization_id, actor_id=cast(User, request.user).id
        )
        if record is None:
            raise VerificationNotFoundError()

        response = Response(VerificationRecordSerializer(record).data)
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(
        request=SubmitVerificationRequestSerializer, responses={201: VerificationRecordSerializer}
    )
    def post(self, request: Request, organization_id: str) -> Response:
        payload = SubmitVerificationRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        service = build_organization_service()
        record = service.submit_verification(
            organization_id=organization_id,
            actor_id=cast(User, request.user).id,
            **payload.validated_data,
        )

        return Response(VerificationRecordSerializer(record).data, status=status.HTTP_201_CREATED)


class OrganizationPayoutAccountView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: OrganizationDetailSerializer})
    def post(self, request: Request, organization_id: str) -> Response:
        service = build_organization_service()
        org = service.link_payout_account(
            organization_id=organization_id, actor_id=cast(User, request.user).id
        )

        return Response(OrganizationDetailSerializer(org).data)


class OrganizationFollowView(APIView):
    """Follow / unfollow an organization, and the notification flag on it.

    ── WHY THIS IS A SEPARATE ENDPOINT FROM THE ORGANIZATION PAYLOAD ────

    `GET /organizations/{id}` is cached twice over: server-side under
    `org:{id}` (one payload shared by every reader) and in the browser via
    `ETag` + `private, max-age=30`. `follower_count` is safe in there because
    it is the same number for everybody. `is_following` and `notify` are not:
    putting them in that body would mean either serving one user's follow
    state to the next reader of the shared entry, or keying the cache per user
    — turning one hot key into one cold key per visitor and giving up the
    30-second browser cache on a payload that is otherwise identical for
    everyone.

    So the per-user half lives here, on its own `private, no-store` endpoint,
    and the organizer tab makes one extra small request for it. That is the
    trade: one indexed lookup, in exchange for keeping the expensive response
    shareable and provably free of anyone else's data.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: FollowStateSerializer})
    def get(self, request: Request, organization_id: str) -> Response:
        state = build_organization_follow_service().get_state(
            user_id=cast(User, request.user).id, organization_id=organization_id
        )
        return _no_store(Response(FollowStateSerializer(state).data))

    @extend_schema(request=FollowRequestSerializer, responses={200: FollowStateSerializer})
    def post(self, request: Request, organization_id: str) -> Response:
        """Follow. Idempotent — a second press returns the same state.

        200 rather than 201 for the same reason: the caller's intent is "I
        follow this", which is true whether or not this call is what made it
        true, and a UI that has to branch on 201-vs-200 to draw one button will
        eventually branch wrong.
        """
        payload = FollowRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        state = build_organization_follow_service().follow(
            user_id=cast(User, request.user).id,
            organization_id=organization_id,
            # Absent means "no opinion", which is NOT the same as False — see
            # OrganizationFollowRepository.follow.
            notify=payload.validated_data.get("notify"),
        )
        return _no_store(Response(FollowStateSerializer(state).data))

    @extend_schema(responses={200: FollowStateSerializer})
    def delete(self, request: Request, organization_id: str) -> Response:
        """Unfollow. Idempotent, and returns the state rather than a bare 204 so
        the button gets the real follower count back instead of decrementing
        its own copy."""
        state = build_organization_follow_service().unfollow(
            user_id=cast(User, request.user).id, organization_id=organization_id
        )
        return _no_store(Response(FollowStateSerializer(state).data))

    @extend_schema(request=NotifyPreferenceSerializer, responses={200: FollowStateSerializer})
    def patch(self, request: Request, organization_id: str) -> Response:
        """Turn notifications on or off WITHOUT unfollowing."""
        payload = NotifyPreferenceSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        state = build_organization_follow_service().set_notify(
            user_id=cast(User, request.user).id,
            organization_id=organization_id,
            notify=payload.validated_data["notify"],
        )
        return _no_store(Response(FollowStateSerializer(state).data))


class FollowingListView(APIView):
    """The caller's followed organizations, newest first.

    Cursor-paginated on the same ordering as `org_follow_user_recent_idx`, and
    one query for the page: the organization's card fields come back through a
    `select_related` join rather than a lookup per row.
    """

    permission_classes = [IsAuthenticated]
    pagination_class = FollowingCursorPagination

    @extend_schema(responses={200: FollowedOrganizationSerializer(many=True)})
    def get(self, request: Request) -> Response:
        queryset = list_followed_organizations(cast(User, request.user).id)
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        # drf-stubs types .data as ReturnDict regardless of many=True/False;
        # with many=True it's actually a ReturnList (a list subclass).
        data = cast(list, FollowedOrganizationSerializer(page, many=True).data)
        # Never cached, not even for 30 seconds: this is one person's
        # subscription list, and it is also the list that changes the instant
        # they press Follow anywhere else on the site.
        return _no_store(paginator.get_paginated_response(data))
