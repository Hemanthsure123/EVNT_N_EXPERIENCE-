from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.accounts"
    label = "accounts"

    def ready(self) -> None:
        from config.di import event_bus_port
        from core import events

        from . import handlers

        event_bus_port().subscribe(events.USER_REGISTERED, handlers.handle_user_registered)
