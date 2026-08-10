"""ORM access for the operator console.

This is the ONLY file in the module that touches the ORM (CLAUDE.md's
layering rule). Everything above it — selectors, views — depends on these
methods.

Two things make this module's queries different from every other module's,
and both are deliberate:

1. **They cross module boundaries.** A platform overview counts bookings,
   payments, events, scans and organizations in one breath. Rather than
   have each module grow an admin-shaped selector nobody else calls, the
   read-only console owns these queries and imports the models it reports
   on. Nothing here writes, so it cannot corrupt another module's
   invariants; the one write the console performs goes back through
   `organizations`' own service.

2. **They aggregate rather than fetch rows.** Every method below returns
   numbers or small grouped tuples computed by Postgres, never a queryset
   the caller iterates. Counting 50k bookings in Python would be the
   obvious way to make an admin dashboard the slowest page on the platform.
"""

from __future__ import annotations

import datetime as dt
import uuid
from collections.abc import Iterable

from django.contrib.auth import get_user_model
from django.db.models import CharField, Count, IntegerField, OuterRef, Q, Subquery, Sum
from django.db.models.functions import Cast, Coalesce, TruncDate
from django.db.models.query import QuerySet

from apps.booking.models import Booking, BookingItem, BookingStatus, Ticket, TicketStatus
from apps.checkin.models import ScanLog, ScanResult
from apps.events.models import Event, EventStatus
from apps.organizations.models import Organization, VerificationRecord, VerificationStatus
from apps.payments.models import Payment, PaymentStatus, Refund
from apps.settlements.models import Settlement, SettlementStatus
from core.models import AuditLog, OutboxEvent

User = get_user_model()


