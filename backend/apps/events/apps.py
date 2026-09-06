from django.apps import AppConfig


class EventsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.events"
    label = "events"

    def ready(self) -> None:
        from config.di import event_bus_port
        from core import events

        from . import handlers, tasks  # noqa: F401 — import registers @register_task handlers

        bus = event_bus_port()
        bus.subscribe(events.EVENT_CREATED, handlers.handle_event_created)
        bus.subscribe(events.EVENT_PUBLISHED, handlers.handle_event_published)
        # A sale takes the buyer off this event's waiting list. Subscribed
        # rather than called from `booking`, because the dependency runs
        # ticketing/booking -> events and never back.
        bus.subscribe(events.BOOKING_CONFIRMED, handlers.handle_booking_confirmed)
