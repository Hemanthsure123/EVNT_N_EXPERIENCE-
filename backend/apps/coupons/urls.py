"""Coupon routes.

The organizer's list hangs off the ORGANIZATION, because a coupon belongs to
one and may span every event it runs — the same shape as the crew roster. The
offers list hangs off the EVENT, because that is the thing a customer is
looking at.
"""

from django.urls import path

from . import api

urlpatterns = [
    path(
        "organizations/<uuid:organization_id>/coupons",
        api.CouponListView.as_view(),
        name="coupon-list",
    ),
    path(
        "organizations/<uuid:organization_id>/coupons/<uuid:coupon_id>",
        api.CouponDetailView.as_view(),
        name="coupon-detail",
    ),
    path("events/<uuid:event_id>/offers", api.EventOffersView.as_view(), name="event-offers"),
]
