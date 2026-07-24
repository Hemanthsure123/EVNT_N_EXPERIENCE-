from __future__ import annotations

from core.errors import DomainError


class TemplateMissingError(DomainError):
    """No template is registered for this (type, channel). A missing template is
    a loud, clear error at render time — never a silent no-send."""

    code = "notification_template_missing"
    status_code = 500

    def __init__(self, notification_type: str, channel: str) -> None:
        super().__init__(f"No template for type '{notification_type}' on channel '{channel}'.")


class UnknownNotificationTypeError(DomainError):
    """The notification type isn't one this module knows how to route."""

    code = "unknown_notification_type"
    status_code = 500

    def __init__(self, notification_type: str) -> None:
        super().__init__(f"Unknown notification type '{notification_type}'.")
