"""ORM access for coupons — the organizer's list, and the checkout's lookup.

Two access patterns, and they want different things:

- The ORGANIZER's screens read a page of rows with everything on them. Small,
  cold, and not on any hot path.
- The CHECKOUT resolves ONE code, and then decides under a lock. That is the
  money path, so it is two statements: an indexed lookup by
  `(organization, code)`, and — only once a code has actually been found — a
  `SELECT ... FOR UPDATE` on that single row.

`lock_for_update` and `count_redemptions` are the pair the decision is made
from, and they must always be called in that order inside one transaction. A
count taken before the lock is a check somebody else can invalidate between the
check and the write, which is exactly how a code with fifty uses gets used
fifty-one times.
"""

from __future__ import annotations

import datetime as dt
import uuid

from django.db.models import Q, QuerySet

from core.base_repository import BaseRepository

from .models import Coupon, CouponRedemption

#: The columns the locked decision needs. Everything on the row is read while
#: deciding — the window, the caps, the terms — so this is the whole row minus
#: the presentational bits, and it is written out rather than left to `*` so a
#: future column cannot silently join the critical section.
_LOCK_FIELDS = (
    "id",
    "organization_id",
    "event_id",
    "code",
    "kind",
    "value",
    "max_discount_minor",
    "starts_at",
    "ends_at",
    "max_redemptions",
    "max_per_user",
    "is_active",
)


def normalize_code(code: str) -> str:
    """One spelling of a code, everywhere.

    Upper-cased and stripped, so "indulge100", " INDULGE100 " and "Indulge100"
    are the same coupon — people retype codes off posters and screenshots, and
    a case-sensitive comparison turns a correct code into a wrong one. The
    normalisation happens HERE, next to the queries that rely on it, rather
    than in a serializer: a service calling the repository directly must get
    the same answer as one going through the API.
    """
    return code.strip().upper()


class CouponRepository(BaseRepository[Coupon]):
    model = Coupon

    # ── the organizer's side ────────────────────────────────────────────────

    def list_for_organization(self, organization_id: uuid.UUID | str) -> QuerySet[Coupon]:
        """Newest first — an organizer is nearly always looking for the one
        they just made."""
        return Coupon.objects.filter(organization_id=organization_id).order_by("-created_at")

    def get_owned(
        self, *, organization_id: uuid.UUID | str, coupon_id: uuid.UUID | str
    ) -> Coupon | None:
        """Scoped by organization, so somebody else's row is never loaded.

        The service turns `None` into a 404 for both "no such coupon" and "not
        yours", which is why this cannot be a plain `get_by_id` with a check
        afterwards.
        """
        return Coupon.objects.filter(pk=coupon_id, organization_id=organization_id).first()

    def code_exists(
        self,
        *,
        organization_id: uuid.UUID | str,
        code: str,
        excluding_id: uuid.UUID | str | None = None,
    ) -> bool:
        """A friendly pre-check for the unique constraint.

        NOT the guard — `coupon_code_unique_per_org` is, and the service
        catches its `IntegrityError`. This exists so the common case answers
        with a sentence about the code instead of a 500-shaped surprise, and
        so an edit that keeps its own code does not collide with itself.
        """
        rows = Coupon.objects.filter(organization_id=organization_id, code=normalize_code(code))
        if excluding_id is not None:
            rows = rows.exclude(pk=excluding_id)
        return rows.exists()

    def create(self, **fields) -> Coupon:
        return Coupon.objects.create(**fields)

    def update(self, coupon_id: uuid.UUID | str, **fields) -> bool:
        return Coupon.objects.filter(pk=coupon_id).update(**fields) == 1

    def delete_owned(self, *, organization_id: uuid.UUID | str, coupon_id: uuid.UUID | str) -> int:
        """Only ever reachable for a coupon with no redemptions — the model's
        `PROTECT` makes that a database fact rather than a hope, and the
        service checks first so the answer is a sentence rather than an
        integrity error."""
        deleted, _ = Coupon.objects.filter(pk=coupon_id, organization_id=organization_id).delete()
        return deleted

    # ── the checkout's side ─────────────────────────────────────────────────

    def find_live_by_code(self, *, organization_id: uuid.UUID | str, code: str) -> Coupon | None:
        """Resolve a typed code, WITHOUT a lock. Display only.

        `is_active` is part of the predicate rather than checked afterwards, so
        a switched-off code is indistinguishable from one that never existed —
        see `exceptions.py` on what a refusal may reveal. Everything else about
        usability (the window, the caps) is decided by the service, because
        those answers are specific and worth giving.

        Backed by `coupon_org_code_idx`.
        """
        return Coupon.objects.filter(
            organization_id=organization_id, code=normalize_code(code), is_active=True
        ).first()

    def list_public_for_event(
        self, *, organization_id: uuid.UUID | str, event_id: uuid.UUID | str, now: dt.datetime
    ) -> list[Coupon]:
        """The codes this organizer chose to ADVERTISE on this event's checkout.

        Everything here is a fact about the coupon, never about who is asking —
        `max_per_user` is deliberately not applied, because filtering by the
        viewer would make this response per-user and therefore uncacheable, for
        a case (somebody who already used a code seeing it offered) that costs
        one clear refusal when they press Apply.

        Org-wide coupons (`event` null) are included alongside the event's own,
        which is the whole reason the column is nullable.
        """
        return list(
            Coupon.objects.filter(
                Q(event_id__isnull=True) | Q(event_id=event_id),
                Q(starts_at__isnull=True) | Q(starts_at__lte=now),
                Q(ends_at__isnull=True) | Q(ends_at__gt=now),
                organization_id=organization_id,
                is_active=True,
                visible_at_checkout=True,
            )
            .only(
                "id",
                "code",
                "kind",
                "value",
                "max_discount_minor",
                "ends_at",
                "max_redemptions",
            )
            .order_by("code")
        )

    def lock_for_update(self, coupon_id: uuid.UUID | str) -> Coupon | None:
        """`SELECT ... FOR UPDATE` on the one coupon row. MUST be inside a
        transaction.

        This is the lock that serialises redemption. It is taken by
        `CouponRedemptionService.redeem`, which already holds the BOOKING row's
        lock — so the one and only ordering in the system is booking → coupon.
        The release path takes no coupon lock at all (it deletes a redemption
        row), which is why nothing can invert it.
        """
        return Coupon.objects.select_for_update().filter(pk=coupon_id).only(*_LOCK_FIELDS).first()


