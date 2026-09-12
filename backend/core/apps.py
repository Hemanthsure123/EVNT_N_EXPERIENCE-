from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core"
    label = "core"

    def ready(self) -> None:
        # Registers `core.purge_ephemeral_tokens` before any request could
        # enqueue it — the same contract every other module's AppConfig keeps.
        from core import ephemeral_tasks  # noqa: F401
