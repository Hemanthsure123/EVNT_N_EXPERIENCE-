"""Promotional codes — an organizer's discount on their own events.

── WHO FUNDS THE DISCOUNT, AND WHY IT DECIDES EVERYTHING ELSE ───────────────

The ORGANIZER does. A coupon is created by an organizer for their own event,
so it comes out of their ticket revenue, not the platform's fee. Three things
follow, and none of them is a free choice afterwards:

- the platform fee is charged on the DISCOUNTED subtotal, because a fee on
  face value would bill a percentage of money nobody paid;
- the Route transfer shrinks with the discount automatically, since it is
  already `total - fee - donation`;
- `Settlement` needs no new column: it recomputes `net` from the payment
  records, and the payment is simply smaller.

A PLATFORM-funded coupon (a growth campaign the platform pays for) is a
genuinely different product — it needs a funding column, a different transfer,
and a line in the settlement — and is deliberately NOT built. There is no
`funded_by` field, because a column with one possible value is a guess about
the future.

── THE LEDGER IS THE COUNT ──────────────────────────────────────────────────

There is no `redeemed_count` denormal, and its absence is load-bearing rather
than an omission. A counter would have to be decremented when a hold lapses,
and that decrement is a WRITE to the coupon row on the cancel path — which
already holds the booking row lock and is about to take tier locks. The create
path takes the coupon lock and then tier locks. Those two orders interleave
into a deadlock, and it would be a rare one: two people, one code, one tier.

Counting `CouponRedemption` rows under the coupon's lock removes the write
entirely. Releasing a hold is then just deleting a row, which needs no coupon
lock at all, so no path can order the two locks the wrong way round. A COUNT
on an indexed FK is cheap and coupons are not the hot path — most bookings
carry none.
"""

from __future__ import annotations

import uuid

from django.db import models


class CouponKind(models.TextChoices):
    """How the discount is expressed.

    Two, and no more. A "buy one get one" is not a discount on a line, it is a
    change to what is reserved, and modelling it here would put inventory
    inside a pricing rule.
    """

    PERCENT = "percent", "Percentage off"
    FIXED = "fixed", "Fixed amount off"


class Coupon(models.Model):
    """A code somebody types at checkout.

    Owned by the ORGANIZATION rather than by one event, because a promoter
    running a season wants one code across it — `event` narrows it when they
    want the opposite, and null means "any event of ours".
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.PROTECT, related_name="coupons"
    )
    #: Scope. Null is every event this organization runs; set narrows it to one.
    #:
    #: `PROTECT` rather than `CASCADE`: a coupon that has been redeemed is a
    #: financial record, and deleting the event out from under it would erase
    #: the reason a booking was cheaper than its tickets.
    event = models.ForeignKey(
        "events.Event", on_delete=models.PROTECT, null=True, blank=True, related_name="coupons"
    )
    #: Stored UPPER-CASE and compared upper-case, so "indulge100" and
    #: "INDULGE100" are one code. Unique per ORGANIZATION, not globally: two
    #: promoters both wanting "SUMMER" is not a conflict, and a global unique
    #: would make the first one to register it own the word.
    code = models.CharField(max_length=32)
    kind = models.CharField(max_length=10, choices=CouponKind.choices)
    #: Percent (1-100) or minor units, per `kind`. One column because exactly
    #: one interpretation is ever live, and two would let a row carry both.
    value = models.PositiveIntegerField()
    #: A ceiling on a PERCENTAGE coupon, in minor units. Null means no cap.
    #:
    #: The reason it exists: "20% off" on a ₹200 ticket is ₹40 and on a
    #: ₹20,000 table booking is ₹4,000. An organizer who meant the first should
    #: not discover the second on a large order.
    max_discount_minor = models.PositiveIntegerField(null=True, blank=True)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    #: Total redemptions allowed across everybody. Null is unlimited.
    max_redemptions = models.PositiveIntegerField(null=True, blank=True)
    #: Per person. Defaults to 1, which is what a promo code almost always
    #: means — an unlimited-per-user code is one person's discount forever.
    max_per_user = models.PositiveIntegerField(default=1)
    #: Whether the code may be ADVERTISED on the checkout.
    #:
    #: False is the default because the commonest use is a private code given
    #: to an influencer or a partner, and a checkout that lists it hands the
    #: discount to everybody — which is the opposite of what the organizer
    #: bought. Nothing reads this except the surface that lists codes; it never
    #: affects whether a typed code works.
    visible_at_checkout = models.BooleanField(default=False)
    #: Switched off without deleting. A redeemed coupon is referenced by real
    #: bookings, so this is the only way to stop one.
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "coupons_coupon"
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "code"], name="coupon_code_unique_per_org"
            ),
        ]
        indexes = [
            # The lookup every checkout makes: this organization, this code.
            models.Index(fields=["organization", "code"], name="coupon_org_code_idx"),
            # The organizer's list — filtered by organization, newest first.
            models.Index(fields=["organization", "-created_at"], name="coupon_org_created_idx"),
            # There is deliberately no partial index for the advertised subset
            # (`is_active AND visible_at_checkout`). An organization holds at
            # most `MAX_COUPONS_PER_ORGANIZATION` rows, so the organization
            # prefix above already reaches the whole candidate set; a third
            # index would cost every write to save a filter over ~200 rows.
        ]

    def __str__(self) -> str:
        return self.code


class CouponRedemption(models.Model):
    """One booking's use of one coupon — and the count itself.

    ── IT IS A FINANCIAL RECORD, NOT A TALLY ────────────────────────────────

    `amount_minor` is what this booking actually got off, recorded at the time
    it was decided. The coupon's own terms can change afterwards (an organizer
    edits the percentage, or switches it off), and a receipt that recomputed
    the discount from today's terms would tell somebody they paid a different
    price than they did.

    ── ONE PER BOOKING, ENFORCED BY THE DATABASE ────────────────────────────

    `booking` is a `OneToOne`, so a booking can carry at most one coupon. That
    is a product rule — stacking codes is a different feature with its own
    ordering questions — and making it a constraint rather than a check means
    no concurrent path can produce a second one.

    A row is DELETED when the hold it belongs to is cancelled or expires.
    Without that, a code with fifty uses is exhausted by fifty people who
    abandoned their checkout — the coupon analogue of leaking held inventory,
    and the same class of bug.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    coupon = models.ForeignKey(Coupon, on_delete=models.PROTECT, related_name="redemptions")
    booking = models.OneToOneField(
        "booking.Booking", on_delete=models.CASCADE, related_name="coupon_redemption"
    )
    #: Denormalised from the booking so `max_per_user` is one indexed query
    #: rather than a join through bookings on every checkout.
    user = models.ForeignKey(
        "accounts.User", on_delete=models.PROTECT, related_name="coupon_redemptions"
    )
    amount_minor = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "coupons_redemption"
        indexes = [
            # "How many times has this been used" — the check that replaces a
            # denormalised counter, so it has to be cheap.
            models.Index(fields=["coupon"], name="redemption_coupon_idx"),
            # "…and how many times by THIS person", for `max_per_user`.
            models.Index(fields=["coupon", "user"], name="redemption_coupon_user_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.coupon_id} on {self.booking_id}"
