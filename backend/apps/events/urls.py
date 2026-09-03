from django.urls import path

from . import api

# Mounted under /api/v1/ (see config/urls.py) so both the public /events
# surface and the /organizer/events dashboard live in this one module.
urlpatterns = [
    path("events", api.EventListCreateView.as_view(), name="event-list-create"),
    # Declared BEFORE the <uuid:event_id> route. Django's uuid converter cannot
    # match the literal "sitemap", so ordering is not load-bearing here — but
    # declaring it first means nobody has to work that out, and it is the
    # ordering that stays correct if a looser converter is ever introduced.
    path("events/sitemap", api.EventSitemapView.as_view(), name="event-sitemap"),
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
    path(
        "events/<uuid:event_id>/duplicate",
        api.EventDuplicateView.as_view(),
        name="event-duplicate",
    ),
    path(
        "events/<uuid:event_id>/clone",
        api.EventCloneView.as_view(),
        name="event-clone",
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
    path(
        "events/<uuid:event_id>/cancel",
        api.EventCancelView.as_view(),
        name="event-cancel",
    ),
    path("events/<uuid:event_id>/slots", api.EventSlotView.as_view(), name="event-slots"),
    path(
        "events/<uuid:event_id>/slots/<uuid:slot_id>",
        api.EventSlotDetailView.as_view(),
        name="event-slot-detail",
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
    # ── Crew ────────────────────────────────────────────────────────────
    # The ROSTER hangs off the organization, because that is what owns it and
    # the whole point is reuse across events. The LINEUP hangs off the event.
    path(
        "organizations/<uuid:organization_id>/crew",
        api.CrewRosterView.as_view(),
        name="crew-roster",
    ),
    path(
        "organizations/<uuid:organization_id>/crew/<uuid:member_id>",
        api.CrewMemberDetailView.as_view(),
        name="crew-member-detail",
    ),
    path(
        "organizations/<uuid:organization_id>/crew/<uuid:member_id>/photo",
        api.CrewMemberPhotoView.as_view(),
        name="crew-member-photo",
    ),
    path("events/<uuid:event_id>/crew", api.EventCrewView.as_view(), name="event-crew"),
    path("me/saved-events", api.SavedEventsView.as_view(), name="saved-events"),
    path(
        "me/saved-events/<uuid:event_id>",
        api.SavedEventDetailView.as_view(),
        name="saved-event-detail",
    ),
]