class ConsoleRepository:
    """Read-only aggregates across the platform."""

    # ------------------------------------------------------------- ownership

    def event_owner_id(self, event_id: uuid.UUID) -> uuid.UUID | None:
        """Who owns the event, so an operator can be shown the organizer's own
        analytics rather than a second, parallel implementation of them.

        Returns None for an unknown or deleted event, which the view turns into
        a 404 — the same answer a stranger gets, so an id-guesser learns
        nothing from the difference.
        """
        row = (
            Event.objects.filter(id=event_id, deleted_at__isnull=True)
            .values_list("organization__owner_id", flat=True)
            .first()
        )
        return row

    def organization_owner_id(self, organization_id: uuid.UUID) -> uuid.UUID | None:
        """Same, for an organization's dashboard."""
        return (
            Organization.objects.filter(id=organization_id, deleted_at__isnull=True)
            .values_list("owner_id", flat=True)
            .first()
        )

    # ---------------------------------------------------------------- counts

    def count_organizations(self) -> int:
        return Organization.objects.filter(deleted_at__isnull=True).count()

    def count_pending_verifications(self) -> int:
        return VerificationRecord.objects.filter(status=VerificationStatus.PENDING).count()

    def count_live_events(self, now: dt.datetime) -> int:
        return Event.objects.filter(
            status=EventStatus.LIVE, deleted_at__isnull=True, starts_at__gte=now
        ).count()

    def count_bookings_between(self, start: dt.datetime, end: dt.datetime) -> int:
        return Booking.objects.filter(
            created_at__gte=start, created_at__lt=end, status=BookingStatus.PAID
        ).count()

    def sum_revenue_between(self, start: dt.datetime, end: dt.datetime) -> int:
        """Captured revenue, in minor units. Only `paid` payments count —
        `created` is an order nobody completed, and counting it would inflate
        today's number by every abandoned checkout."""
        total = Payment.objects.filter(
            created_at__gte=start, created_at__lt=end, status=PaymentStatus.PAID
        ).aggregate(total=Sum("amount_minor"))["total"]
        return int(total or 0)

    def count_tickets_issued(self) -> int:
        return Ticket.objects.exclude(status=TicketStatus.VOID).count()

    def count_checkins_between(self, start: dt.datetime, end: dt.datetime) -> int:
        """Admissions, from the append-only scan log. `allowed` only — a denied
        scan is an attendance event but not an attendance."""
        return ScanLog.objects.filter(
            scanned_at__gte=start, scanned_at__lt=end, result=ScanResult.ALLOWED
        ).count()

    def count_failed_payouts(self) -> int:
        return Settlement.objects.filter(status=SettlementStatus.FAILED).count()

    # ------------------------------------------------------------ timeseries

    def revenue_by_day(self, start: dt.datetime, end: dt.datetime) -> list[tuple[dt.date, int]]:
        rows = (
            Payment.objects.filter(
                created_at__gte=start, created_at__lt=end, status=PaymentStatus.PAID
            )
            .annotate(day=TruncDate("created_at"))
            .values("day")
            .annotate(total=Sum("amount_minor"))
            .order_by("day")
        )
        return [(row["day"], int(row["total"] or 0)) for row in rows]

    def bookings_by_day(self, start: dt.datetime, end: dt.datetime) -> list[tuple[dt.date, int]]:
        rows = (
            Booking.objects.filter(
                created_at__gte=start, created_at__lt=end, status=BookingStatus.PAID
            )
            .annotate(day=TruncDate("created_at"))
            .values("day")
            .annotate(total=Count("id"))
            .order_by("day")
        )
        return [(row["day"], int(row["total"])) for row in rows]

    def signups_by_day(self, start: dt.datetime, end: dt.datetime) -> list[tuple[dt.date, int]]:
        """New accounts per day.

        EVERY account, not just organizers — the question this answers is "is
        the platform growing", and filtering to organizers would answer a
        different and much smaller one. `date_joined` is Django's own column;
        nothing else records a signup.
        """
        rows = (
            User.objects.filter(date_joined__gte=start, date_joined__lt=end)
            .annotate(day=TruncDate("date_joined"))
            .values("day")
            .annotate(total=Count("id"))
            .order_by("day")
        )
        return [(row["day"], int(row["total"])) for row in rows]

    # ------------------------------------------------------------ breakdowns

    def events_by_city(self, limit: int) -> list[tuple[str, int]]:
        rows = (
            Event.objects.filter(status=EventStatus.LIVE, deleted_at__isnull=True)
            .values("city")
            .annotate(total=Count("id"))
            .order_by("-total", "city")[:limit]
        )
        return [(row["city"], int(row["total"])) for row in rows]

    def revenue_by_city(self, limit: int) -> list[tuple[str, int]]:
        """Captured revenue grouped by the event's city — one join, grouped in
        the database. `booking__event__city` is the whole path from payment to
        place."""
        # `values("path")`, not `values(alias="path")` — the keyword form expects
        # a query EXPRESSION (an F(), a Func()), and handing it a plain string
        # raises at query-build time. It 500s on every call, which is how this
        # shipped broken past a test that only exercised the other branch.
        rows = (
            Payment.objects.filter(status=PaymentStatus.PAID)
            .values("booking__event__city")
            .annotate(total=Sum("amount_minor"))
            .order_by("-total")[:limit]
        )
        return [(row["booking__event__city"], int(row["total"] or 0)) for row in rows]

    # -------------------------------------------------------------- activity

    def recent_activity(self, limit: int, types: Iterable[str] | None = None) -> list[OutboxEvent]:
        """The platform's real activity feed.

        The outbox already records every domain event the system emits, in
        the same transaction as the write that caused it — so it is both
        complete and ordered, with no separate audit pipeline to keep in
        sync. Reading it here is the whole activity timeline.
        """
        queryset = OutboxEvent.objects.only(
            "id", "event_type", "aggregate_id", "payload", "created_at"
        ).order_by("-created_at")
        if types:
            queryset = queryset.filter(event_type__in=list(types))
        return list(queryset[:limit])

    # ----------------------------------------------------------------- lists

    @staticmethod
    def _within(queryset, field: str, after, before):
        """Narrow a list to a date window, on whichever column it orders by.

        SERVER-SIDE, always. Every list here is cursor-paginated, so filtering
        a window in the browser means paging through the whole platform to
        find the rows inside it — and is simply WRONG wherever a page boundary
        falls in the middle of the range. The same reasoning the organizer
        lists' date filters were built on.
        """
        if after is not None:
            queryset = queryset.filter(**{f"{field}__gte": after})
        if before is not None:
            queryset = queryset.filter(**{f"{field}__lte": before})
        return queryset

    def list_organizations(
        self,
        *,
        verified_level: str | None,
        search: str | None = None,
        created_after=None,
        created_before=None,
    ) -> QuerySet[Organization]:
        queryset = (
            Organization.objects.filter(deleted_at__isnull=True)
            .only("id", "name", "verified_level", "payout_account_id", "logo_url", "created_at")
            .order_by("-created_at")
        )
        if verified_level:
            queryset = queryset.filter(verified_level=verified_level)
        if search:
            queryset = queryset.filter(name__icontains=search)
        return self._within(queryset, "created_at", created_after, created_before)

    def list_users(
        self,
        *,
        search: str | None,
        role: str | None = None,
        created_after=None,
        created_before=None,
    ):
        queryset = User.objects.only(
            "id",
            "email",
            "full_name",
            "is_organizer",
            "is_staff",
            "is_superuser",
            "is_active",
            # In the lean set because `AdminUserSerializer` returns it — a
            # field the serializer touches but `.only()` omits is a DEFERRED
            # load, one extra query per row.
            "email_verified",
            "date_joined",
        ).order_by("-date_joined")
        if search:
            queryset = queryset.filter(Q(email__icontains=search) | Q(full_name__icontains=search))
        # Roles are stored as three independent booleans rather than one
        # column, so "role" here is a filter over them rather than an enum
        # lookup. `suspended` is `is_active=False`, which is Django's own
        # meaning — a suspended account cannot authenticate at all.
        if role == "organizer":
            queryset = queryset.filter(is_organizer=True)
        elif role == "staff":
            queryset = queryset.filter(is_staff=True)
        elif role == "suspended":
            queryset = queryset.filter(is_active=False)
        elif role == "attendee":
            queryset = queryset.filter(is_organizer=False, is_staff=False)
        # `date_joined`, not `created_at` — this is Django's own user model and
        # the window has to be on the column the list ORDERS by, or the filter
        # and the cursor disagree about which rows a page holds.
        return self._within(queryset, "date_joined", created_after, created_before)

    # ------------------------------------------------------------- payments

    def list_payments(
        self,
        *,
        status: str | None,
        search: str | None,
        created_after=None,
        created_before=None,
    ) -> QuerySet[Payment]:
        """Every captured payment on the platform.

        `select_related` down to the event because the transactions table shows
        the customer and the event on each row — without it, a page of 25 is
        50 extra queries.
        """
        queryset = (
            Payment.objects.select_related("booking", "booking__user", "booking__event")
            .only(
                "id",
                "rzp_order_id",
                "rzp_payment_id",
                "amount_minor",
                "status",
                "created_at",
                "booking__id",
                "booking__total_amount_minor",
                "booking__platform_fee_minor",
                "booking__user__id",
                "booking__user__email",
                "booking__user__full_name",
                "booking__event__id",
                "booking__event__title",
            )
            .order_by("-created_at")
        )
        if status:
            queryset = queryset.filter(status=status)
        if search:
            queryset = queryset.filter(
                Q(rzp_payment_id__icontains=search)
                | Q(rzp_order_id__icontains=search)
                | Q(booking__user__email__icontains=search)
            )
        return self._within(queryset, "created_at", created_after, created_before)

    @staticmethod
    def _booking_base() -> QuerySet[Booking]:
        """Bookings with the two counts the support desk reads, as CORRELATED
        SUBQUERIES rather than aggregate joins.

        Quantity lives on `BookingItem` and tickets on `Ticket`, so the obvious
        `.annotate(Sum("items__quantity"), Count("tickets"))` is wrong in a way
        that is easy to ship and hard to notice: two joins in one query produce
        a cartesian product, so a booking with 2 items and 3 tickets reports a
        quantity of 6 and a ticket count of 6. `distinct=True` rescues the
        Count and cannot rescue the Sum — there is no such thing as a distinct
        sum of a repeated row.

        Two scalar subqueries have neither problem, stay a single round trip,
        and keep the numbers independent of each other.

        `Coalesce(..., 0)` because a subquery over no rows returns NULL, and an
        abandoned checkout with no tickets should read 0 rather than null on
        the exact screen that exists to answer "were any issued?".
        """
        items_quantity = (
            BookingItem.objects.filter(booking=OuterRef("pk"))
            .values("booking")
            .annotate(total=Sum("quantity"))
            .values("total")[:1]
        )
        tickets_issued = (
            Ticket.objects.filter(booking=OuterRef("pk"))
            .values("booking")
            .annotate(total=Count("id"))
            .values("total")[:1]
        )
        return Booking.objects.select_related("user", "event").annotate(
            quantity_total=Coalesce(Subquery(items_quantity, output_field=IntegerField()), 0),
            tickets_issued_total=Coalesce(Subquery(tickets_issued, output_field=IntegerField()), 0),
        )

    def list_bookings(
        self,
        *,
        status: str | None,
        search: str | None,
        created_after=None,
        created_before=None,
        event_id=None,
    ) -> QuerySet[Booking]:
        """Every booking on the platform, searchable — the support desk's tool.

        ── WHY THIS EXISTS ────────────────────────────────────────────────

        "The customer says they paid but has no ticket" is the single most
        common support question a ticketing platform gets, and until this
        method there was **no way to answer it from the product**.
        `GET /bookings/{id}` is scoped to the booking's own owner, so an
        operator could not open one even holding the id; the only route was the
        Django admin.

        The payment search partly covered it and structurally could not cover
        it fully: a booking that never reached payment — the abandoned
        checkout, which is exactly the case somebody phones about — has no
        `Payment` row to find it by.

        ── WHAT IT SEARCHES, AND WHY EACH ─────────────────────────────────

        An operator on a call has ONE of these, read out loud, and does not
        know which kind of thing it is:

        - the customer's **email** (most common);
        - a **booking id**, from the confirmation email;
        - a **payment reference**, from their bank statement — the string a
          customer is most likely to have when they believe they paid;
        - the **event title**, when they have nothing else ("the Arijit gig").

        A single `q` across all four rather than four parameters, because the
        operator does not know which they are holding, and asking them to
        classify it before searching is a worse tool.

        ── UUID SEARCH IS PREFIX-MATCHED ON THE TEXT FORM ─────────────────

        `id__icontains` cannot be used on a Postgres `uuid` column — it is not
        a text type, and the ORM raises rather than coercing. So the id is cast
        to text first. This also makes a PARTIAL id work, which matters:
        people read out the first block of a uuid, not all thirty-six
        characters.
        """
        queryset = (
            self._booking_base()
            .only(
                "id",
                "status",
                "total_amount_minor",
                "platform_fee_minor",
                "payment_ref",
                "payment_order_id",
                "hold_expires_at",
                "created_at",
                "user__id",
                "user__email",
                "user__full_name",
                "event__id",
                "event__title",
                "event__starts_at",
            )
            .order_by("-created_at")
        )
        if status:
            queryset = queryset.filter(status=status)
        if event_id:
            # An EXACT id, not a title match. The console's picker resolves a
            # name to an id before asking, because two events genuinely share
            # a title — a Saturday and a Sunday night of the same show — and a
            # revenue figure that silently summed both is worse than no filter.
            queryset = queryset.filter(event_id=event_id)
        if search:
            queryset = queryset.annotate(_id_text=Cast("id", CharField())).filter(
                Q(user__email__icontains=search)
                | Q(_id_text__istartswith=search)
                | Q(payment_ref__icontains=search)
                | Q(payment_order_id__icontains=search)
                | Q(event__title__icontains=search)
            )
        return self._within(queryset, "created_at", created_after, created_before)

    def booking_detail(self, booking_id: uuid.UUID | str) -> Booking | None:
        """One booking, with everything an operator needs to answer the call.

        Prefetches items and tickets because the whole point of opening a
        booking here is to see whether tickets were ISSUED — which is the
        answer to "I paid but got nothing". Without the prefetch a booking with
        six tickets is six extra queries on the screen an operator opens most.
        """
        return (
            self._booking_base()
            .prefetch_related("items", "items__ticket_type", "tickets", "tickets__ticket_type")
            .filter(pk=booking_id)
            .first()
        )

    def list_refunds(
        self, *, search: str | None, created_after=None, created_before=None
    ) -> QuerySet[Refund]:
        """Every refund on the platform.

        There is no `status` filter because there is no status: a `Refund` row
        is written only after the vendor call has succeeded, so every row is a
        completed refund. Pending/approved/rejected would need a refund-REQUEST
        model, which does not exist (see BACKLOG).
        """
        queryset = (
            Refund.objects.select_related(
                "payment", "payment__booking", "payment__booking__user", "payment__booking__event"
            )
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
                "payment__booking__user__email",
                "payment__booking__event__id",
                "payment__booking__event__title",
            )
            .order_by("-created_at")
        )
        if search:
            queryset = queryset.filter(
                Q(rzp_refund_id__icontains=search)
                | Q(payment__rzp_payment_id__icontains=search)
                | Q(payment__booking__user__email__icontains=search)
            )
        return self._within(queryset, "created_at", created_after, created_before)

    def count_payments_by_status(self) -> dict[str, int]:
        """One GROUP BY for the four status tiles, rather than four COUNTs."""
        rows = Payment.objects.values("status").annotate(total=Count("id"))
        return {row["status"]: int(row["total"]) for row in rows}

    def list_settlements(self, *, status: str | None) -> QuerySet[Settlement]:
        queryset = (
            Settlement.objects.select_related("event")
            .only(
                "id",
                "status",
                "gross",
                "platform_fee",
                "refunds",
                "net",
                "releasable_at",
                "payout_at",
                "attempts",
                "error",
                "created_at",
                "event__id",
                "event__title",
            )
            .order_by("-created_at")
        )
        if status:
            queryset = queryset.filter(status=status)
        return queryset

    def list_audit(self, *, action: str | None, target_id: str | None) -> QuerySet[AuditLog]:
        """The immutable administrative trail.

        Separate from `recent_activity` (which reads the OUTBOX) on purpose:
        the outbox records what the DOMAIN did, the audit log records what a
        PERSON did. "A booking was confirmed" and "an operator approved this
        event" answer different questions, and conflating them makes the
        second impossible to find.

        Rows are append-only — `record_audit` only ever inserts, and nothing in
        the codebase updates or deletes one.
        """
        queryset = AuditLog.objects.only(
            "id", "actor_id", "action", "target_type", "target_id", "metadata", "created_at"
        ).order_by("-created_at")
        if action:
            queryset = queryset.filter(action__startswith=action)
        if target_id:
            queryset = queryset.filter(target_id=target_id)
        return queryset

    def actor_emails(self, actor_ids: list[str]) -> dict[str, str]:
        """Resolve actor ids to emails in ONE query.

        `AuditLog.actor_id` is a plain string, not an FK — deliberately, so the
        trail survives the actor being deleted. That means no `select_related`
        is possible and a naive viewer would issue one query per row.
        """
        valid = [candidate for candidate in actor_ids if candidate]
        if not valid:
            return {}
        rows = User.objects.filter(id__in=valid).values_list("id", "email")
        return {str(user_id): email for user_id, email in rows}

    def list_pending_verifications(self) -> QuerySet[VerificationRecord]:
        return (
            VerificationRecord.objects.filter(status=VerificationStatus.PENDING)
            .select_related("organization")
            .only(
                "id",
                "status",
                "notes",
                "created_at",
                "organization__id",
                "organization__name",
                "organization__verified_level",
            )
            .order_by("created_at")
        )
