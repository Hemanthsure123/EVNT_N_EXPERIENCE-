from django.urls import path

from . import api

# Mounted under /api/v1/ (see config/urls.py).
urlpatterns = [
    path("payments/webhook", api.WebhookView.as_view(), name="payment-webhook"),
    # Ahead of the <uuid:payment_id> route: "verify" is not a UUID, so
    # order is not strictly required here — but a literal path that can
    # be shadowed by a converter route is a trap worth not setting.
    path("payments/verify", api.VerifyPaymentView.as_view(), name="payment-verify"),
    # Demo-only in effect: it refuses unless the configured provider is a
    # simulated one (see SimulatePaymentView). Mounted unconditionally so it is
    # testable and so the refusal is explicit rather than a 404.
    path("payments/simulate", api.SimulatePaymentView.as_view(), name="payment-simulate"),
    path("payments/<uuid:payment_id>", api.PaymentDetailView.as_view(), name="payment-detail"),
    path(
        "payments/<uuid:payment_id>/refund",
        api.PaymentRefundView.as_view(),
        name="payment-refund",
    ),
    # ── The refund REQUEST lifecycle ────────────────────────────────────
    #
    # Three read surfaces (the customer's, the organizer's queue, the operator's
    # platform-wide view) and ONE decision endpoint they all use. The decision
    # rule — own the event, or be staff — lives in the service, so a second
    # `/admin/...` decide route would only be a second place for it to drift,
    # with the admin copy inevitably becoming the lenient one.
    path(
        "bookings/<uuid:booking_id>/refund-requests",
        api.BookingRefundRequestView.as_view(),
        name="booking-refund-request",
    ),
    path(
        "me/refund-requests",
        api.MyRefundRequestListView.as_view(),
        name="my-refund-requests",
    ),
    path(
        "organizer/refund-requests",
        api.OrganizerRefundRequestListView.as_view(),
        name="organizer-refund-requests",
    ),
    path(
        "admin/refund-requests",
        api.AdminRefundRequestListView.as_view(),
        name="admin-refund-requests",
    ),
    path(
        "refund-requests/<uuid:request_id>/decide",
        api.RefundRequestDecisionView.as_view(),
        name="refund-request-decide",
    ),
]
