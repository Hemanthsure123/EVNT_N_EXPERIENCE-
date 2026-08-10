"""Support routes.

`/support/queries` is the customer's own list AND the one place a query is
raised — one URL, two verbs, because they are the same collection. The two
queues are separate paths because they answer to different permissions and
neither is a filter of the other: an organiser's queue is scoped by ownership,
the admin queue by staff.
"""

from django.urls import path

from . import api

urlpatterns = [
    path("support/queries", api.MySupportQueriesView.as_view(), name="support-queries"),
    path(
        "support/queries/<uuid:query_id>",
        api.SupportQueryDetailView.as_view(),
        name="support-query-detail",
    ),
    path(
        "support/queries/<uuid:query_id>/replies",
        api.SupportReplyView.as_view(),
        name="support-query-replies",
    ),
    path(
        "support/queries/<uuid:query_id>/status",
        api.SupportStatusView.as_view(),
        name="support-query-status",
    ),
    path(
        "organizer/support/queries",
        api.OrganizerSupportQueriesView.as_view(),
        name="organizer-support-queries",
    ),
    path(
        "admin/support/queries",
        api.AdminSupportQueriesView.as_view(),
        name="admin-support-queries",
    ),
]
