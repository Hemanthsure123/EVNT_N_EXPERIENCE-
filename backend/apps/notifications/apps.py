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
        # One message per named guest, so a party of ten is ten tickets in ten
        # inboxes rather than one mail carrying all ten tokens.
        bus.subscribe(events.TICKET_ASSIGNED, handlers.handle_ticket_assigned)
        bus.subscribe(events.PAYMENT_REFUNDED, handlers.handle_payment_refunded)
        bus.subscribe(events.EVENT_PUBLISHED, handlers.handle_event_published)
        # settlements' seam: the organizer's payout confirmation.
        bus.subscribe(events.PAYOUT_RELEASED, handlers.handle_payout_released)

        # --- operator alerts ------------------------------------------------
        # Everything below is a decision waiting on a human. These events were
        # already published and had NO subscriber, so a submission could sit in
        # a queue indefinitely with nobody aware of it — the organiser saw
        # "pending review" and the operator saw nothing at all.
        bus.subscribe(events.EVENT_SUBMITTED_FOR_REVIEW, handlers.handle_event_submitted_for_review)
        bus.subscribe(
            events.PERFORMER_SUBMITTED_FOR_REVIEW, handlers.handle_performer_submitted_for_review
        )
        bus.subscribe(
            events.ORGANIZATION_VERIFICATION_SUBMITTED,
            handlers.handle_organization_verification_submitted,
        )
