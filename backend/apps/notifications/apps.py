from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.notifications"
    label = "notifications"

    def ready(self) -> None:
        from config.di import event_bus_port
        from core import events

        from . import handlers, tasks  # noqa: F401 — import registers @register_task handlers

        bus = event_bus_port()
        # Consumer of the domain events other modules already emit via the outbox.
        bus.subscribe(events.USER_REGISTERED, handlers.handle_user_registered)
        bus.subscribe(events.BOOKING_CONFIRMED, handlers.handle_booking_confirmed)
        bus.subscribe(events.PAYMENT_REFUNDED, handlers.handle_payment_refunded)
        bus.subscribe(events.EVENT_PUBLISHED, handlers.handle_event_published)
