from django.apps import AppConfig


class CheckinConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.checkin"
    label = "checkin"

    def ready(self) -> None:
        from config.di import event_bus_port
        from core import events

        from . import handlers

        bus = event_bus_port()
        bus.subscribe(events.TICKET_CHECKED_IN, handlers.handle_ticket_checked_in)
