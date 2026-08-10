"""Registry of well-known domain event type strings.

Event payloads are plain dicts (see core/outbox.py) — this module exists
only so event type names are declared once and imported, instead of
re-typed as string literals at every publish/subscribe call site."""

from __future__ import annotations

# apps.accounts
USER_REGISTERED = "accounts.user_registered"

# apps.organizations
ORGANIZATION_CREATED = "organizations.organization_created"
#: Published by `submit_verification`; consumed by `notifications` to alert an
#: operator that an organization is waiting on a human decision.
#:
#: DECLARED HERE BECAUSE TWO MODULES WERE HAND-TYPING IT. Both the publisher
#: (apps/organizations/services.py) and the subscriber (apps/notifications/
#: apps.py) resolved it with `getattr(core_events, ..., "<literal>")`, each
#: carrying its own copy of the string as a fallback. Those two literals
#: agreeing is what made the alert fire at all — and nothing checked that they
#: did, so a typo on either side would have been a silent no-op: the organizer
#: sees "pending review", the operator is never told, and the submission sits
#: forever with no error anywhere. Declaring it makes both getattrs find this
#: one value, which is exactly what each of those call sites says it is
#: waiting for.
ORGANIZATION_VERIFICATION_SUBMITTED = "organizations.organization_verification_submitted"
ORGANIZATION_VERIFIED = "organizations.organization_verified"
ORGANIZATION_VERIFICATION_REJECTED = "organizations.organization_verification_rejected"
PAYOUT_ACCOUNT_LINKED = "organizations.payout_account_linked"

# apps.events
EVENT_CREATED = "events.event_created"
EVENT_UPDATED = "events.event_updated"
EVENT_SUBMITTED_FOR_REVIEW = "events.event_submitted_for_review"
EVENT_APPROVED = "events.event_approved"
EVENT_REJECTED = "events.event_rejected"

#: An operator REMOVED an event, in any state, for any reason. Distinct from a
#: rejection (which is a review decision on something not yet live) and from an
#: archive (which the organizer does to their own finished event).
#:
#: Payload: {event_id, title, owner_email, reason, refunded_bookings,
#: attendee_emails} — the attendee list rides on the payload because by the
#: time a consumer reads it the event is already soft-deleted and its bookings
#: are harder to reach.
EVENT_DELETED_BY_OPERATOR = "events.event_deleted_by_operator"
EVENT_PUBLISHED = "events.event_published"
EVENT_ARCHIVED = "events.event_archived"
#: An organiser called their own event off. The attendee notification is
#: the SAME one an operator deletion sends — from a ticket holder's side
#: the two are one fact, and two differently-worded cancellation emails
#: for the same outcome is how one of them ends up out of date.
EVENT_CANCELLED_BY_ORGANIZER = "events.event_cancelled_by_organizer"

# apps.ticketing
TICKET_TYPE_ADDED = "ticketing.ticket_type_added"
TICKET_TYPE_UPDATED = "ticketing.ticket_type_updated"
TICKET_TYPE_SOLD_OUT = "ticketing.ticket_type_sold_out"

# apps.booking
BOOKING_CREATED = "booking.booking_created"
BOOKING_CONFIRMED = "booking.booking_confirmed"
#: The BUYER chose to send their receipt to somebody. Not a lifecycle event —
#: nothing about the booking changed — but it goes through the outbox like
#: everything else so the send survives a crash between the click and the mail,
#: and so `notifications` stays the only module that talks to a mail provider.
BOOKING_RECEIPT_SHARED = "booking.receipt_shared"
BOOKING_CANCELLED = "booking.booking_cancelled"
TICKET_ISSUED = "booking.ticket_issued"
#: Published once per ticket that has just been addressed to a named attendee
#: (POST /bookings/{id}/attendees). `notifications` consumes it to email that
#: person their own copy of that ONE ticket, so a group of ten does not depend
#: on the buyer forwarding a mail with ten codes in it.
#:
#: Payload: {ticket_id, booking_id, event_id, attendee_name, attendee_email,
#: ticket_type_name} — and deliberately NO qr_token. An outbox row is a
#: long-lived record and a ticket token is a live credential; the consumer
#: reads the token from the Ticket row when it sends.
#:
#: Published only when the ADDRESS changes, never on a name-only correction, so
#: re-submitting the form cannot mail a guest the same ticket twice.
TICKET_ASSIGNED = "booking.ticket_assigned"

# apps.payments
PAYMENT_CONFIRMED = "payments.payment_confirmed"
PAYMENT_FAILED = "payments.payment_failed"
PAYMENT_REFUNDED = "payments.payment_refunded"

#: A customer has ASKED for their money back. Distinct from PAYMENT_REFUNDED,
#: which means money actually moved — these three carry the request's lifecycle
#: so `notifications` can tell the organizer somebody is waiting, and tell the
#: customer what was decided.
#:
#: Payload: {refund_request_id, booking_id, event_id, organizer_id}
REFUND_REQUESTED = "payments.refund_requested"
#: Payload: {refund_request_id, booking_id, payment_id, note}
REFUND_REQUEST_APPROVED = "payments.refund_request_approved"
#: Payload: {refund_request_id, booking_id, note} — the note is REQUIRED here
#: and is what the customer is shown.
REFUND_REQUEST_REJECTED = "payments.refund_request_rejected"

# apps.checkin
TICKET_CHECKED_IN = "checkin.ticket_checked_in"

# apps.settlements
PAYOUT_RELEASED = "settlements.payout_released"
PAYOUT_FAILED = "settlements.payout_failed"

# --- performers (the Hire a Band marketplace) ---------------------------
PERFORMER_CREATED = "performers.performer_created"
PERFORMER_SUBMITTED_FOR_REVIEW = "performers.performer_submitted_for_review"
PERFORMER_APPROVED = "performers.performer_approved"
PERFORMER_REJECTED = "performers.performer_rejected"
PERFORMER_REQUEST_CREATED = "performers.request_created"
PERFORMER_QUOTE_SUBMITTED = "performers.quote_submitted"
PERFORMER_QUOTE_ACCEPTED = "performers.quote_accepted"
