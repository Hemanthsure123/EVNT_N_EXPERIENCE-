from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from core.health import health_check
from core.task_dispatch import run_queued_task

urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", health_check, name="health-check"),
    # Where Cloud Tasks delivers. Authenticated by a shared secret, not by a
    # user token — the caller is a queue. Outside /api/v1/ deliberately: it is
    # not part of the public API surface and should be blocked at the edge for
    # everything except the queue's own egress. See core/task_dispatch.py.
    path("internal/tasks/run", run_queued_task, name="internal-task-run"),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/v1/auth/", include("apps.accounts.urls")),
    path("api/v1/organizations/", include("apps.organizations.urls")),
    # events + organizer routes both live under /api/v1/ (see apps/events/urls.py);
    # listed after the more specific prefixes above so they match first.
    path("api/v1/", include("apps.events.urls")),
    # ticketing's /events/{id}/ticket-types and /ticket-types/{id} also live
    # under /api/v1/; distinct path segments, so no clash with the events routes.
    path("api/v1/", include("apps.ticketing.urls")),
    # booking's /bookings and /me/tickets, likewise under /api/v1/.
    path("api/v1/", include("apps.booking.urls")),
    # payments' /payments/webhook, /payments/{id}, /payments/{id}/refund.
    path("api/v1/", include("apps.payments.urls")),
    # checkin's /checkin/verify and /events/{id}/attendance, under /api/v1/.
    path("api/v1/", include("apps.checkin.urls")),
    # settlements' /organizer/settlements and /admin/settlements/{id}/release.
    path("api/v1/", include("apps.settlements.urls")),
    path("api/v1/", include("apps.console.urls")),
    # organizer's /organizer/* dashboard reads. AFTER events and settlements,
    # whose own /organizer/events and /organizer/settlements routes are exact
    # matches and so resolve first.
    path("api/v1/", include("apps.organizer.urls")),
    # cms's public /homepage plus the admin content routes.
    path("api/v1/", include("apps.cms.urls")),
    path("api/v1/", include("apps.announcements.urls")),
    # notifications is otherwise internal; these are only the push-subscription
    # routes, which exist because a subscription can only be minted by the
    # browser that owns it. See apps/notifications/api.py.
    path("api/v1/", include("apps.notifications.urls")),
    # The marketplace: public browse, owner profiles, customer briefs and the
    # moderation queue, all under one module.
    path("api/v1/", include("apps.performers.urls")),
    # Google Maps Platform read surface (Places, Geocoding, Directions,
    # Distance Matrix, Places Photos) — the server key never reaches a browser.
    path("api/v1/", include("apps.maps.urls")),
    # Google account connections + Calendar sync, including the OAuth callback.
    path("api/v1/", include("apps.integrations.urls")),
]

if settings.ENABLE_SILK:
    urlpatterns += [path("silk/", include("silk.urls"))]
