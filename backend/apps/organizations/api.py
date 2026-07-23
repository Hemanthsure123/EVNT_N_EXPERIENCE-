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
from config.di import build_organization_service, cache_port
from core.http_caching import is_not_modified, make_etag, with_cache_headers

from .exceptions import OrganizationNotFoundError
from .pagination import OrganizationCursorPagination
from .schemas import (
    CreateOrganizationRequestSerializer,
    OrganizationDetailSerializer,
    OrganizationSummarySerializer,
    SubmitVerificationRequestSerializer,
    UpdateOrganizationRequestSerializer,
    VerificationRecordSerializer,
)
from .selectors import (
    ORG_LIST_TTL_SECONDS,
    get_organization_detail_payload,
    list_my_organizations,
    org_owner_list_cache_key,
)


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
