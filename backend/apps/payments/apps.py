from django.apps import AppConfig


class PaymentsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.payments"
    label = "payments"

    def ready(self) -> None:
        from config.di import event_bus_port
        from core import events

        from . import handlers, tasks  # noqa: F401 — import registers @register_task handlers

        bus = event_bus_port()
        bus.subscribe(events.PAYMENT_CONFIRMED, handlers.handle_payment_confirmed)
        bus.subscribe(events.PAYMENT_FAILED, handlers.handle_payment_failed)
        bus.subscribe(events.PAYMENT_REFUNDED, handlers.handle_payment_refunded)
