from django.urls import path

from . import api

urlpatterns = [
    path("", api.OrganizationListCreateView.as_view(), name="organization-list-create"),
    path(
        "<uuid:organization_id>", api.OrganizationDetailView.as_view(), name="organization-detail"
    ),
    path(
        "<uuid:organization_id>/verification",
        api.OrganizationVerificationView.as_view(),
        name="organization-verification",
    ),
    path(
        "<uuid:organization_id>/payout-account",
        api.OrganizationPayoutAccountView.as_view(),
        name="organization-payout-account",
    ),
]
