"""ORM access for bookings and tickets. Reads are shaped to avoid N+1 (the
detail and /me/tickets queries fetch related rows in one round trip); writes
keep the locked window on the booking row minimal."""

from __future__ import annotations

import uuid
from datetime import datetime

from django.db.models import Prefetch, Q, QuerySet

from core.base_repository import BaseRepository

from .models import Booking, BookingItem, BookingStatus, Ticket, TicketStatus

# Columns the check-in gate path needs from a ticket — deliberately tiny so the
# per-ticket locked section stays as small and fast as possible (see the
# `checkin` module's verify contract in CLAUDE.md).
_CHECKIN_LOCK_FIELDS = ("id", "status", "used_at", "gate")


class BookingRepository(BaseRepository[Booking]):
    model = Booking

    # --- writes / lifecycle ------------------------------------------------

    def create(
        self,
        *,
        id: uuid.UUID,
        user_id: uuid.UUID | str,
        event_id: uuid.UUID | str,
        hold_expires_at: datetime,
        total_amount_minor: int,
        platform_fee_minor: int,
        idempotency_key: str | None,
        donation_amount_minor: int = 0,
    ) -> Booking:
        return Booking.objects.create(
            id=id,
            user_id=user_id,
            event_id=event_id,
            hold_expires_at=hold_expires_at,
            total_amount_minor=total_amount_minor,
            platform_fee_minor=platform_fee_minor,
            donation_amount_minor=donation_amount_minor,
            idempotency_key=idempotency_key,
        )

    def create_items(self, items: list[BookingItem]) -> None:
        BookingItem.objects.bulk_create(items)

    def lock_for_update(self, booking_id: uuid.UUID | str) -> Booking | None:
        """SELECT ... FOR UPDATE on the booking row — the coordination point
        that serialises confirm / cancel / sweep so a booking can't be, say,
        confirmed and expired at once. Its items aren't locked (releasing/
        confirming inventory locks the *tier* rows via ticketing)."""
        return Booking.objects.select_for_update().filter(pk=booking_id).first()

    def list_items(self, booking_id: uuid.UUID | str) -> list[BookingItem]:
        return list(BookingItem.objects.filter(booking_id=booking_id))

    # --- reads -------------------------------------------------------------

    def get_by_idempotency_key(
        self, user_id: uuid.UUID | str, idempotency_key: str
    ) -> Booking | None:
        return Booking.objects.filter(user_id=user_id, idempotency_key=idempotency_key).first()

    def get_amounts_for_refund(self, booking_id: uuid.UUID | str) -> Booking | None:
        """Just enough of a booking to decide what may be refunded.

        NOT an override of `BaseRepository.get_by_id`, deliberately. This one is
        `.only(...)`-restricted, and a narrowed row hiding behind the name of the
        general accessor is how an unrelated caller ends up triggering a
        deferred re-fetch per attribute — the same trap the settlements
        serializer hit with `provider_ref`. A restricted read gets a name that
        says what it is for.
        """
        return (
            Booking.objects.only("id", "status", "total_amount_minor", "donation_amount_minor")
            .filter(pk=booking_id)
            .first()
        )

    def get_by_payment_order_id(self, rzp_order_id: str) -> Booking | None:
        """Resolve the booking behind a payment order id — how `payments` maps
        a Razorpay webhook (which carries the order id) back to our booking."""
        return Booking.objects.filter(payment_order_id=rzp_order_id).first()

    def get_detail(self, booking_id: uuid.UUID | str) -> Booking | None:
        """Booking + event(+organization) + items(+tier) + issued tickets(+tier)
        in a fixed number of queries, for GET /bookings/{id}.

        The tickets are prefetched (one extra query, never one per ticket)
        because the detail response carries who each ticket admits — the screen
        that names attendees is the booking screen, and making it fetch the
        tickets separately would be a second round trip for data this query is
        already positioned to return. A booking that hasn't been paid yet has
        no tickets, so the prefetch comes back empty rather than absent.

        The organization is JOINED, not fetched after: the ticket PDF prints who
        the event is presented by, and reading `event.organization.name` off a
        row loaded without it is one extra statement per booking confirmation on
        the money path. A join costs nothing here — this is already a
        select_related on the same row's FK chain, and the query budgets this
        method is measured against (4 for GET /bookings/{id}) do not move."""
        return (
            Booking.objects.select_related("event", "event__organization")
            .prefetch_related(
                Prefetch("items", queryset=BookingItem.objects.select_related("ticket_type")),
                Prefetch(
                    "tickets",
                    queryset=Ticket.objects.select_related("ticket_type").order_by("created_at"),
                ),
            )
            .filter(pk=booking_id)
            .first()
        )

    def get_with_event_owner(self, booking_id: uuid.UUID | str) -> Booking | None:
        """Booking + its event + the owning organization, in ONE lean query.

        Deliberately not `get_detail`: that one prefetches items and tickets
        because the booking SCREEN renders them. A caller that only needs to
        answer "is this yours, is it paid, and who owns the event" — the refund
        request flow — would pay for two prefetches it never reads.
        """
        return (
            Booking.objects.select_related("event", "event__organization")
            .only(
                "id",
                "status",
                "user_id",
                "total_amount_minor",
                "created_at",
                "event__id",
                "event__title",
                "event__starts_at",
                "event__organization__id",
                "event__organization__owner_id",
            )
            .filter(pk=booking_id)
            .first()
        )

    def list_live_for_event(self, event_id):
        """Every booking a cancellation has to make good on.

        PAID ones are owed a refund; RESERVED ones are holding inventory that
        should be freed rather than left to the sweeper — a deleted event must
        not keep seats. Cancelled and expired bookings are already settled and
        are deliberately excluded, so re-running a deletion cannot email
        somebody a second cancellation for a booking that was already dead.
        """
        return (
            Booking.objects.select_related("user")
            .filter(
                event_id=event_id,
                status__in=(BookingStatus.PAID, BookingStatus.RESERVED),
            )
            .order_by("created_at")
        )

    def list_expired_reserved_ids(self, *, now: datetime, limit: int = 100) -> list[uuid.UUID]:
        """Ids of holds whose window has lapsed but are still reserved — the
        sweeper's work list. Ids only (each is re-loaded under lock before being
        touched), so the sweep doesn't hold anything while it iterates."""
        return list(
            Booking.objects.filter(
                status=BookingStatus.RESERVED, hold_expires_at__lt=now
            ).values_list("id", flat=True)[:limit]
        )

    def list_awaiting_reconciliation(
        self,
        *,
        created_before: datetime,
        terminal_since: datetime,
        limit: int = 100,
    ) -> list[tuple[uuid.UUID, str]]:
        """`(booking_id, payment_order_id)` for bookings that hold a payment
        order the platform has not resolved — the reconciliation work list.

        Two disjoint sets, and the reason for each:

        - **Still `reserved`.** The customer is in, or has just left, checkout.
          Reconciling here is the GOOD outcome: the payment is found while the
          hold is still alive, so the ticket is issued rather than refunded.
        - **`expired`/`cancelled` within the grace window.** The sweeper got
          there first. The payment may still have been captured, and that money
          must come back to the customer — but only for a bounded window, after
          which the booking is settled and asking again would be a provider
          call per abandoned checkout, forever.

        `created_before` keeps a checkout that started seconds ago out of the
        list: the browser's own verify call has not had a chance to run yet, and
        racing it just spends a provider call to learn nothing.

        Ids and order ids only — each booking is re-resolved through the normal
        confirm path, which locks it, so nothing here is read-modify-write.
        """
        rows = (
            Booking.objects.filter(created_at__lte=created_before)
            .exclude(payment_order_id="")
            .filter(
                Q(status=BookingStatus.RESERVED)
                | Q(
                    status__in=(BookingStatus.EXPIRED, BookingStatus.CANCELLED),
                    hold_expires_at__gte=terminal_since,
                )
            )
            .order_by("created_at")
            .values_list("id", "payment_order_id")[:limit]
        )
        return [(row[0], row[1]) for row in rows]


