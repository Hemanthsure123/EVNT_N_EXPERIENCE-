"""Mounted under /api/v1/ (see config/urls.py).

Everything lives under `admin/` to match the one console endpoint that
already existed — `POST /admin/settlements/{id}/release` — so operators have
one prefix rather than two.
"""

from django.urls import path

from . import api

urlpatterns = [
    path("admin/overview", api.OverviewView.as_view(), name="console-overview"),
    path("admin/timeseries", api.TimeseriesView.as_view(), name="console-timeseries"),
    path("admin/breakdown", api.BreakdownView.as_view(), name="console-breakdown"),
    path("admin/activity", api.ActivityView.as_view(), name="console-activity"),
    path("admin/health", api.HealthView.as_view(), name="console-health"),
    path("admin/audit", api.AuditLogView.as_view(), name="console-audit"),
    path("admin/organizations", api.OrganizationListView.as_view(), name="console-organizations"),
    path("admin/users", api.UserListView.as_view(), name="console-users"),
    path(
        "admin/users/<uuid:user_id>/suspension",
        api.UserSuspensionView.as_view(),
        name="console-user-suspension",
    ),
    path("admin/payments", api.PaymentListView.as_view(), name="console-payments"),
    path("admin/refunds", api.RefundListView.as_view(), name="console-refunds"),
    path("admin/settlements", api.SettlementListView.as_view(), name="console-settlements"),
    path(
        "admin/verifications",
        api.PendingVerificationListView.as_view(),
        name="console-verifications",
    ),
    path(
        "admin/events/pending",
        api.EventModerationQueueView.as_view(),
        name="console-event-moderation-queue",
    ),
    path(
        "admin/events/<uuid:event_id>/moderate",
        api.EventModerationDecisionView.as_view(),
        name="console-event-moderate",
    ),
    path(
        "admin/events/<uuid:event_id>/unpublish",
        api.EventUnpublishView.as_view(),
        name="console-event-unpublish",
    ),
    path(
        "admin/organizations/<uuid:organization_id>/verification",
        api.VerificationDecisionView.as_view(),
        name="console-verification-decision",
    ),
]
