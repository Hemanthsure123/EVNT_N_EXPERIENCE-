from django.urls import path

from . import api

# Mounted under /api/v1/ (see config/urls.py).
urlpatterns = [
    path("bookings", api.BookingCreateView.as_view(), name="booking-create"),
    path("bookings/<uuid:booking_id>", api.BookingDetailView.as_view(), name="booking-detail"),
    path(
        "bookings/<uuid:booking_id>/cancel",
        api.BookingCancelView.as_view(),
        name="booking-cancel",
    ),
    path(
        "bookings/<uuid:booking_id>/attendees",
        api.BookingAttendeesView.as_view(),
        name="booking-attendees",
    ),
    path(
        "bookings/<uuid:booking_id>/share-receipt",
        api.ShareReceiptView.as_view(),
        name="booking-share-receipt",
    ),
    path("me/tickets", api.MyTicketsView.as_view(), name="my-tickets"),
]
