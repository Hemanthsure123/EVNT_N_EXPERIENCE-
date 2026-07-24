from django.urls import path

from . import api

# Mounted under /api/v1/ (see config/urls.py).
urlpatterns = [
    path(
        "organizer/settlements",
        api.OrganizerSettlementListView.as_view(),
        name="organizer-settlement-list",
    ),
    path(
        "organizer/settlements/<uuid:event_id>",
        api.OrganizerSettlementDetailView.as_view(),
        name="organizer-settlement-detail",
    ),
    path(
        "admin/settlements/<uuid:settlement_id>/release",
        api.AdminSettlementReleaseView.as_view(),
        name="admin-settlement-release",
    ),
]
