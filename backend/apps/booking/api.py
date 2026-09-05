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
from .pagination import MyBookingsCursorPagination, MyTicketsCursorPagination
from .schemas import (
    AssignAttendeesRequestSerializer,
    BookingDetailSerializer,
    BookingSummarySerializer,
    CreateBookingRequestSerializer,
    MyBookingSerializer,
    SetDonationRequestSerializer,
    ShareReceiptRequestSerializer,
    ShareReceiptResponseSerializer,
    TicketSerializer,
)
from .selectors import get_booking_detail, list_my_bookings, list_my_tickets


def _no_store(response: Response) -> Response:
    response["Cache-Control"] = "private, no-store"
    return response


class BookingCreateView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=CreateBookingRequestSerializer, responses={201: BookingDetailSerializer})
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
            donation_minor=data.get("donation_minor", 0),
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
        # Re-read with the DETAIL shape — one query plus two prefetches, and
        # bounded. Serializing `result.booking` directly would lazily load
        # `items` and then `ticket_type` ONCE PER LINE, which is an N+1 on the
        # money path; this is also the identical query `GET /bookings/{id}`
        # issues, so the two responses cannot describe the same booking
        # differently. It picks up `payment_order_id`, which is written after
        # the reserve transaction commits.
        detail = get_booking_detail(result.booking.id) or result.booking

        is_razorpay = settings.PAYMENTS_BACKEND == "razorpay"
        body = {
            # ── THE DETAIL SERIALIZER, NOT THE SUMMARY ───────────────────
            #
            # The summary carries no `items`, and the checkout's review screen
            # is the one surface that most needs them. Without them it fell back
            # to pricing the order from the SELECTION — an estimate built from
            # the tier payload — while the total beside it came from the booking.
            # The two disagree whenever the locked reserve decides a different
            # price from the one the display was cached with, which is exactly
            # what a live sale phase does: the screen showed "Order amount
            # ₹1,995" over "Grand total ₹407.99" and neither number was wrong on
            # its own.
            #
            # It also re-arms a guard that had quietly stopped working. The
            # review screen compares `booking.items` against the URL's selection
            # to notice that somebody went back and changed their order — with
            # no items on this response that comparison could never fire, so a
            # changed selection kept charging for the original one.
            #
            # `tickets` comes with it and is empty here by construction: a
            # booking has none until it is paid.
            "booking": BookingDetailSerializer(detail).data,
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


class BookingDonationView(APIView):
    """Set or clear the donation on a live hold.

    A separate endpoint rather than a field on create, because the checkout
    reserves inventory when the review screen opens (the countdown has to be
    counting something) and the donation is chosen while reading that screen.
    The service does the work under the booking's row lock and re-issues the
    payment order for the new amount — leaving a stale order in place would make
    the customer pay one number while the webhook checked another.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(request=SetDonationRequestSerializer, responses={200: BookingSummarySerializer})
    def post(self, request: Request, booking_id: str) -> Response:
        payload = SetDonationRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        service = build_booking_service()
        booking = service.set_donation(
            booking_id=booking_id,
            actor_id=cast(User, request.user).id,
            donation_minor=payload.validated_data["donation_minor"],
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


class MyBookingsView(APIView):
    """Everything this account has ever bought, newest first.

    `private, no-store` like every other booking read: it is one person's
    purchase history, including money and event attendance.

    Cursor-paginated with no `COUNT(*)`, on the same `(-created_at, id)`
    ordering the repository sorts by — see `MyBookingsCursorPagination` for why
    that agreement is load-bearing rather than incidental.
    """

    permission_classes = [IsAuthenticated]
    pagination_class = MyBookingsCursorPagination

    @extend_schema(responses={200: MyBookingSerializer(many=True)}, tags=["booking"])
    def get(self, request: Request) -> Response:
        queryset = list_my_bookings(cast(User, request.user).id)
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        data = cast(list, MyBookingSerializer(page, many=True).data)
        return _no_store(paginator.get_paginated_response(data))


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
