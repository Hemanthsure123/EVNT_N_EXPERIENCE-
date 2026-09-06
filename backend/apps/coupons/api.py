"""HTTP boundary for coupons. Thin, as every view in this codebase is.

Two audiences, two shapes:

- `/organizations/{id}/coupons` — the organizer's promotions list. Authenticated
  at the request layer; OWNERSHIP is proven inside `CouponService`, which scopes
  every query by organization rather than fetching a row and then comparing, so
  a coupon belonging to somebody else is never loaded. `private, no-store`: it
  is an owner's own commercial terms.
- `/events/{id}/offers` — the codes an organizer chose to ADVERTISE. Identical
  for everyone who asks, so it is genuinely `public` and an edge cache can
  absorb it. It carries the terms and never the limits.

The code a customer TYPES is not here. It applies to a booking, so it lives on
`POST /bookings/{id}/coupon` beside the donation endpoint, for the reasons in
`CouponRedemptionService`'s docstring.
"""

from __future__ import annotations

from typing import cast

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from core.errors import NotFoundError
from core.http_caching import is_not_modified, make_etag, with_cache_headers

from .schemas import (
    CouponSerializer,
    CreateCouponRequestSerializer,
    PublicOfferSerializer,
    UpdateCouponRequestSerializer,
)

#: How long a browser and an edge cache may keep the offers list.
#:
#: Short, because a code can be exhausted by somebody else's booking at any
#: moment and this list excludes exhausted codes. A stale entry advertises a
#: coupon that will be refused — recoverable (the refusal names the reason) but
#: exactly the kind of contradiction this platform avoids, so the window is
#: measured in seconds rather than minutes.
OFFERS_MAX_AGE_SECONDS = 30
OFFERS_S_MAXAGE_SECONDS = 60
OFFERS_STALE_WHILE_REVALIDATE_SECONDS = 30


def _no_store(response: Response) -> Response:
    response["Cache-Control"] = "private, no-store"
    return response


class _OrganizerCouponView(APIView):
    permission_classes: list = [IsAuthenticated]

    @property
    def _service(self):
        from config.di import build_coupon_service

        return build_coupon_service()

    @property
    def _actor(self):
        return cast(User, self.request.user).id


class CouponListView(_OrganizerCouponView):
    @extend_schema(responses={200: CouponSerializer(many=True)})
    def get(self, request: Request, organization_id: str) -> Response:
        rows, usage = self._service.list_coupons(
            organization_id=organization_id, actor_id=self._actor
        )
        # `redeemed_count` is grafted on from ONE aggregate over the whole page.
        # Resolving it per row is the N+1 the performance checklist exists to
        # stop, and a promotions list is exactly where one would go unnoticed.
        data = [
            {**CouponSerializer(row).data, "redeemed_count": usage.get(str(row.id), 0)}
            for row in rows
        ]
        return _no_store(Response({"data": data}))

    @extend_schema(request=CreateCouponRequestSerializer, responses={201: CouponSerializer})
    def post(self, request: Request, organization_id: str) -> Response:
        payload = CreateCouponRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        coupon = self._service.create_coupon(
            organization_id=organization_id, actor_id=self._actor, **payload.validated_data
        )
        return _no_store(
            Response(
                {**CouponSerializer(coupon).data, "redeemed_count": 0},
                status=status.HTTP_201_CREATED,
            )
        )


class CouponDetailView(_OrganizerCouponView):
    @extend_schema(responses={200: CouponSerializer})
    def get(self, request: Request, organization_id: str, coupon_id: str) -> Response:
        coupon, redeemed = self._service.get_coupon(
            organization_id=organization_id, actor_id=self._actor, coupon_id=coupon_id
        )
        return _no_store(Response({**CouponSerializer(coupon).data, "redeemed_count": redeemed}))

    @extend_schema(request=UpdateCouponRequestSerializer, responses={200: CouponSerializer})
    def patch(self, request: Request, organization_id: str, coupon_id: str) -> Response:
        payload = UpdateCouponRequestSerializer(data=request.data, partial=True)
        payload.is_valid(raise_exception=True)
        coupon, redeemed = self._service.update_coupon(
            organization_id=organization_id,
            actor_id=self._actor,
            coupon_id=coupon_id,
            **payload.validated_data,
        )
        return _no_store(Response({**CouponSerializer(coupon).data, "redeemed_count": redeemed}))

    @extend_schema(responses={204: None})
    def delete(self, request: Request, organization_id: str, coupon_id: str) -> Response:
        self._service.delete_coupon(
            organization_id=organization_id, actor_id=self._actor, coupon_id=coupon_id
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class EventOffersView(APIView):
    """The advertised codes for one event. Unauthenticated and edge-cacheable.

    Absent, not empty, is the caller's job: the response is a list, and a
    checkout with nothing in it renders no offers section at all rather than an
    empty panel implying the organizer forgot.
    """

    permission_classes: list = [AllowAny]
    authentication_classes: list = []

    @extend_schema(responses={200: PublicOfferSerializer(many=True)})
    def get(self, request: Request, event_id: str) -> Response:
        from django.utils import timezone

        from apps.events.repositories import EventRepository

        from .selectors import public_offers_for_event

        # The EVENT decides the organization, exactly as the redemption path
        # does — there is no request shape that points one organizer's codes at
        # another's tickets. A draft or withdrawn event answers 404 here for the
        # same reason its ticket types do: it is not on sale.
        event = EventRepository().get_published_by_id(event_id)
        if event is None:
            raise NotFoundError("Event not found.")

        offers = public_offers_for_event(
            organization_id=event.organization_id, event_id=event.id, now=timezone.now()
        )
        payload = {"data": PublicOfferSerializer(offers, many=True).data}
        etag = make_etag(payload)
        if is_not_modified(request, etag):
            return with_cache_headers(
                Response(status=status.HTTP_304_NOT_MODIFIED),
                etag=etag,
                max_age_seconds=OFFERS_MAX_AGE_SECONDS,
                private=False,
                s_maxage_seconds=OFFERS_S_MAXAGE_SECONDS,
                stale_while_revalidate_seconds=OFFERS_STALE_WHILE_REVALIDATE_SECONDS,
            )
        return with_cache_headers(
            Response(payload),
            etag=etag,
            max_age_seconds=OFFERS_MAX_AGE_SECONDS,
            private=False,
            s_maxage_seconds=OFFERS_S_MAXAGE_SECONDS,
            stale_while_revalidate_seconds=OFFERS_STALE_WHILE_REVALIDATE_SECONDS,
        )
