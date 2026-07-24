from django.urls import path

from . import api

# Mounted under /api/v1/ (see config/urls.py).
urlpatterns = [
    path("payments/webhook", api.WebhookView.as_view(), name="payment-webhook"),
    path("payments/<uuid:payment_id>", api.PaymentDetailView.as_view(), name="payment-detail"),
    path(
        "payments/<uuid:payment_id>/refund",
        api.PaymentRefundView.as_view(),
        name="payment-refund",
    ),
]
