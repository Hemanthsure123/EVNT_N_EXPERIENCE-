from django.apps import AppConfig


class AnnouncementsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.announcements"
    label = "announcements"

    def ready(self) -> None:
        # Registers the broadcast fan-out before any request can enqueue it.
        # This module subscribes to no domain events — it publishes an audit
        # row and hands work to the queue, and nothing else's event changes
        # what an operator chose to send.
        from . import tasks  # noqa: F401 — import registers @register_task handlers
