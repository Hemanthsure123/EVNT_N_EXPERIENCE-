"""Thin views. The public tier list is edge-cacheable display data (short
TTL — availability moves fast); create/edit are owner-only and never cached.
Ownership is enforced in the service (see permissions.py's note)."""

from __future__ import annotations

from typing import cast

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from config.di import build_ticketing_service
from core.http_caching import is_not_modified, make_etag, with_cache_headers

from .schemas import (
    CreateTicketTypeRequestSerializer,
    TicketTypeSerializer,
    UpdateTicketTypeRequestSerializer,
)
from .selectors import get_event_tiers_payload

# Short: this is volatile availability display; the reserve decision is
# authoritative regardless, so a few seconds of edge staleness is acceptable.
_TIERS_MAX_AGE = 5
_TIERS_S_MAXAGE = 5
_TIERS_SWR = 10


def _no_store(response: Response) -> Response:
    response["Cache-Control"] = "private, no-store"
    return response


def _to_service_changes(validated: dict) -> dict:
    """Map the API's money fields (minor units) onto their model field names."""
    changes = dict(validated)
    for api_name, model_name in (
        ("price", "price_minor"),
        ("early_bird_price", "early_bird_price_minor"),
    ):
        if api_name in changes:
            changes[model_name] = changes.pop(api_name)
    return changes


class TicketTypeListCreateView(APIView):
    def get_permissions(self) -> list[BasePermission]:
        if self.request.method == "POST":
            return [IsAuthenticated()]
        return [AllowAny()]

    @extend_schema(responses={200: TicketTypeSerializer(many=True)})
    def get(self, request: Request, event_id: str) -> Response:
        # Public availability display: identical for everyone, so a CDN may
        # cache it briefly.
        body = {"data": get_event_tiers_payload(event_id)}
        etag = make_etag(body)
        if is_not_modified(request, etag):
            return Response(status=status.HTTP_304_NOT_MODIFIED)
        return with_cache_headers(
            Response(body),
            etag=etag,
            max_age_seconds=_TIERS_MAX_AGE,
            private=False,
            s_maxage_seconds=_TIERS_S_MAXAGE,
            stale_while_revalidate_seconds=_TIERS_SWR,
        )

    @extend_schema(request=CreateTicketTypeRequestSerializer, responses={201: TicketTypeSerializer})
    def post(self, request: Request, event_id: str) -> Response:
        payload = CreateTicketTypeRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = dict(payload.validated_data)

        service = build_ticketing_service()
        ticket_type = service.create_ticket_type(
            event_id=event_id,
            actor_id=cast(User, request.user).id,
            name=data["name"],
            price_minor=data["price"],
            quantity=data["quantity"],
            sale_start=data.get("sale_start"),
            sale_end=data.get("sale_end"),
            max_per_order=data["max_per_order"],
            early_bird_price_minor=data.get("early_bird_price"),
            early_bird_ends_at=data.get("early_bird_ends_at"),
            early_bird_quantity=data.get("early_bird_quantity"),
        )
        return _no_store(
            Response(TicketTypeSerializer(ticket_type).data, status=status.HTTP_201_CREATED)
        )


class TicketTypeDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=UpdateTicketTypeRequestSerializer, responses={200: TicketTypeSerializer})
    def patch(self, request: Request, ticket_type_id: str) -> Response:
        payload = UpdateTicketTypeRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = dict(payload.validated_data)
        version = data.pop("version")

        service = build_ticketing_service()
        ticket_type = service.update_ticket_type(
            ticket_type_id=ticket_type_id,
            actor_id=cast(User, request.user).id,
            expected_version=version,
            changes=_to_service_changes(data),
        )
        return _no_store(Response(TicketTypeSerializer(ticket_type).data))
