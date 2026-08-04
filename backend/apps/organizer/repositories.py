"""ORM access for the organizer dashboard.

The ONLY file in the module that touches the ORM (CLAUDE.md's layering rule).

This module is `console`'s per-organizer twin: almost entirely read, crossing
module boundaries downward only, with every aggregate computed by Postgres
rather than in Python. Two things make it different from `console`, and both
are load-bearing:

1. **Ownership scoping IS the security model.** `console` asks "is this caller
   staff" once, at the request layer, and then reads the whole platform. Here
   every single query is constrained to events belonging to organizations the
   caller owns, via `owned_events()`. A missing scope is not a cosmetic bug
   — it leaks one organizer's revenue to another. So the scope is applied in
   ONE place per query, at the base queryset, never bolted on by the caller.

2. **Per-event aggregates are fetched by page, not by row.** The dashboard
   table wants capacity / sold / revenue / check-ins per event. Annotating all
   of those onto one queryset would join four tables at once and fan out into
   a cartesian product (a classic Django aggregate trap that silently
   multiplies sums). Instead the page of events is read first, then three
   small GROUP BY queries are run against just that page's ids and merged by
   key. That is a fixed 4 queries for a page of any size (enforced by
   `test_page_costs_a_fixed_number_of_queries`) — no N+1, no fan-out, and
   each aggregate still computed in the database.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterable, Sequence
from uuid import UUID

from django.db.models import Count, F, Max, OuterRef, Q, QuerySet, Subquery, Sum
from django.db.models.functions import TruncDate

from apps.booking.models import Booking, BookingStatus, Ticket, TicketStatus
from apps.checkin.models import ScanLog, ScanResult
from apps.events.models import Event, EventStatus
from apps.organizations.models import Organization
from apps.payments.models import Payment, PaymentStatus, Refund
from apps.settlements.models import PayoutAttempt
from apps.ticketing.models import TicketType


class OrganizerRepository:
    """Read-only aggregates over ONE organizer's events."""

    # ------------------------------------------------------------- scoping

    def owned_organization_ids(self, owner_id: UUID) -> list[UUID]:
        return list(
            Organization.objects.filter(owner_id=owner_id, deleted_at__isnull=True).values_list(
                "id", flat=True
            )
        )

    def owned_events(self, owner_id: UUID) -> QuerySet[Event]:
        """Every query in this file starts here. The `organization__owner_id`
        traversal is index-backed by `org_owner_created_idx` on the join side."""
        return Event.objects.filter(
            organization__owner_id=owner_id,
            organization__deleted_at__isnull=True,
            deleted_at__isnull=True,
        )

    def owns_event(self, owner_id: UUID, event_id: UUID) -> bool:
        return self.owned_events(owner_id).filter(id=event_id).exists()

    def _paid_payments(self, owner_id: UUID):
        """This organizer's captured payments.

        Deliberately UNANNOTATED. Returning `QuerySet[Payment]` and then
        chaining `.annotate(...).values(...).annotate(...)` off it crashes
        mypy 1.20 outright (INTERNAL ERROR, not a diagnosable message) —
        `console` does the same grouping directly off `Payment.objects` and is
        fine, so the trigger is the typed intermediary, not the query. Runtime
        behaviour is identical; the callers below are all fully typed.
        """
        return Payment.objects.filter(
            status=PaymentStatus.PAID,
            booking__event__organization__owner_id=owner_id,
            booking__event__deleted_at__isnull=True,
        )

    # -------------------------------------------------------------- counts

    def sum_revenue_between(self, owner_id: UUID, start: dt.datetime, end: dt.datetime) -> int:
        """Captured revenue in minor units. Only `paid` counts — a `created`
        payment is an order nobody completed, and counting it would inflate
        today's number by every abandoned checkout."""
        total = (
            self._paid_payments(owner_id)
            .filter(created_at__gte=start, created_at__lt=end)
            .aggregate(total=Sum("amount_minor"))["total"]
        )
        return int(total or 0)

    def count_bookings_between(
        self, owner_id: UUID, start: dt.datetime, end: dt.datetime, *, status: str | None = None
    ) -> int:
        queryset = Booking.objects.filter(
            event__organization__owner_id=owner_id,
            event__deleted_at__isnull=True,
            created_at__gte=start,
            created_at__lt=end,
        )
        if status:
            queryset = queryset.filter(status=status)
        return queryset.count()

    def count_tickets_sold_between(
        self, owner_id: UUID, start: dt.datetime, end: dt.datetime
    ) -> int:
        """Issued tickets, excluding voided ones — the honest "tickets sold"
        number, since a refunded booking's tickets are voided at refund time."""
        return (
            Ticket.objects.filter(
                booking__event__organization__owner_id=owner_id,
                booking__event__deleted_at__isnull=True,
                created_at__gte=start,
                created_at__lt=end,
            )
            .exclude(status=TicketStatus.VOID)
            .count()
        )

    def count_upcoming_events(self, owner_id: UUID, now: dt.datetime) -> int:
        return (
            self.owned_events(owner_id).filter(status=EventStatus.LIVE, starts_at__gte=now).count()
        )

    def count_refunds_between(self, owner_id: UUID, start: dt.datetime, end: dt.datetime) -> int:
        return Refund.objects.filter(
            payment__booking__event__organization__owner_id=owner_id,
            created_at__gte=start,
            created_at__lt=end,
        ).count()

    def sum_refunds_between(self, owner_id: UUID, start: dt.datetime, end: dt.datetime) -> int:
        total = Refund.objects.filter(
            payment__booking__event__organization__owner_id=owner_id,
            created_at__gte=start,
            created_at__lt=end,
        ).aggregate(total=Sum("amount_minor"))["total"]
        return int(total or 0)

    def count_checkins_between(self, owner_id: UUID, start: dt.datetime, end: dt.datetime) -> int:
        """Admissions from the append-only scan log. `allowed` only — a denied
        scan is an attendance EVENT but not an attendance."""
        return ScanLog.objects.filter(
            event__organization__owner_id=owner_id,
            result=ScanResult.ALLOWED,
            scanned_at__gte=start,
            scanned_at__lt=end,
        ).count()

    # ---------------------------------------------------------- timeseries

    def revenue_by_day(
        self, owner_id: UUID, start: dt.datetime, end: dt.datetime
    ) -> list[tuple[dt.date, int]]:
        return _group_by_day(
            self._paid_payments(owner_id).filter(created_at__gte=start, created_at__lt=end),
            Sum("amount_minor"),
        )

    def bookings_by_day(
        self, owner_id: UUID, start: dt.datetime, end: dt.datetime
    ) -> list[tuple[dt.date, int]]:
        return _group_by_day(
            Booking.objects.filter(
                event__organization__owner_id=owner_id,
                event__deleted_at__isnull=True,
                status=BookingStatus.PAID,
                created_at__gte=start,
                created_at__lt=end,
            ),
            Count("id"),
        )

    def tickets_by_day(
        self, owner_id: UUID, start: dt.datetime, end: dt.datetime
    ) -> list[tuple[dt.date, int]]:
        return _group_by_day(
            Ticket.objects.filter(
                booking__event__organization__owner_id=owner_id,
                booking__event__deleted_at__isnull=True,
                created_at__gte=start,
                created_at__lt=end,
            ).exclude(status=TicketStatus.VOID),
            Count("id"),
        )

    # ----------------------------------------------------- the events table

    def event_rows(
        self,
        owner_id: UUID,
        *,
        search: str | None,
        status: str | None,
        city: str | None,
        starts_after: dt.datetime | None = None,
        starts_before: dt.datetime | None = None,
    ) -> QuerySet[Event]:
        """The dashboard table's base query — identity columns only.

        `.only(...)` because the table shows nine columns, not a serialized
        model; `select_related` because every row renders its organization's
        name and would otherwise be an N+1 across the page.
        """
        queryset = (
            self.owned_events(owner_id)
            .select_related("organization")
            .only(
                "id",
                "title",
                "status",
                "venue",
                "city",
                "starts_at",
                "ends_at",
                "poster_url",
                "from_price_minor",
                "tickets_available",
                "version",
                "created_at",
                "moderation_note",
                "submitted_at",
                "organization__id",
                "organization__name",
                # The publish gate refuses an unverified organization BEFORE it
                # runs any readiness check, so the table cannot mirror that gate
                # without knowing this. One extra column on a row already joined
                # to its organization — no extra query.
                "organization__verified_level",
            )
            .order_by("-created_at")
        )
        if status:
            queryset = queryset.filter(status=status)
        if city:
            # `icontains`, not `iexact`. When this was written the parameter
            # had no control in the UI — it could be cleared from a chip and
            # never set — so exactness cost nothing. It has one now, and a
            # filter somebody TYPES has to tolerate "mumb" and "Mumbai " or it
            # reads as broken. Matches how `search` already behaves, so the
            # two text fields in the same toolbar do not follow different
            # rules.
            queryset = queryset.filter(city__icontains=city)
        # The date range is applied HERE rather than by the client, because the
        # list is cursor-paginated: filtering client-side would mean pulling
        # every page to find the ones inside the window, which is both slow and
        # wrong the moment a page boundary falls inside the range.
        if starts_after:
            queryset = queryset.filter(starts_at__gte=starts_after)
        if starts_before:
            queryset = queryset.filter(starts_at__lt=starts_before)
        if search:
            # icontains, NOT the tsvector: an organizer typing into their own
            # dashboard wants prefix/substring matching over ~hundreds of their
            # own rows ("summ" should find "Summer Fest"). Full-text search
            # needs whole words and is tuned for the public corpus of every
            # event on the platform, which is the opposite problem.
            queryset = queryset.filter(Q(title__icontains=search) | Q(venue__icontains=search))
        return queryset

    def capacity_by_event(self, event_ids: Sequence[UUID]) -> dict[UUID, tuple[int, int, int]]:
        """`{event_id: (capacity, sold, tier_count)}` from the authoritative tier rows.

        `tier_count` rides along in the same GROUP BY — a `Count` beside two
        existing `Sum`s, so it costs nothing. It is here because `capacity` is
        NOT a usable proxy for "has a ticket type": a tier with `quantity=0` is
        a real row that satisfies the publish gate while summing to zero, and a
        table that greys out Submit on `capacity == 0` would refuse a publish
        the server would have allowed. The gate counts ROWS, so this counts rows.
        """
        rows = _grouped(
            TicketType.objects.filter(event_id__in=event_ids, deleted_at__isnull=True),
            "event_id",
            capacity=Sum("quantity"),
            sold=Sum("sold"),
            tier_count=Count("id"),
        )
        return {
            row["event_id"]: (
                int(row["capacity"] or 0),
                int(row["sold"] or 0),
                int(row["tier_count"] or 0),
            )
            for row in rows
        }

    def revenue_by_event(self, event_ids: Sequence[UUID]) -> dict[UUID, int]:
        rows = _grouped(
            Payment.objects.filter(status=PaymentStatus.PAID, booking__event_id__in=event_ids),
            "booking__event_id",
            total=Sum("amount_minor"),
        )
        return {row["booking__event_id"]: int(row["total"] or 0) for row in rows}

    def checkins_by_event(self, event_ids: Sequence[UUID]) -> dict[UUID, int]:
        rows = _grouped(
            Ticket.objects.filter(booking__event_id__in=event_ids, status=TicketStatus.USED),
            "booking__event_id",
            total=Count("id"),
        )
        return {row["booking__event_id"]: int(row["total"]) for row in rows}

    # ------------------------------------------------------------ bookings

    def bookings(
        self,
        owner_id: UUID,
        *,
        event_id: UUID | None,
        status: str | None,
        search: str | None,
        created_after: dt.datetime | None = None,
        created_before: dt.datetime | None = None,
    ) -> QuerySet[Booking]:
        """Bookings across the organizer's events.

        NOTE the difference from `GET /bookings/{id}`, which is scoped to the
        ATTENDEE who made the booking. This is the other side of the same row:
        the organizer who is selling. Neither can see the other's list.
        """
        queryset = (
            Booking.objects.filter(
                event__organization__owner_id=owner_id, event__deleted_at__isnull=True
            )
            .select_related("user", "event")
            .only(
                "id",
                "status",
                "total_amount_minor",
                "platform_fee_minor",
                "payment_ref",
                "hold_expires_at",
                "created_at",
                "user__id",
                "user__email",
                "user__full_name",
                "event__id",
                "event__title",
                "event__starts_at",
            )
            # The PAYABLE payment's id, so the bookings table can offer a
            # refund. A SUBQUERY and not a second grouped read: this page's
            # query budget is enforced at two, and `payment_ref` (the vendor's
            # string) is not something `POST /payments/{id}/refund` accepts —
            # refunding by a guessed handle is the mistake this annotation
            # exists to make impossible.
            #
            # `paid` only. A `refunded` payment has nothing left to return and
            # a `created` one was never captured; offering the action for
            # either would put a button on a row it cannot act on.
            .annotate(
                captured_payment_id=Subquery(
                    Payment.objects.filter(booking_id=OuterRef("pk"), status=PaymentStatus.PAID)
                    .order_by("-created_at")
                    .values("id")[:1]
                )
            )
            .order_by("-created_at")
        )
        if event_id:
            queryset = queryset.filter(event_id=event_id)
        if status:
            queryset = queryset.filter(status=status)
        # Same reasoning as `event_rows`: the list is cursor-paginated, so a
        # client-side window is wrong across page boundaries. The ordering
        # column IS `created_at`, so this range is served straight off the
        # cursor's own index.
        if created_after:
            queryset = queryset.filter(created_at__gte=created_after)
        if created_before:
            queryset = queryset.filter(created_at__lt=created_before)
        if search:
            queryset = queryset.filter(
                Q(user__email__icontains=search)
                | Q(user__full_name__icontains=search)
                | Q(payment_ref__icontains=search)
            )
        return queryset

    def booking_item_counts(self, booking_ids: Sequence[UUID]) -> dict[UUID, int]:
        """Ticket quantity per booking, in one GROUP BY rather than per row."""
        rows = _grouped(
            Booking.objects.filter(id__in=booking_ids), "id", quantity=Sum("items__quantity")
        )
        return {row["id"]: int(row["quantity"] or 0) for row in rows}

    # ----------------------------------------------------------- customers

    def customers(self, owner_id: UUID, *, search: str | None) -> QuerySet:
        """Everyone who has ever bought from this organizer, with their
        lifetime numbers — one grouped query, computed in Postgres.

        Grouped on the USER, filtered to this organizer's paid bookings, so
        "lifetime value" means "with me", not platform-wide. An organizer has
        no business seeing what a customer spent with anyone else.
        """
        base = Booking.objects.filter(
            event__organization__owner_id=owner_id,
            event__deleted_at__isnull=True,
            status=BookingStatus.PAID,
        )
        # Filter BEFORE grouping. A `.filter()` applied after `.values().
        # annotate()` lands in HAVING (or silently re-groups), which is both
        # slower and a different question than the one being asked.
        if search:
            base = base.filter(
                Q(user__email__icontains=search) | Q(user__full_name__icontains=search)
            )
        # Returns a QUERYSET, not a list — the view paginates it, so it must
        # stay lazy. `_grouped` can't be used (it materialises); `_grouped_lazy`
        # is the same untyped-boundary trick without the `list()`.
        return _grouped_lazy(
            base,
            values={
                "customer_id": F("user__id"),
                "email": F("user__email"),
                "full_name": F("user__full_name"),
            },
            aggregates={
                "bookings": Count("id"),
                "lifetime_value_minor": Sum("total_amount_minor"),
                "last_booked_at": Max("created_at"),
            },
            order_by=("-lifetime_value_minor", "email"),
        )

    def customer_bookings(self, owner_id: UUID, customer_id: UUID) -> QuerySet[Booking]:
        return (
            Booking.objects.filter(
                event__organization__owner_id=owner_id,
                event__deleted_at__isnull=True,
                user_id=customer_id,
            )
            .select_related("event")
            .only(
                "id",
                "status",
                "total_amount_minor",
                "created_at",
                "event__id",
                "event__title",
                "event__starts_at",
            )
            .order_by("-created_at")
        )

    def customer_totals(self, owner_id: UUID, customer_id: UUID) -> dict[str, int]:
        """One row of lifetime numbers for a single customer."""
        paid = Booking.objects.filter(
            event__organization__owner_id=owner_id,
            event__deleted_at__isnull=True,
            user_id=customer_id,
            status=BookingStatus.PAID,
        ).aggregate(bookings=Count("id"), spend=Sum("total_amount_minor"))
        refunds = Refund.objects.filter(
            payment__booking__event__organization__owner_id=owner_id,
            payment__booking__user_id=customer_id,
        ).aggregate(count=Count("id"), amount=Sum("amount_minor"))
        attended = Ticket.objects.filter(
            booking__event__organization__owner_id=owner_id,
            booking__user_id=customer_id,
            status=TicketStatus.USED,
        ).count()
        issued = (
            Ticket.objects.filter(
                booking__event__organization__owner_id=owner_id, booking__user_id=customer_id
            )
            .exclude(status=TicketStatus.VOID)
            .count()
        )
        return {
            "bookings": int(paid["bookings"] or 0),
            "lifetime_value_minor": int(paid["spend"] or 0),
            "refunds": int(refunds["count"] or 0),
            "refunded_minor": int(refunds["amount"] or 0),
            "tickets_issued": issued,
            "tickets_attended": attended,
        }

    def customer_top_cities(
        self, owner_id: UUID, customer_id: UUID, limit: int
    ) -> list[tuple[str, int]]:
        """Where this customer actually goes — derived from the cities of the
        events they bought, which is a real column. There is no "preferred
        category" field on `Event`, so that is not offered rather than guessed."""
        rows = _grouped(
            Booking.objects.filter(
                event__organization__owner_id=owner_id,
                user_id=customer_id,
                status=BookingStatus.PAID,
            ),
            "event__city",
            total=Count("id"),
            order_by="-total",
            limit=limit,
        )
        return [(row["event__city"], int(row["total"])) for row in rows]

    # ----------------------------------------------------- event analytics

    def event_tier_breakdown(self, event_id: UUID) -> list[dict]:
        # `dict(row)` rather than `list(queryset)`: django-stubs types a
        # `.values(...)` row as a TypedDict, which is not a `dict[Any, Any]` as
        # far as mypy is concerned.
        rows = (
            TicketType.objects.filter(event_id=event_id, deleted_at__isnull=True)
            .values("id", "name", "price_minor", "quantity", "sold", "reserved")
            .order_by("price_minor")
        )
        return [dict(row) for row in rows]

    def event_bookings_by_status(self, event_id: UUID) -> dict[str, int]:
        rows = _grouped(Booking.objects.filter(event_id=event_id), "status", total=Count("id"))
        return {row["status"]: int(row["total"]) for row in rows}

    def event_sales_by_day(
        self, event_id: UUID, start: dt.datetime, end: dt.datetime
    ) -> list[tuple[dt.date, int]]:
        return _group_by_day(
            Payment.objects.filter(
                status=PaymentStatus.PAID,
                booking__event_id=event_id,
                created_at__gte=start,
                created_at__lt=end,
            ),
            Sum("amount_minor"),
        )

    def event_scan_results(self, event_id: UUID) -> dict[str, int]:
        rows = _grouped(ScanLog.objects.filter(event_id=event_id), "result", total=Count("id"))
        return {row["result"]: int(row["total"]) for row in rows}

    def event_header(self, event_id: UUID) -> Event | None:
        """The event's own identity, for a page that is ABOUT one event.

        The side panel got this from the table row it was opened from; a
        standalone analytics route has no row, and refetching the whole event
        to render a title would be a second query for six columns. `.only(...)`
        keeps it to those six.
        """
        return (
            Event.objects.filter(id=event_id, deleted_at__isnull=True)
            .only("id", "title", "status", "starts_at", "ends_at", "venue", "city")
            .first()
        )

    def event_refund_totals(self, event_id: UUID) -> tuple[int, int]:
        """(amount_minor, count) of refunds issued against this event.

        REPORTED SEPARATELY rather than netted off `revenue_by_event`, which
        counts `PaymentStatus.PAID` and therefore already excludes a refunded
        payment entirely. Subtracting these from that figure would deduct the
        same money twice — and an organizer looking at "revenue" wants to know
        both what they kept and what went back, not one number doing both jobs
        badly.
        """
        row = Refund.objects.filter(payment__booking__event_id=event_id).aggregate(
            total=Sum("amount_minor"), count=Count("id")
        )
        return int(row["total"] or 0), int(row["count"] or 0)

    # ---------------------------------------------------------- breakdowns

    def revenue_by_event_label(self, owner_id: UUID, limit: int) -> list[tuple[str, int]]:
        rows = _grouped(
            self._paid_payments(owner_id),
            "booking__event__title",
            total=Sum("amount_minor"),
            order_by="-total",
            limit=limit,
        )
        return [(row["booking__event__title"], int(row["total"] or 0)) for row in rows]

    def revenue_by_city(self, owner_id: UUID, limit: int) -> list[tuple[str, int]]:
        rows = _grouped(
            self._paid_payments(owner_id),
            "booking__event__city",
            total=Sum("amount_minor"),
            order_by="-total",
            limit=limit,
        )
        return [(row["booking__event__city"], int(row["total"] or 0)) for row in rows]

    def bookings_by_status(self, owner_id: UUID, limit: int) -> list[tuple[str, int]]:
        rows = _grouped(
            Booking.objects.filter(
                event__organization__owner_id=owner_id, event__deleted_at__isnull=True
            ),
            "status",
            total=Count("id"),
            order_by="-total",
            limit=limit,
        )
        return [(row["status"], int(row["total"])) for row in rows]

    def repeat_customers(self, owner_id: UUID) -> tuple[int, int]:
        """`(customers, repeat_customers)` — how many bought more than once."""
        rows = _grouped(
            Booking.objects.filter(
                event__organization__owner_id=owner_id,
                event__deleted_at__isnull=True,
                status=BookingStatus.PAID,
            ),
            "user_id",
            total=Count("id"),
        )
        counts = [int(row["total"]) for row in rows]
        return len(counts), sum(1 for count in counts if count > 1)

    # ------------------------------------------------------------- refunds

    def refunds(self, owner_id: UUID, *, event_id: UUID | None = None) -> QuerySet[Refund]:
        """Refunds issued against this organizer's events.

        `Refund` is a RECORD of money already returned, not a request awaiting a
        decision — `payments.execute_refund` writes one only after the vendor
        call succeeded. So this list has no pending/approved/rejected states to
        filter on, and the UI must not invent them: an approval workflow needs
        its own model (see BACKLOG "Refund request workflow").
        """
        queryset = (
            Refund.objects.filter(
                payment__booking__event__organization__owner_id=owner_id,
                payment__booking__event__deleted_at__isnull=True,
            )
            .select_related("payment", "payment__booking", "payment__booking__event")
            .only(
                "id",
                "rzp_refund_id",
                "amount_minor",
                "reason",
                "created_at",
                "payment__id",
                "payment__rzp_payment_id",
                "payment__amount_minor",
                "payment__booking__id",
                "payment__booking__total_amount_minor",
                "payment__booking__event__id",
                "payment__booking__event__title",
            )
            .order_by("-created_at")
        )
        if event_id:
            queryset = queryset.filter(payment__booking__event_id=event_id)
        return queryset

    # ------------------------------------------------------------ activity

    def recent_events_for_activity(self, owner_id: UUID, limit: int) -> Iterable[Booking]:
        """The organizer's own feed: their most recent bookings.

        Deliberately NOT the outbox. `core.OutboxEvent` is platform-wide with
        no owner column, so filtering it per organizer would mean scanning
        every event on the platform and inspecting payloads — the console can
        read it because the console legitimately sees everything.
        """
        return (
            Booking.objects.filter(
                event__organization__owner_id=owner_id, event__deleted_at__isnull=True
            )
            .select_related("user", "event")
            .only(
                "id",
                "status",
                "total_amount_minor",
                "created_at",
                "user__email",
                "user__full_name",
                "event__id",
                "event__title",
            )
            .order_by("-created_at")[:limit]
        )

    # ---------------------------------------------- the unified activity feed
    #
    # Five small `[:limit]` reads, merged and re-sorted in the selector.
    #
    # NOT one SQL UNION: the five rows have different shapes and live in five
    # modules, so a union would need a hand-written raw query that re-encodes
    # every module's ownership rule — exactly the coupling this file's layering
    # exists to prevent. Each read below is index-backed and bounded by
    # `limit`, so the whole feed is five cheap queries regardless of history
    # size, and merging ≤5·limit rows in Python is trivial.
    #
    # Also NOT the outbox, for the reason documented on
    # `recent_events_for_activity` above — it has no owner column. A genuinely
    # complete feed (media uploads, description edits) needs one; see BACKLOG
    # "Owner-scoped activity log".

    def recent_refunds_for_activity(self, owner_id: UUID, limit: int) -> Iterable[Refund]:
        return self.refunds(owner_id)[:limit]

    def recent_scans_for_activity(self, owner_id: UUID, limit: int) -> Iterable[ScanLog]:
        """Admissions only. A denial is an audit-trail row, not news — and a
        feed that surfaces every mis-scan at a busy gate is a feed nobody
        reads."""
        return (
            ScanLog.objects.filter(
                event__organization__owner_id=owner_id,
                event__deleted_at__isnull=True,
                result=ScanResult.ALLOWED,
            )
            .select_related("event")
            .only("id", "scanned_at", "gate", "event__id", "event__title")
            .order_by("-scanned_at")[:limit]
        )

    def recent_payouts_for_activity(self, owner_id: UUID, limit: int) -> Iterable[PayoutAttempt]:
        """Payout ATTEMPTS, not settlements: the attempt row is the one that
        carries a timestamp per try, so a failed release followed by a retry
        reads as two entries rather than one row silently changing state."""
        return (
            PayoutAttempt.objects.filter(
                settlement__event__organization__owner_id=owner_id,
                settlement__event__deleted_at__isnull=True,
            )
            .select_related("settlement", "settlement__event")
            .only(
                "id",
                "status",
                "amount_minor",
                "error",
                "created_at",
                "settlement__id",
                "settlement__event__id",
                "settlement__event__title",
            )
            .order_by("-created_at")[:limit]
        )

    def recent_event_transitions(self, owner_id: UUID, limit: int) -> Iterable[Event]:
        """Publish / approve / reject, read off the event's own moderation
        columns. `moderated_at` is set by every operator decision and
        `submitted_at` by every publish, so the transitions are already
        recorded — no second log needed for the ones that matter."""
        return (
            self.owned_events(owner_id)
            .filter(Q(submitted_at__isnull=False) | Q(moderated_at__isnull=False))
            .only(
                "id",
                "title",
                "status",
                "submitted_at",
                "moderated_at",
                "moderation_note",
            )
            .order_by(F("moderated_at").desc(nulls_last=True), "-submitted_at")[:limit]
        )