class CouponRedemptionRepository(BaseRepository[CouponRedemption]):
    model = CouponRedemption

    def count_for_coupon(self, coupon_id: uuid.UUID | str) -> int:
        """The redemption count — THE count, not a cached view of one.

        Called under the coupon's row lock, which is what makes it a decision
        rather than a reading. Backed by `redemption_coupon_idx`.
        """
        return CouponRedemption.objects.filter(coupon_id=coupon_id).count()

    def count_for_coupon_and_user(
        self, *, coupon_id: uuid.UUID | str, user_id: uuid.UUID | str
    ) -> int:
        """Backed by `redemption_coupon_user_idx`."""
        return CouponRedemption.objects.filter(coupon_id=coupon_id, user_id=user_id).count()

    def create(
        self,
        *,
        coupon_id: uuid.UUID | str,
        booking_id: uuid.UUID | str,
        user_id: uuid.UUID | str,
        amount_minor: int,
    ) -> CouponRedemption:
        return CouponRedemption.objects.create(
            id=uuid.uuid4(),
            coupon_id=coupon_id,
            booking_id=booking_id,
            user_id=user_id,
            amount_minor=amount_minor,
        )

    def get_for_booking(self, booking_id: uuid.UUID | str) -> CouponRedemption | None:
        return (
            CouponRedemption.objects.select_related("coupon").filter(booking_id=booking_id).first()
        )

    def delete_for_booking(self, booking_id: uuid.UUID | str) -> int:
        """Release: the row IS the count, so deleting it frees the redemption.

        Takes no coupon lock, deliberately. That is what keeps the cancel path
        — which already holds the booking row lock and is about to take tier
        locks — from ever ordering the coupon lock against them.
        """
        deleted, _ = CouponRedemption.objects.filter(booking_id=booking_id).delete()
        return deleted

    def exists_for_coupon(self, coupon_id: uuid.UUID | str) -> bool:
        """Whether deleting this coupon would orphan a financial record."""
        return CouponRedemption.objects.filter(coupon_id=coupon_id).exists()

    def usage_by_coupon(self, coupon_ids: list[uuid.UUID | str]) -> dict[str, int]:
        """Redemption counts for a whole page of coupons, in ONE query.

        The organizer's list shows "12 of 50 used" per row, and asking per row
        is the N+1 the performance checklist exists to prevent. Aggregated in
        Postgres rather than by counting rows in Python.
        """
        if not coupon_ids:
            return {}
        from django.db.models import Count

        return {
            str(row["coupon_id"]): row["n"]
            for row in CouponRedemption.objects.filter(coupon_id__in=coupon_ids)
            .values("coupon_id")
            .annotate(n=Count("id"))
        }


def window_is_open(coupon: Coupon, *, now: dt.datetime) -> tuple[bool, bool]:
    """`(started, ended)` for this coupon at `now`.

    A plain function rather than a model property: it takes the clock as an
    argument, so a test can put a coupon in any part of its life without
    freezing time, and the caller passes the SAME `now` it uses for everything
    else in that decision.
    """
    started = coupon.starts_at is None or coupon.starts_at <= now
    ended = coupon.ends_at is not None and coupon.ends_at <= now
    return started, ended
