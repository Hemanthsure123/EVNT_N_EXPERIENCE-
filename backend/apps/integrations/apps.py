from django.apps import AppConfig


class IntegrationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.integrations"
    label = "integrations"

    def ready(self) -> None:
        from config.di import event_bus_port
        from core import events

        from . import handlers, tasks  # noqa: F401 — import registers @register_task handlers

        bus = event_bus_port()
        # A confirmed booking is the moment a calendar entry becomes useful.
        bus.subscribe(events.BOOKING_CONFIRMED, handlers.handle_booking_confirmed)
        # Time or venue changed — every attendee's entry is now wrong.
        bus.subscribe(events.EVENT_UPDATED, handlers.handle_event_updated)
        # Archived is how this platform cancels a live event (see apps/organizer).
        bus.subscribe(events.EVENT_ARCHIVED, handlers.handle_event_cancelled)
