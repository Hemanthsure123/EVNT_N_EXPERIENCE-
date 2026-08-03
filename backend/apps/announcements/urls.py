"""Mounted under /api/v1/ (see config/urls.py).

The tracked redirect's real, absolute URL is therefore
`{PUBLIC_API_BASE_URL}/api/v1/a/{announcement_id}/r` — short by API standards
because it is printed inside an email, where every character is a character a
mail client can wrap mid-link.
"""

from django.urls import path

from . import api

urlpatterns = [
    path("announcements", api.LiveAnnouncementsView.as_view(), name="announcements"),
    # The Curatix subscribe card. Public, hard-throttled; see api.SubscribeView.
    path("subscribers", api.SubscribeView.as_view(), name="subscribers"),
    path(
        "subscribers/unsubscribe",
        api.UnsubscribeView.as_view(),
        name="subscribers-unsubscribe",
    ),
    # The click. Listed before the admin routes for readability only — the path
    # segments are distinct, so ordering carries no meaning here.
    path("a/<uuid:announcement_id>/r", api.TrackedRedirectView.as_view(), name="announcement-r"),
    path(
        "admin/announcements",
        api.AdminAnnouncementListView.as_view(),
        name="admin-announcements",
    ),
    path(
        "admin/announcements/<uuid:announcement_id>",
        api.AdminAnnouncementDetailView.as_view(),
        name="admin-announcement-detail",
    ),
    path(
        "admin/announcements/<uuid:announcement_id>/send",
        api.AdminBroadcastView.as_view(),
        name="admin-announcement-send",
    ),
    path(
        "admin/announcements/<uuid:announcement_id>/analytics",
        api.AdminAnnouncementAnalyticsView.as_view(),
        name="admin-announcement-analytics",
    ),
]
