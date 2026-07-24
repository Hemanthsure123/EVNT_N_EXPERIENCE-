from django.urls import path

from . import api

# Mounted under /api/v1/ (see config/urls.py) so both the public /events
# surface and the /organizer/events dashboard live in this one module.
urlpatterns = [
    path("events", api.EventListCreateView.as_view(), name="event-list-create"),
    path("events/<uuid:event_id>", api.EventDetailView.as_view(), name="event-detail"),
    path(
        "events/<uuid:event_id>/publish",
        api.EventPublishView.as_view(),
        name="event-publish",
    ),
    path("organizer/events", api.OrganizerEventListView.as_view(), name="organizer-event-list"),
]
