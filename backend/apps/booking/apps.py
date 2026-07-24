from django.apps import AppConfig


class BookingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.booking"
    label = "booking"

    def ready(self) -> None:
        from config.di import event_bus_port
        from core import events

        from . import handlers, tasks  # noqa: F401 — import registers @register_task handlers

        bus = event_bus_port()
        bus.subscribe(events.BOOKING_CREATED, handlers.handle_booking_created)
        bus.subscribe(events.BOOKING_CONFIRMED, handlers.handle_booking_confirmed)
