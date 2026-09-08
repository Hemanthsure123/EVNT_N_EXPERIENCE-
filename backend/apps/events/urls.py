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
    # Read after ANY session write: adding a slot re-derives the event's own
    # window on the server without bumping `version`, so a client holding a
    # draft copy of the schedule would otherwise write its stale value back.
    path(
        "organizer/events/<uuid:event_id>/schedule",
        api.EventScheduleView.as_view(),
        name="organizer-event-schedule",
    ),
    path("events/<uuid:event_id>/slots", api.EventSlotView.as_view(), name="event-slots"),
    path(
        "events/<uuid:event_id>/slots/<uuid:slot_id>",
        api.EventSlotDetailView.as_view(),
        name="event-slot-detail",
    ),
    path("events/<uuid:event_id>/faqs", api.EventFaqView.as_view(), name="event-faqs"),
    path(
        "events/<uuid:event_id>/questions",
        api.EventQuestionView.as_view(),
        name="event-questions",
    ),
    path(
        "events/<uuid:event_id>/questions/<uuid:question_id>",
        api.EventQuestionDetailView.as_view(),
        name="event-question-detail",
    ),
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
    # An organization's OWN category labels — the same route shape as the crew
    # roster below and for the same reason: both are organization-owned lists
    # picked from while building an event, so an organizer client keeps one
    # prefix rather than learning two.
    #
    # `categories/picker` sits BEFORE `categories/<uuid:category_id>`, or the
    # uuid converter would... in fact it would not match "picker" at all, since
    # `uuid` is a strict converter. It is ordered first anyway because relying
    # on a converter's strictness for route disambiguation is exactly how the
    # maps module's `places/<str:place_id>` swallowed "autocomplete".
    path(
        "organizations/<uuid:organization_id>/categories",
        api.OrganizerCategoryListView.as_view(),
        name="organizer-category-list",
    ),
    path(
        "organizations/<uuid:organization_id>/categories/picker",
        api.OrganizerCategoryPickerView.as_view(),
        name="organizer-category-picker",
    ),
    path(
        "organizations/<uuid:organization_id>/categories/<uuid:category_id>",
        api.OrganizerCategoryDetailView.as_view(),
        name="organizer-category-detail",
    ),
    path(
        "organizations/<uuid:organization_id>/categories/<uuid:category_id>/image",
        api.OrganizerCategoryImageView.as_view(),
        name="organizer-category-image",
    ),
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
    path(
        "events/<uuid:event_id>/waitlist",
        api.EventWaitlistView.as_view(),
        name="event-waitlist",
    ),
    path("me/waitlist", api.MyWaitlistView.as_view(), name="my-waitlist"),
    path("me/saved-events", api.SavedEventsView.as_view(), name="saved-events"),
    path(
        "me/saved-events/<uuid:event_id>",
        api.SavedEventDetailView.as_view(),
        name="saved-event-detail",
    ),
]
