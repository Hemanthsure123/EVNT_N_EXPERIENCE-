"""Mounted under /api/v1/ (see config/urls.py).

Three prefixes, matching the three audiences:

- `performers/…`        public browse and profile
- `me/performers/…`     the owner's own acts, and their leads
- `hire/…`              the customer's briefs and quotes
- `admin/performers/…`  moderation, alongside the console's other routes
"""

from django.urls import path

from . import api

urlpatterns = [
    # Public
    path("performers", api.PerformerBrowseView.as_view(), name="performer-browse"),
    path("performers/facets", api.MarketplaceFacetsView.as_view(), name="performer-facets"),
    path(
        "performers/<uuid:performer_id>",
        api.PerformerDetailView.as_view(),
        name="performer-detail",
    ),
    # Owner
    path("me/performers", api.PerformerListCreateView.as_view(), name="my-performers"),
    path(
        "me/performers/<uuid:performer_id>",
        api.PerformerOwnerDetailView.as_view(),
        name="my-performer-detail",
    ),
    path(
        "me/performers/<uuid:performer_id>/readiness",
        api.PerformerReadinessView.as_view(),
        name="my-performer-readiness",
    ),
    path(
        "me/performers/<uuid:performer_id>/submit",
        api.PerformerSubmitView.as_view(),
        name="my-performer-submit",
    ),
    path(
        "me/performers/<uuid:performer_id>/pause",
        api.PerformerPauseView.as_view(),
        name="my-performer-pause",
    ),
    path(
        "me/performers/<uuid:performer_id>/photos",
        api.PerformerPhotoView.as_view(),
        name="my-performer-photos",
    ),
    path(
        "me/performers/<uuid:performer_id>/photos/<uuid:media_id>",
        api.PerformerPhotoDetailView.as_view(),
        name="my-performer-photo-detail",
    ),
    path(
        "me/performers/<uuid:performer_id>/leads",
        api.PerformerLeadsView.as_view(),
        name="my-performer-leads",
    ),
    path(
        "me/performers/<uuid:performer_id>/quotes",
        api.PerformerQuotesView.as_view(),
        name="my-performer-quotes",
    ),
    # Customer
    path("hire/requests", api.BookingRequestListCreateView.as_view(), name="hire-requests"),
    path(
        "hire/requests/<uuid:request_id>",
        api.BookingRequestDetailView.as_view(),
        name="hire-request-detail",
    ),
    path(
        "hire/requests/<uuid:request_id>/quotes",
        api.RequestQuotesView.as_view(),
        name="hire-request-quotes",
    ),
    path("hire/quotes/<uuid:quote_id>/accept", api.QuoteAcceptView.as_view(), name="quote-accept"),
    path(
        "hire/quotes/<uuid:quote_id>/withdraw",
        api.QuoteWithdrawView.as_view(),
        name="quote-withdraw",
    ),
    # Moderation
    path(
        "admin/performers",
        api.PerformerModerationQueueView.as_view(),
        name="admin-performer-queue",
    ),
    path(
        "admin/performers/<uuid:performer_id>/moderate",
        api.PerformerModerationDecisionView.as_view(),
        name="admin-performer-moderate",
    ),
    path(
        "admin/performers/<uuid:performer_id>/feature",
        api.PerformerFeatureView.as_view(),
        name="admin-performer-feature",
    ),
]