def _group_by_day(queryset, aggregate) -> list[tuple[dt.date, int]]:
    """GROUP BY calendar day, computed in Postgres.

    Four call sites wanted the identical chain — revenue, bookings and tickets
    per day, plus one event's sales timeline. The day bucket is `TruncDate` on
    a UTC column; the window passed in is already anchored to the platform
    timezone by `selectors.day_bounds`, so "day" means the same thing here as
    it does on the KPI tiles.
    """
    rows = (
        queryset.annotate(day=TruncDate("created_at"))
        .values("day")
        .annotate(total=aggregate)
        .order_by("day")
    )
    return [(row["day"], int(row["total"] or 0)) for row in rows]


def _grouped(
    queryset, *group_by: str, order_by: str = "", limit: int = 0, **aggregates
) -> list[dict]:
    """GROUP BY, computed in Postgres.

    Eleven call sites wanted `.values(...).annotate(...)` with an optional
    `ORDER BY`/`LIMIT`. The aggregation stays in the database — this only
    shapes the call, and nothing here counts anything in Python (CLAUDE.md's
    rule for the console, and for this module too).

    Returns a list, so the caller must not need laziness. When it does — the
    cursor-paginated customers list — use `_grouped_lazy`.
    """
    rows = queryset.values(*group_by).annotate(**aggregates)
    if order_by:
        rows = rows.order_by(order_by)
    if limit:
        rows = rows[:limit]
    return list(rows)


def _grouped_lazy(queryset, *, values: dict, aggregates: dict, order_by: tuple[str, ...]):
    """`_grouped`, but returns the queryset unmaterialised.

    The customers list is cursor-paginated, so the paginator has to slice it —
    a `list()` here would load every customer the organizer has ever had in
    order to show twenty of them.
    """
    return queryset.values(**values).annotate(**aggregates).order_by(*order_by)
