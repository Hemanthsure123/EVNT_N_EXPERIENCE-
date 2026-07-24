from django.urls import path

from . import api

# Mounted under /api/v1/ (see config/urls.py), alongside the events routes.
urlpatterns = [
    path(
        "events/<uuid:event_id>/ticket-types",
        api.TicketTypeListCreateView.as_view(),
        name="ticket-type-list-create",
    ),
    path(
        "ticket-types/<uuid:ticket_type_id>",
        api.TicketTypeDetailView.as_view(),
        name="ticket-type-detail",
    ),
]
