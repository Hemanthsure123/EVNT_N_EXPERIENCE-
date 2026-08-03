"""Thin views for announcements.

The public read is `AllowAny` and edge-cacheable for the home placement; the
organizer and admin placements are authenticated and `private, no-store`,
because a banner about a payout delay is not for anonymous visitors.

The email side adds three public surfaces and two admin ones. The public three
are the interesting ones — they are the only unauthenticated writes in this
module, and each is deliberately uninformative about what it already knew.
"""

from __future__ import annotations

from typing import cast
from uuid import UUID

from django.http import HttpResponseRedirect
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from core.http_caching import is_not_modified, make_etag, with_cache_headers
from core.throttling import AnonWriteThrottle

from . import selectors
from .permissions import IsPlatformAdmin
from .repositories import AnnouncementRepository
from .schemas import (
    AdminAnnouncementSerializer,
    AnnouncementAnalyticsSerializer,
    BroadcastResultSerializer,
    LiveAnnouncementSerializer,
    PatchAnnouncementSerializer,
    SubscribeRequestSerializer,
    SubscribeResponseSerializer,
    UnsubscribeRequestSerializer,
    WriteAnnouncementSerializer,
)
from .throttling import SubscribeThrottle

_MAX_AGE = 30
_S_MAXAGE = 60
_SWR = 300


def _no_store(response: Response) -> Response:
    response["Cache-Control"] = "private, no-store"
    return response


def _service():
    from config.di import build_announcement_service

    return build_announcement_service()


# The three below come from `apps/announcements/di.py` for now — staged
# composition that belongs in `config/di.py`; see that module's docstring.
def _subscription_service():
    from .di import build_subscription_service

    return build_subscription_service()


def _broadcast_service():
    from .di import build_broadcast_service

    return build_broadcast_service()


def _click_tracking_service():
    from .di import build_click_tracking_service

    return build_click_tracking_service()


