from django.urls import path

from . import api

urlpatterns = [
    # Public reads first — these are the hot paths and the only cacheable ones.
    path(
        "events/<uuid:event_id>/reviews",
        api.EventReviewsView.as_view(),
        name="event-reviews",
    ),
    path(
        "events/<uuid:event_id>/reviews/summary",
        api.EventReviewSummaryView.as_view(),
        name="event-review-summary",
    ),
    # Per-viewer.
    path(
        "events/<uuid:event_id>/reviews/mine",
        api.MyEventReviewView.as_view(),
        name="my-event-review",
    ),
    path(
        "events/<uuid:event_id>/reviews/eligibility",
        api.ReviewEligibilityView.as_view(),
        name="review-eligibility",
    ),
    path("me/pending-reviews", api.PendingReviewsView.as_view(), name="pending-reviews"),
    # Operator.
    path("admin/reviews", api.AdminReviewsView.as_view(), name="admin-reviews"),
    path(
        "admin/reviews/<uuid:review_id>/moderation",
        api.AdminReviewModerationView.as_view(),
        name="admin-review-moderation",
    ),
]
