from django.urls import path

from . import api

# Mounted under /api/v1/ (see config/urls.py).
urlpatterns = [
    path("checkin/verify", api.CheckinVerifyView.as_view(), name="checkin-verify"),
    # The read-only twin. Separate path rather than a `?dry_run=1` flag on
    # verify: a query parameter that decides whether an endpoint MARKS A TICKET
    # USED is one typo away from admitting somebody from a support desk, and it
    # would make the throttle, the audit story and the response shape
    # conditional on a string. Two paths, two shapes, no ambiguity.
    path("checkin/lookup", api.CheckinLookupView.as_view(), name="checkin-lookup"),
    path(
        "events/<uuid:event_id>/attendance",
        api.EventAttendanceView.as_view(),
        name="event-attendance",
    ),
]
