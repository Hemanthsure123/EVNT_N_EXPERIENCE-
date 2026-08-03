from __future__ import annotations

from django.apps import AppConfig


class PerformersConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.performers"
    label = "performers"

    def ready(self) -> None:
        """No subscriptions yet, and that is deliberate.

        The module EMITS domain events (a profile submitted, a quote accepted)
        so `notifications` can react to them — but the notification templates
        for those do not exist yet, and subscribing to an event with no
        template raises at render time by design. `notifications` will
        subscribe from its own `ready()` when the templates land, which is the
        same direction every other module's wiring runs.
        """
