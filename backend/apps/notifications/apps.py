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
        bus.subscribe(events.BOOKING_RECEIPT_SHARED, handlers.handle_booking_receipt_shared)
        bus.subscribe(events.PAYMENT_REFUNDED, handlers.handle_payment_refunded)
        # The refund REQUEST lifecycle. Three subscriptions because three
        # different people need telling three different things, and none of
        # them is the PAYMENT_REFUNDED message above — that one fires only once
        # money has actually moved.
        bus.subscribe(events.REFUND_REQUESTED, handlers.handle_refund_requested)
        bus.subscribe(events.REFUND_REQUEST_APPROVED, handlers.handle_refund_request_approved)
        bus.subscribe(events.REFUND_REQUEST_REJECTED, handlers.handle_refund_request_rejected)
        bus.subscribe(events.EVENT_PUBLISHED, handlers.handle_event_published)
        bus.subscribe(events.EVENT_DELETED_BY_OPERATOR, handlers.handle_event_deleted_by_operator)
        bus.subscribe(
            events.EVENT_CANCELLED_BY_ORGANIZER, handlers.handle_event_cancelled_by_organizer
        )
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
        # The hire desk. This subscription IS the delivery mechanism: with
        # no performer supply side, an enquiry reaches a human only here.
        bus.subscribe(events.PERFORMER_REQUEST_CREATED, handlers.handle_hire_enquiry_created)
        bus.subscribe(
            events.ORGANIZATION_VERIFICATION_SUBMITTED,
            handlers.handle_organization_verification_submitted,
        )
