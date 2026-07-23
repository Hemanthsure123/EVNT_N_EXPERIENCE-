from django.apps import AppConfig


class OrganizationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.organizations"
    label = "organizations"

    def ready(self) -> None:
        from config.di import event_bus_port
        from core import events

        from . import handlers, tasks  # noqa: F401 — import registers @register_task handlers

        bus = event_bus_port()
        bus.subscribe(events.ORGANIZATION_CREATED, handlers.handle_organization_created)
        bus.subscribe(events.ORGANIZATION_VERIFIED, handlers.handle_organization_verified)
        bus.subscribe(events.PAYOUT_ACCOUNT_LINKED, handlers.handle_payout_account_linked)
