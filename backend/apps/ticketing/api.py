"""Thin views. The public tier list is edge-cacheable display data (short
TTL — availability moves fast); create/edit are owner-only and never cached.
Ownership is enforced in the service (see permissions.py's note)."""

from __future__ import annotations

from typing import cast

from drf_spectacular.utils import OpenApiParameter, extend_schema
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


def _to_service_phases(phases: list[dict] | None) -> list[dict] | None:
    """Map each submitted phase's `price` (minor units) onto the model's
    `price_minor`. `None` (absent from the request) stays `None` — an empty
    list means "clear the schedule" and must survive as one."""
    if phases is None:
        return None
    return [
        {
            "name": phase["name"],
            "price_minor": phase["price"],
            "ends_at": phase.get("ends_at"),
            "quantity": phase.get("quantity"),
        }
        for phase in phases
    ]


def _to_service_changes(validated: dict) -> dict:
    """Map the API's money fields (minor units) onto their model field names."""
    changes = dict(validated)
    if "price" in changes:
        changes["price_minor"] = changes.pop("price")
    if "phases" in changes:
        changes["phases"] = _to_service_phases(changes["phases"])
    return changes


class TicketTypeListCreateView(APIView):
    def get_permissions(self) -> list[BasePermission]:
        if self.request.method == "POST":
            return [IsAuthenticated()]
        return [AllowAny()]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "slot",
                str,
                description=(
                    "Only tiers selling this session. An unknown or malformed id "
                    "returns an EMPTY list rather than every tier — a chooser that "
                    "silently falls back to 'all sessions' is how somebody buys a "
                    "ticket for the wrong show."
                ),
            )
        ],
        responses={200: TicketTypeSerializer(many=True)},
    )
    def get(self, request: Request, event_id: str) -> Response:
        # Public availability display: identical for everyone, so a CDN may
        # cache it briefly.
        rows = get_event_tiers_payload(event_id)
        slot = request.query_params.get("slot")
        if slot:
            # Filtered HERE rather than with a cache key per session. The whole
            # tier list for one event is a handful of rows already in Redis, so
            # a second key per slot would multiply the invalidation surface to
            # save a list comprehension. `str()` on both sides because the
            # value is a UUID before the cache round-trip and a string after.
            rows = [row for row in rows if str(row.get("slot_id")) == slot]
        body = {"data": rows}
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
            phases=_to_service_phases(data.get("phases")),
            slot_id=data.get("slot_id"),
            description=data.get("description", ""),
            perks=data.get("perks"),
            position=data.get("position", 0),
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
