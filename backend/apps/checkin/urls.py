from django.urls import path

from . import api

# Mounted under /api/v1/ (see config/urls.py).
urlpatterns = [
    path("checkin/verify", api.CheckinVerifyView.as_view(), name="checkin-verify"),
    path(
        "events/<uuid:event_id>/attendance",
        api.EventAttendanceView.as_view(),
        name="event-attendance",
    ),
]
