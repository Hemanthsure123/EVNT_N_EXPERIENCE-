"""Mounted under /api/v1/ (see config/urls.py).

── TWO FLOWS, ONE MODULE, DISCRIMINATED BY `kind` ────────────────────────

This module shipped as a two-sided marketplace: performers listed acts under
`performers/…` and `me/performers/…`, customers posted briefs under `hire/…`,
performers quoted, and accepting a quote booked an act in one transaction.

The platform no longer has a supply side. Somebody wanting a band sends what
they need and an OPERATOR gets back to them, off-platform, using the contact
details on the enquiry. So there is nothing to browse, nothing to quote on and
nothing to moderate — and every route that offered one is removed rather than
left answering into a table nobody writes to.

Removing the routes is what removes the capability: an endpoint that is not
mounted cannot be reached, whatever is still in `api.py`. The views, services
and models behind them survive in the tree for now — the tables are empty and
deleting a module wholesale in the same pass that builds its replacement is how
a migration gets stranded half-applied — but nothing routes to them, and
`test_marketplace.py` no longer exercises them.

What remains is one audience and two verbs: a customer sends an enquiry, and
withdraws it if their plans change. The operator's side lives in `apps/console`
with the platform's other queues, because that is where an operator already is.
"""

from django.urls import path

from . import api
from .models import RequestKind

urlpatterns = [
    # ── PUBLIC MARKETPLACE ───────────────────────────────────────────────
    path("performers", api.PerformerBrowseView.as_view(), name="performer-browse"),
    path("performers/facets", api.MarketplaceFacetsView.as_view(), name="performer-facets"),
    path(
        "performers/<uuid:performer_id>",
        api.PerformerDetailView.as_view(),
        name="performer-detail",
    ),
    # ── THE ACT'S OWN SCREENS (Performer Studio) ─────────────────────────
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
    # ── THE CUSTOMER'S MARKETPLACE BRIEFS ────────────────────────────────
    # `kind=marketplace` is bound HERE, not inferred inside the view: the
    # routing table is the one place that says which URL means which flow.
    path(
        "hire/requests",
        api.BookingRequestListCreateView.as_view(kind=RequestKind.MARKETPLACE),
        name="hire-requests",
    ),
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
    # ── THE OPERATOR-HANDLED ENQUIRY ─────────────────────────────────────
    # The newer flow, unchanged. Same two views as the briefs above, bound to
    # the other `kind`.
    path(
        "hire/enquiries",
        api.BookingRequestListCreateView.as_view(kind=RequestKind.ENQUIRY),
        name="hire-enquiries",
    ),
    path(
        "hire/enquiries/<uuid:request_id>",
        api.BookingRequestDetailView.as_view(),
        name="hire-enquiry-detail",
    ),
    # ── MODERATION ───────────────────────────────────────────────────────
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
