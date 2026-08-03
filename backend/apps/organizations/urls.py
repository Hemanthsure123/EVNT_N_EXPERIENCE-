from django.urls import path

from . import api

urlpatterns = [
    path("", api.OrganizationListCreateView.as_view(), name="organization-list-create"),
    # Before the <uuid:organization_id> routes for readability only — "me" is
    # not a UUID, so the converter would never match it anyway.
    path("me/following", api.FollowingListView.as_view(), name="me-following"),
    path(
        "<uuid:organization_id>", api.OrganizationDetailView.as_view(), name="organization-detail"
    ),
    # One URL, four verbs: POST follows, DELETE unfollows, PATCH changes the
    # notification flag, GET answers "do I follow this, and does it notify me".
    # They are one resource — the caller's follow of this organization — and
    # splitting the flag onto its own path would invite the second table this
    # model deliberately does not have.
    path(
        "<uuid:organization_id>/follow",
        api.OrganizationFollowView.as_view(),
        name="organization-follow",
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
