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
    path(
        "events/<uuid:event_id>/archive",
        api.EventArchiveView.as_view(),
        name="event-archive",
    ),
    path("organizer/events", api.OrganizerEventListView.as_view(), name="organizer-event-list"),
]

# Event content: media, FAQs and running order. GET is public (it is what the
# event page renders); writes are owner-only, proven inside the service.
urlpatterns += [
    path("events/<uuid:event_id>/content", api.EventContentView.as_view(), name="event-content"),
    path("events/<uuid:event_id>/media", api.EventMediaView.as_view(), name="event-media"),
    path(
        "events/<uuid:event_id>/media/upload",
        api.EventMediaUploadView.as_view(),
        name="event-media-upload",
    ),
    path(
        "events/<uuid:event_id>/media/<uuid:media_id>",
        api.EventMediaDetailView.as_view(),
        name="event-media-detail",
    ),
    path("events/<uuid:event_id>/faqs", api.EventFaqView.as_view(), name="event-faqs"),
    path(
        "events/<uuid:event_id>/faqs/<uuid:faq_id>",
        api.EventFaqDetailView.as_view(),
        name="event-faq-detail",
    ),
    path("events/<uuid:event_id>/timeline", api.EventTimelineView.as_view(), name="event-timeline"),
    path(
        "events/<uuid:event_id>/timeline/<uuid:entry_id>",
        api.EventTimelineDetailView.as_view(),
        name="event-timeline-detail",
    ),
    path("me/saved-events", api.SavedEventsView.as_view(), name="saved-events"),
    path(
        "me/saved-events/<uuid:event_id>",
        api.SavedEventDetailView.as_view(),
        name="saved-event-detail",
    ),
]
