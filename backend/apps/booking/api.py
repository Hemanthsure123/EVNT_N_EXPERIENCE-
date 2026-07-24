"""Thin views. Every response here is per-user private data → `private,
no-store`; nothing booking-related is edge- or browser-cacheable. Ownership
for writes is enforced in the service; the detail read checks it against the
loaded row."""

from __future__ import annotations

from typing import cast

from django.conf import settings
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from config.di import build_booking_service

from .exceptions import BookingNotFoundError, NotBookingOwnerError
from .pagination import MyTicketsCursorPagination
from .schemas import (
    BookingDetailSerializer,
    BookingSummarySerializer,
    CreateBookingRequestSerializer,
    TicketSerializer,
)
from .selectors import get_booking_detail, list_my_tickets


def _no_store(response: Response) -> Response:
    response["Cache-Control"] = "private, no-store"
    return response


class BookingCreateView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=CreateBookingRequestSerializer, responses={201: BookingSummarySerializer}
    )
    def post(self, request: Request) -> Response:
        payload = CreateBookingRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        # A client Idempotency-Key makes a double-click/retry return the original
        # booking instead of reserving twice.
        idempotency_key = request.headers.get("Idempotency-Key") or None

        service = build_booking_service()
        result = service.create_booking(
            user_id=cast(User, request.user).id,
            event_id=data["event_id"],
            items=list(data["items"]),
            idempotency_key=idempotency_key,
        )

        body = {
            "booking": BookingSummarySerializer(result.booking).data,
            "payment": {
                "order_id": result.payment_order_id,
                "amount_minor": result.amount_minor,
                "currency": result.currency,
                # Public checkout key for the frontend (safe to expose).
                "key_id": settings.RAZORPAY_KEY_ID,
            },
        }
        return _no_store(Response(body, status=status.HTTP_201_CREATED))


class BookingDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: BookingDetailSerializer})
    def get(self, request: Request, booking_id: str) -> Response:
        booking = get_booking_detail(booking_id)
        if booking is None:
            raise BookingNotFoundError(str(booking_id))
        if str(booking.user_id) != str(cast(User, request.user).id):
            raise NotBookingOwnerError()
        return _no_store(Response(BookingDetailSerializer(booking).data))


class BookingCancelView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: BookingSummarySerializer})
    def post(self, request: Request, booking_id: str) -> Response:
        service = build_booking_service()
        booking = service.cancel_booking(
            booking_id=booking_id, actor_id=cast(User, request.user).id
        )
        return _no_store(Response(BookingSummarySerializer(booking).data))


class MyTicketsView(APIView):
    permission_classes = [IsAuthenticated]
    pagination_class = MyTicketsCursorPagination

    @extend_schema(responses={200: TicketSerializer(many=True)})
    def get(self, request: Request) -> Response:
        queryset = list_my_tickets(cast(User, request.user).id)
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        data = cast(list, TicketSerializer(page, many=True).data)
        return _no_store(paginator.get_paginated_response(data))
