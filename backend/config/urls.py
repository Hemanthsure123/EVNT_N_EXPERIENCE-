from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from core.health import health_check

urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", health_check, name="health-check"),
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
]

if settings.ENABLE_SILK:
    urlpatterns += [path("silk/", include("silk.urls"))]
