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
from core.throttling import ShareReceiptThrottle

from .exceptions import BookingNotFoundError, NotBookingOwnerError
from .pagination import MyTicketsCursorPagination
from .schemas import (
    AssignAttendeesRequestSerializer,
    BookingDetailSerializer,
    BookingSummarySerializer,
    CreateBookingRequestSerializer,
    ShareReceiptRequestSerializer,
    ShareReceiptResponseSerializer,
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

        # WHICH PROVIDER, STATED PLAINLY.
        #
        # This used to return `RAZORPAY_KEY_ID` unconditionally, and the
        # frontend's only signal for "can a real checkout happen" was whether
        # that string was empty. Those are different questions, and a leftover
        # key in `.env` alongside `PAYMENTS_BACKEND=fake` made them disagree:
        # the funnel rendered a live "Pay ₹X" button that opened Razorpay
        # Checkout with a `fake_order_…` id, which Razorpay rejects outright.
        # A checkout that looks real and cannot work is worse than one that
        # says what it is, so the backend now names the provider it is actually
        # configured with and only sends the key when that provider is the one
        # the key belongs to.
        is_razorpay = settings.PAYMENTS_BACKEND == "razorpay"
        body = {
            "booking": BookingSummarySerializer(result.booking).data,
            "payment": {
                "order_id": result.payment_order_id,
                "amount_minor": result.amount_minor,
                "currency": result.currency,
                # "razorpay" | "fake" — what actually created the order above.
                "provider": settings.PAYMENTS_BACKEND,
                # Public checkout key for the frontend (safe to expose — it is
                # the public half; the secret signs webhooks and never leaves
                # the backend). Empty unless Razorpay is the live provider.
                "key_id": settings.RAZORPAY_KEY_ID if is_razorpay else "",
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


class BookingAttendeesView(APIView):
    """Name the people a booking's tickets are for, so each gets their own copy.

    Ownership, the paid-booking rule and the "every ticket must belong to this
    booking" check are all enforced in the service against the locked row —
    the view only parses.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=AssignAttendeesRequestSerializer, responses={200: TicketSerializer(many=True)}
    )
    def post(self, request: Request, booking_id: str) -> Response:
        payload = AssignAttendeesRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        service = build_booking_service()
        tickets = service.assign_attendees(
            booking_id=booking_id,
            actor_id=cast(User, request.user).id,
            assignments=list(payload.validated_data["assignments"]),
        )
        return _no_store(Response({"tickets": TicketSerializer(tickets, many=True).data}))


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


class ShareReceiptView(APIView):
    """Email this booking's receipt to people the buyer names.

    `private, no-store` like every other booking read: the request body is a
    list of somebody's friends' email addresses.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ShareReceiptThrottle]

    @extend_schema(
        request=ShareReceiptRequestSerializer,
        responses={202: ShareReceiptResponseSerializer},
        tags=["booking"],
    )
    def post(self, request: Request, booking_id: str) -> Response:
        payload = ShareReceiptRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        queued = build_booking_service().share_receipt(
            booking_id=booking_id,
            actor_id=cast(User, request.user).id,
            emails=list(payload.validated_data["emails"]),
            note=payload.validated_data.get("note", ""),
        )
        # 202: the mail is queued, not sent. A 200 here would assert delivery
        # that has not happened yet.
        return _no_store(Response({"queued": queued}, status=status.HTTP_202_ACCEPTED))
