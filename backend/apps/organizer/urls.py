"""Mounted under /api/v1/ (see config/urls.py).

Everything lives under `organizer/`, alongside the two organizer routes that
already existed — `GET /organizer/events` (events) and `GET /organizer/
settlements` (settlements) — so an organizer client has one prefix, not three.

Path ordering note: `organizer/events` (the events module's plain list) and
`organizer/events/<uuid>/analytics` (here) do not collide — different segment
counts — but this module is included AFTER events in `config/urls.py`, so the
exact-match route wins first regardless.
"""

from django.urls import path

from . import api

urlpatterns = [
    path("organizer/overview", api.OverviewView.as_view(), name="organizer-overview"),
    path("organizer/timeseries", api.TimeseriesView.as_view(), name="organizer-timeseries"),
    path("organizer/breakdown", api.BreakdownView.as_view(), name="organizer-breakdown"),
    path("organizer/activity", api.ActivityView.as_view(), name="organizer-activity"),
    path("organizer/feed", api.ActivityFeedView.as_view(), name="organizer-feed"),
    path("organizer/refunds", api.RefundListView.as_view(), name="organizer-refunds"),
    path("organizer/audience", api.AudienceView.as_view(), name="organizer-audience"),
    path("organizer/event-rows", api.EventRowListView.as_view(), name="organizer-event-rows"),
    path("organizer/bookings", api.BookingListView.as_view(), name="organizer-bookings"),
    path("organizer/customers", api.CustomerListView.as_view(), name="organizer-customers"),
    path(
        "organizer/customers/<uuid:customer_id>",
        api.CustomerDetailView.as_view(),
        name="organizer-customer-detail",
    ),
    path(
        "organizer/events/<uuid:event_id>/analytics",
        api.EventAnalyticsView.as_view(),
        name="organizer-event-analytics",
    ),
]