class TicketRepository(BaseRepository[Ticket]):
    model = Ticket

    def bulk_create(self, tickets: list[Ticket]) -> list[Ticket]:
        return Ticket.objects.bulk_create(tickets)

    def list_for_booking(self, booking_id: uuid.UUID | str) -> list[Ticket]:
        """A booking's tickets in a STABLE order.

        `id` is the tiebreak, and it is not decoration: a booking's tickets are
        written by ONE `bulk_create`, and `auto_now_add` stamps every row in
        that batch with the same `timezone.now()` — identical to the
        microsecond. `ORDER BY created_at` alone is therefore a tie, and
        Postgres is free to return the rows in whichever order it finds them.

        The delivery email renders this list. Without the tiebreak the same
        booking lists its seats in a different order on a resend, which is how
        somebody forwards "your second ticket" to the wrong guest.
        """
        return list(
            Ticket.objects.select_related("ticket_type", "booking__event")
            .filter(booking_id=booking_id)
            .order_by("created_at", "id")
        )

    def list_for_attendee_assignment(self, booking_id: uuid.UUID | str) -> list[Ticket]:
        """The booking's tickets with exactly what naming an attendee needs:
        the CURRENT attendee (so a re-submitted form can be told apart from a
        real change), the status (a voided ticket must not be mailed to
        anybody), and the tier name (which goes into the domain event). Read
        under the caller's booking-row lock, so the ticket rows need no lock of
        their own — nothing else writes these two columns."""
        return list(
            Ticket.objects.select_related("ticket_type")
            .only("id", "status", "attendee_name", "attendee_email", "ticket_type__name")
            .filter(booking_id=booking_id)
            # Same tiebreak, and it matters MORE here: the naming form submits
            # attendees POSITIONALLY, so an unstable order writes a name onto
            # the wrong ticket. See `list_for_booking` for why the timestamps
            # tie in the first place.
            .order_by("created_at", "id")
        )

    def set_attendees(self, tickets: list[Ticket]) -> int:
        """Persist the attendee columns for a batch of tickets in ONE statement
        — an assignment covers a whole booking, so a save() per ticket would be
        ten round trips inside the booking lock for a ten-seat order."""
        if not tickets:
            return 0
        return Ticket.objects.bulk_update(tickets, ["attendee_name", "attendee_email"])

    def list_active_for_user(self, user_id: uuid.UUID | str) -> QuerySet[Ticket]:
        """A user's active tickets, newest first — one query with the tier and
        event joined so the DTO never N+1s."""
        return (
            Ticket.objects.select_related("ticket_type", "booking__event")
            .filter(booking__user_id=user_id, status=TicketStatus.ACTIVE)
            .order_by("-created_at", "id")
        )

    # --- check-in path (checkin verifies at the gate; booking owns Ticket) ---

    def get_for_checkin(self, ticket_id: uuid.UUID | str) -> Ticket | None:
        """Ticket + its event id + tier name in ONE query, for the check-in
        pre-lock checks (wrong-event / not-active / scan-window). No lock — the
        authoritative admit decision re-reads the row under `lock_for_update`."""
        return (
            Ticket.objects.select_related("booking", "ticket_type", "ticket_type__slot")
            .only(
                "id",
                "status",
                "used_at",
                "gate",
                "booking__event_id",
                "ticket_type__name",
                # The SESSION this ticket admits to, for the scan window. On a
                # multi-session event the event's own start is the FIRST show,
                # so deciding the window from it would open the 21:00 door at
                # 17:00. Joined here rather than read lazily: this is the
                # hottest write path in the system and a deferred load would
                # be one extra query per scan.
                "ticket_type__slot_id",
                "ticket_type__slot__starts_at",
                "ticket_type__slot__ends_at",
                "ticket_type__slot__label",
            )
            .filter(pk=ticket_id)
            .first()
        )

    def get_for_lookup(self, ticket_id: uuid.UUID | str) -> Ticket | None:
        """Ticket + event title + tier name, for `checkin`'s READ-ONLY lookup.

        A wider field set than `get_for_checkin` on purpose. The gate needs the
        minimum to decide; a support agent on a phone call needs enough to
        recognise the booking they are being told about out loud — the event's
        NAME rather than its uuid, and the attendee named on the ticket where
        one was given.

        Still one query, still `.only()`-restricted. `attendee_name` is the
        only near-personal field and it is already the ticket holder's own name
        as the buyer entered it; the operator asking has the booking reference
        in front of them.
        """
        return (
            Ticket.objects.select_related(
                "booking", "booking__event", "ticket_type", "ticket_type__slot"
            )
            .only(
                "id",
                "status",
                "used_at",
                "gate",
                "attendee_name",
                "booking__event_id",
                "booking__event__title",
                "ticket_type__name",
                # Same reason as `get_for_checkin`: the lookup reports whether
                # this ticket WOULD admit, and on a multi-session event that
                # answer depends on the session, not the event.
                "ticket_type__slot_id",
                "ticket_type__slot__starts_at",
                "ticket_type__slot__ends_at",
                "ticket_type__slot__label",
            )
            .filter(pk=ticket_id)
            .first()
        )

    def lock_for_update(self, ticket_id: uuid.UUID | str) -> Ticket | None:
        """SELECT ... FOR UPDATE on the single ticket row — the coordination
        point that makes one-scan entry correct: two simultaneous scans of the
        same ticket serialise here, so exactly one sees it un-used and admits.
        MUST run inside the caller's transaction. Locks only the ticket row (no
        join), keeping the critical section tiny."""
        return (
            Ticket.objects.select_for_update()
            .only(*_CHECKIN_LOCK_FIELDS)
            .filter(pk=ticket_id)
            .first()
        )

    def mark_used(self, ticket: Ticket, *, used_at: datetime, gate: str) -> None:
        """Persist only the check-in columns — the tiny write inside the lock."""
        ticket.status = TicketStatus.USED
        ticket.used_at = used_at
        ticket.gate = gate
        ticket.save(update_fields=["status", "used_at", "gate"])

    def count_used_for_event(self, event_id: uuid.UUID | str) -> int:
        """The authoritative admitted count for an event (source of truth for
        the live-attendance display, which the cache only accelerates)."""
        return Ticket.objects.filter(booking__event_id=event_id, status=TicketStatus.USED).count()

    def list_holder_user_ids_for_event(self, event_id: uuid.UUID | str) -> list[uuid.UUID]:
        """Distinct ids of users holding a live (active/used) ticket for this
        event — the recipient set for an event reminder. One query, ids only;
        the caller loads the users in a single `list_by_ids` fetch (no N+1)."""
        return list(
            Ticket.objects.filter(
                booking__event_id=event_id,
                status__in=(TicketStatus.ACTIVE, TicketStatus.USED),
            )
            .values_list("booking__user_id", flat=True)
            .distinct()
        )

    def void_active_for_booking(self, booking_id: uuid.UUID | str) -> int:
        """Void a booking's still-active tickets in one conditional UPDATE, so a
        refunded ticket can't enter the gate. Returns how many were voided —
        0 (a safe no-op) when the booking never issued tickets or they're
        already used/void. The `WHERE status=active` guard means a ticket that
        was admitted a moment earlier stays `used`, never silently reverted."""
        return Ticket.objects.filter(booking_id=booking_id, status=TicketStatus.ACTIVE).update(
            status=TicketStatus.VOID
        )
