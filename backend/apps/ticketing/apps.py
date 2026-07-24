from django.apps import AppConfig


class TicketingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.ticketing"
    label = "ticketing"

    def ready(self) -> None:
        from apps.events.publish_checks import register_publish_check
        from config.di import event_bus_port
        from core import events as core_events

        from . import handlers
        from .publish_gate import require_at_least_one_ticket_type

        # Close the events loop: publishing now requires >= 1 ticket type.
        register_publish_check(require_at_least_one_ticket_type)

        bus = event_bus_port()
        bus.subscribe(core_events.TICKET_TYPE_ADDED, handlers.handle_ticket_type_added)
        bus.subscribe(core_events.TICKET_TYPE_SOLD_OUT, handlers.handle_ticket_type_sold_out)
