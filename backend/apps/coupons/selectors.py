"""Read-only queries for coupons — the offers a checkout may advertise.

The organizer's own list is a SERVICE method rather than a selector, because it
is gated on ownership and that gate is a business rule. What lives here is the
one read with no owner behind it: the codes an organizer chose to publish.

── AN OFFER THAT CANNOT BE TAKEN IS NOT AN OFFER ───────────────────────────

Exhausted coupons are excluded. A checkout listing "SUMMER20 — 20% off" beside
a field that answers "that code has been fully claimed" is worse than showing
nothing: it is the platform advertising a discount it will then refuse. The
count is the same `COUNT(*)` the redemption path uses, aggregated for the whole
list in one query.

It is NOT filtered by the viewer. `max_per_user` is about who is asking, and
applying it here would make this response per-user and therefore uncacheable —
for the sake of one case (somebody who already used a code being shown it
again) that resolves into a clear sentence the moment they press Apply.
"""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass

from .models import Coupon
from .repositories import CouponRedemptionRepository, CouponRepository


@dataclass(frozen=True)
class PublicOffer:
    """One advertised code, as a checkout should read it.

    A DTO rather than the model, because two of its fields are not columns:
    `expires_at` is the coupon's end only when it HAS one, and the rest is the
    terms flattened into the shape a discount line needs. Serializing the model
    would also expose `max_redemptions` and `max_per_user`, which are the
    organizer's business and tell a code-sharer exactly how much of a race they
    are in.
    """

    id: uuid.UUID
    code: str
    kind: str
    value: int
    max_discount_minor: int | None
    expires_at: dt.datetime | None


def public_offers_for_event(
    *,
    organization_id: uuid.UUID | str,
    event_id: uuid.UUID | str,
    now: dt.datetime,
    coupons: CouponRepository | None = None,
    redemptions: CouponRedemptionRepository | None = None,
) -> list[PublicOffer]:
    """Live, advertised, still-claimable codes for this event."""
    coupons = coupons or CouponRepository()
    redemptions = redemptions or CouponRedemptionRepository()

    rows = coupons.list_public_for_event(
        organization_id=organization_id, event_id=event_id, now=now
    )
    if not rows:
        # Skip the aggregate entirely for the common case: most events have no
        # advertised codes, and this read sits on the checkout.
        return []

    usage = redemptions.usage_by_coupon([row.id for row in rows])
    return [_offer(row) for row in rows if not _is_exhausted(row, usage)]


def _is_exhausted(coupon: Coupon, usage: dict[str, int]) -> bool:
    if coupon.max_redemptions is None:
        return False
    return usage.get(str(coupon.id), 0) >= coupon.max_redemptions


def _offer(coupon: Coupon) -> PublicOffer:
    return PublicOffer(
        id=coupon.id,
        code=coupon.code,
        kind=coupon.kind,
        value=coupon.value,
        max_discount_minor=coupon.max_discount_minor,
        expires_at=coupon.ends_at,
    )