class LiveAnnouncementsView(APIView):
    def get_permissions(self) -> list[BasePermission]:
        # Only the attendee homepage is public. Everything else is staff- or
        # organizer-facing operational information.
        if self.request.query_params.get("placement", "home") == "home":
            return [AllowAny()]
        return [IsAuthenticated()]

    @extend_schema(
        parameters=[OpenApiParameter("placement", str, description="home | organizer | admin")],
        responses={200: LiveAnnouncementSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        placement = request.query_params.get("placement", "home")
        rows = selectors.get_live(placement)
        body = {"data": LiveAnnouncementSerializer(rows, many=True).data}

        if placement != "home":
            return _no_store(Response(body))

        etag = make_etag(body)
        if is_not_modified(request, etag):
            return Response(status=status.HTTP_304_NOT_MODIFIED)
        return with_cache_headers(
            Response(body),
            etag=etag,
            max_age_seconds=_MAX_AGE,
            private=False,
            s_maxage_seconds=_S_MAXAGE,
            stale_while_revalidate_seconds=_SWR,
        )


class AdminAnnouncementListView(APIView):
    permission_classes: list[type[BasePermission]] = [IsPlatformAdmin]

    @extend_schema(responses={200: AdminAnnouncementSerializer(many=True)})
    def get(self, request: Request) -> Response:
        rows = AnnouncementRepository().list_all()
        return _no_store(Response({"data": AdminAnnouncementSerializer(rows, many=True).data}))

    @extend_schema(
        request=WriteAnnouncementSerializer, responses={201: AdminAnnouncementSerializer}
    )
    def post(self, request: Request) -> Response:
        payload = WriteAnnouncementSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        announcement = _service().create(
            actor_id=cast(User, request.user).id, **payload.validated_data
        )
        return _no_store(
            Response(AdminAnnouncementSerializer(announcement).data, status=status.HTTP_201_CREATED)
        )


class AdminAnnouncementDetailView(APIView):
    permission_classes: list[type[BasePermission]] = [IsPlatformAdmin]

    @extend_schema(
        request=PatchAnnouncementSerializer, responses={200: AdminAnnouncementSerializer}
    )
    def patch(self, request: Request, announcement_id: UUID) -> Response:
        payload = PatchAnnouncementSerializer(data=request.data, partial=True)
        payload.is_valid(raise_exception=True)
        announcement = _service().update(
            actor_id=cast(User, request.user).id,
            announcement_id=announcement_id,
            **payload.validated_data,
        )
        return _no_store(Response(AdminAnnouncementSerializer(announcement).data))

    @extend_schema(responses={204: None})
    def delete(self, request: Request, announcement_id: UUID) -> Response:
        _service().delete(actor_id=cast(User, request.user).id, announcement_id=announcement_id)
        return _no_store(Response(status=status.HTTP_204_NO_CONTENT))


# --- the Curatix subscribe card ------------------------------------------


class SubscribeView(APIView):
    """`POST /subscribers` — the subscribe card's one call.

    ── ONE RESPONSE, WHATEVER HAPPENED ─────────────────────────────────────

    200 with `{"status": "subscribed"}` for a new address, a repeat, and a
    reactivation alike. Not 201-then-200, not "already subscribed", not a
    different error for an address we hold. This endpoint is public, and an
    attacker with a list of addresses could otherwise use it to learn which of
    them are known to this platform — and everyone on this list who has an
    account signed up with the same address.

    An authenticated caller is linked to their account automatically. They do
    NOT have to be signed in — a marketing card that demands an account first
    removes the affordance for exactly the people it exists to reach, which is
    the same reasoning `events.SavedEvent` follows.
    """

    permission_classes: list[type[BasePermission]] = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [SubscribeThrottle]

    @extend_schema(request=SubscribeRequestSerializer, responses={200: SubscribeResponseSerializer})
    def post(self, request: Request) -> Response:
        payload = SubscribeRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        # `authentication_classes = []` means `request.user` is anonymous even
        # when a token was sent, which is the right default for a public write
        # (a subscribe must never fail because somebody's token expired). The
        # account link is therefore only made when the client passes it, and
        # the field is not exposed — a caller cannot subscribe an address on
        # somebody else's behalf.
        _subscription_service().subscribe(
            email=payload.validated_data["email"],
            source=payload.validated_data.get("source", ""),
        )
        return _no_store(Response({"status": "subscribed"}))


class UnsubscribeView(APIView):
    """`POST /subscribers/unsubscribe` — honour the link in the email footer.

    ── WHY POST, WHEN THE LINK IN AN EMAIL IS A GET ────────────────────────

    Because corporate mail gateways, link scanners and preview fetchers follow
    every GET in a message. An unsubscribe implemented as a GET is one that
    security software silently presses on the recipient's behalf, and the
    person is removed from a list they never chose to leave. So the emailed
    link points at a page on the site, and the page makes this call.

    Also uniform in its answers: a valid token always returns 200, whether it
    unsubscribed somebody or found them already gone. Only a token that fails
    its signature is an error, because that is a tampered link rather than a
    person.
    """

    permission_classes: list[type[BasePermission]] = [AllowAny]
    authentication_classes: list = []
    throttle_classes = [AnonWriteThrottle]

    @extend_schema(
        request=UnsubscribeRequestSerializer, responses={200: SubscribeResponseSerializer}
    )
    def post(self, request: Request) -> Response:
        payload = UnsubscribeRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        _subscription_service().unsubscribe(token=payload.validated_data["token"])
        return _no_store(Response({"status": "unsubscribed"}))


class TrackedRedirectView(APIView):
    """`GET /a/{announcement_id}/r?to=<path>&d=<delivery_id>` — the click.

    Stamps the delivery and 302s to where the reader asked to go. The
    measurement is a side effect of a redirect they wanted anyway, which is
    what makes it a fact rather than an inference.

    ── `to` IS VALIDATED AS A SAME-ORIGIN PATH, ALWAYS ─────────────────────

    An unvalidated redirect reachable from a link in an email from us is a
    phishing gift: the trusted domain in front of the URL is the entire value
    of the attack, and this endpoint would be handing it over. `links.py` holds
    the rule — the same one the operator-authored banner link obeys.

    ── 302, NOT 301 ────────────────────────────────────────────────────────

    A permanent redirect is cached by the browser, so every click after the
    first would skip this endpoint entirely and the measurement would silently
    stop after the first reader in each browser.
    """

    permission_classes: list[type[BasePermission]] = [AllowAny]
    authentication_classes: list = []

    @extend_schema(
        parameters=[
            OpenApiParameter("to", str, description="Same-origin path to land on, e.g. /events"),
            OpenApiParameter("d", str, description="Delivery id from the email; optional"),
        ],
        responses={302: None},
    )
    def get(self, request: Request, announcement_id: UUID) -> HttpResponseRedirect:
        destination = _click_tracking_service().record_click(
            announcement_id=announcement_id,
            to=request.query_params.get("to", "/"),
            # A malformed `d` is treated as ABSENT rather than as an error: the
            # reader pressed a link and must arrive at the page regardless, and
            # the worst case is one click nobody counted. Same reasoning as the
            # organizer lists' malformed date filters.
            delivery_id=_optional_uuid(request.query_params.get("d")),
        )
        response = HttpResponseRedirect(destination)
        # Never cached, by anything. A tracking URL whose response is reusable
        # is a tracking URL that stops tracking.
        response["Cache-Control"] = "private, no-store"
        return response


def _optional_uuid(raw: str | None) -> UUID | None:
    if not raw:
        return None
    try:
        return UUID(raw)
    except ValueError:
        return None


# --- admin: send, and measure --------------------------------------------


class AdminBroadcastView(APIView):
    """`POST /admin/announcements/{id}/send` — queue the campaign.

    Creates the delivery rows and enqueues; it does not send. The response is
    a receipt for what was queued, so an operator who presses Send twice sees
    `newly_queued: 0` rather than being told nothing happened.
    """

    permission_classes: list[type[BasePermission]] = [IsPlatformAdmin]

    @extend_schema(request=None, responses={202: BroadcastResultSerializer})
    def post(self, request: Request, announcement_id: UUID) -> Response:
        result = _broadcast_service().queue_broadcast(
            actor_id=cast(User, request.user).id, announcement_id=announcement_id
        )
        return _no_store(
            Response(BroadcastResultSerializer(result).data, status=status.HTTP_202_ACCEPTED)
        )


class AdminAnnouncementAnalyticsView(APIView):
    """`GET /admin/announcements/{id}/analytics` — the four figures.

    Four, and no fifth. There is no `opened` because a tracking pixel measures
    Apple's Mail Privacy Protection and Gmail's image cache rather than a
    person, and this platform does not put a number on screen that it cannot
    stand behind.
    """

    permission_classes: list[type[BasePermission]] = [IsPlatformAdmin]

    @extend_schema(responses={200: AnnouncementAnalyticsSerializer})
    def get(self, request: Request, announcement_id: UUID) -> Response:
        payload = selectors.get_announcement_analytics(announcement_id)
        return _no_store(Response(AnnouncementAnalyticsSerializer(payload).data))
