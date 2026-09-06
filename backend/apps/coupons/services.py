"""Coupons: the organizer's management rules, and the checkout's decision.

TWO SERVICES, because they answer to two different people. Every method on
`CouponService` acts for the ORGANIZATION OWNER and is authorised by scoping
the query to their organization; every method on `CouponRedemptionService`
acts for a CUSTOMER at a checkout, who is authorised to type any code they
happen to know. Folding them together would put two different answers to "who
may do this" in one class — the same reason `AccountAdminService` is separate
from `AuthService`, and `CrewService` from `EventContentService`.

── THE MONEY RULE THIS MODULE OBEYS ─────────────────────────────────────────

The same one `ticketing` established, applied to a discount instead of a seat:

> **A discount is DECIDED under the coupon's row lock, in the same
> transaction as the booking it belongs to, and nowhere else.**

Two people holding the last redemption of a code both pass a check-then-write,
so `redeem` decides under the coupon's row lock, inside the transaction that
already holds the booking's. The subtotal it prices against is the sum of the
booking's own line items — already decided under the tier locks when the hold
was taken — so there is no unlocked price anywhere on this path.

── LOCK ORDER: BOOKING, THEN COUPON ─────────────────────────────────────────

That is the only place two of these locks are held together, so there is
exactly ONE order in the system and no path that can invert it. Tier locks
never meet a coupon lock, because applying a code reserves nothing. And the
release path takes no coupon lock at all — it deletes the redemption row, and
the rows are the count (see `models.py`) — which is what keeps the cancel and
sweeper paths, already holding a booking lock and about to take tier locks,
from ever ordering a coupon lock against them.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from django.db import IntegrityError
from django.utils import timezone

from apps.events.repositories import EventRepository
from apps.organizations.repositories import OrganizationRepository
from core.errors import InvalidInputError

from .discounts import MAX_PERCENT, MIN_PAYABLE_TOTAL_MINOR, CouponTerms, discount_on
from .exceptions import (
    CouponAlreadyAppliedError,
    CouponAlreadyUsedError,
    CouponCodeTakenError,
    CouponExhaustedError,
    CouponExpiredError,
    CouponLeavesNothingToChargeError,
    CouponNotFoundError,
    CouponNotStartedError,
    CouponUnknownError,
    CouponWorthNothingError,
    CouponWrongEventError,
    InvalidCouponError,
)
from .models import Coupon, CouponKind, CouponRedemption
from .repositories import (
    CouponRedemptionRepository,
    CouponRepository,
    normalize_code,
    window_is_open,
)

logger = logging.getLogger(__name__)

#: A code is typed off a poster, a story or a WhatsApp message. Letters,
#: digits, dash and underscore only — a space is unrepresentable in the URL a
#: shared checkout link would carry, and punctuation that renders differently
#: in two fonts is a code somebody will mistype forever.
_CODE_ALPHABET = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")

MIN_CODE_LENGTH = 3
MAX_CODE_LENGTH = 32

#: A promotions list, not a keyspace. High enough that no real organizer meets
#: it, low enough that an automated write loop cannot fill the table.
MAX_COUPONS_PER_ORGANIZATION = 200


def validate_code(raw: str) -> str:
    """Normalise and check a code, or raise. Returns the stored spelling."""
    code = normalize_code(raw or "")
    if len(code) < MIN_CODE_LENGTH or len(code) > MAX_CODE_LENGTH:
        raise InvalidCouponError(
            f"A code is between {MIN_CODE_LENGTH} and {MAX_CODE_LENGTH} characters."
        )
    if any(character not in _CODE_ALPHABET for character in code):
        raise InvalidCouponError("A code can use letters, numbers, dashes and underscores only.")
    return code


def validate_terms(
    *,
    kind: str,
    value: int,
    max_discount_minor: int | None,
    starts_at,
    ends_at,
    max_redemptions: int | None,
    max_per_user: int,
) -> None:
    """Everything about the terms that can be decided without the database.

    Checked against the MERGED row on an update, never against the submitted
    fields alone — the same reasoning as ticketing's group bands. `kind` and
    `value` are independently editable, so validating a PATCH that carries only
    `value` against a submitted-but-absent `kind` would check nothing, and
    switching a percentage coupon to fixed while leaving `value: 20` would
    quietly turn "20% off" into "20 paise off".
    """
    if kind not in CouponKind.values:
        raise InvalidCouponError("A coupon is either a percentage or a fixed amount.")

    if value < 1:
        raise InvalidCouponError("A discount of nothing is not a discount.")

    if kind == CouponKind.PERCENT:
        if value > MAX_PERCENT:
            raise InvalidCouponError(f"A percentage discount is at most {MAX_PERCENT}%.")
    elif max_discount_minor is not None:
        # A ceiling on a fixed amount is the fixed amount. Refused rather than
        # ignored: a field that is silently discarded is one an organizer will
        # set, read back as empty, and set again.
        raise InvalidCouponError("A maximum discount only applies to a percentage coupon.")

    if max_discount_minor is not None and max_discount_minor < 1:
        raise InvalidCouponError("A maximum discount of nothing would disable the coupon.")

    if starts_at and ends_at and ends_at <= starts_at:
        raise InvalidCouponError("The coupon would end before it started.")

    if max_redemptions is not None and max_redemptions < 1:
        raise InvalidCouponError("A coupon with no redemptions could never be used.")

    if max_per_user < 1:
        raise InvalidCouponError("A coupon nobody may use once could never be used.")


class CouponService:
    """The organizer's promotions list.

    OWNERSHIP IS PROVEN BY SCOPING THE QUERY, not by loading a row and then
    comparing — `get_owned` filters on `organization_id`, so a coupon belonging
    to somebody else is never fetched, and a guessed uuid gets the same 404 as
    one that does not exist.
    """

    def __init__(
        self,
        *,
        organizations: OrganizationRepository,
        coupons: CouponRepository | None = None,
        redemptions: CouponRedemptionRepository | None = None,
        events: EventRepository | None = None,
    ) -> None:
        self._organizations = organizations
        self._coupons = coupons or CouponRepository()
        self._redemptions = redemptions or CouponRedemptionRepository()
        self._events = events or EventRepository()

    # ── authorisation ───────────────────────────────────────────────────────

    def _owned_organization(self, *, organization_id, actor_id):
        organization = self._organizations.get_active_by_id(organization_id)
        if organization is None or str(organization.owner_id) != str(actor_id):
            raise CouponNotFoundError("Organization not found.")
        return organization

    def _owned_event_id(self, *, organization_id, event_id) -> uuid.UUID | None:
        """Resolve an optional event scope, refusing one that is not theirs.

        THE CROSS-TENANT CHECK. The id arrives from a browser, and without this
        a guessed uuid would attach another organization's event to a coupon —
        which, once the money path reads `coupon.event_id`, is a discount one
        promoter can define on another promoter's tickets.
        """
        if event_id is None:
            return None
        event = self._events.get_active_by_id(event_id)
        if event is None or str(event.organization_id) != str(organization_id):
            raise CouponNotFoundError("Event not found.")
        return event.id

    # ── reads ───────────────────────────────────────────────────────────────

    def list_coupons(self, *, organization_id, actor_id) -> tuple[list[Coupon], dict[str, int]]:
        """The list, plus how many times each row has been used.

        Usage comes back as a separate map rather than as an annotation on each
        row, so the caller can serialize plain model instances and the count
        stays visibly a derived figure. ONE aggregate query for the whole page
        — asking per row is the N+1 the performance checklist exists to stop.
        """
        self._owned_organization(organization_id=organization_id, actor_id=actor_id)
        rows = list(self._coupons.list_for_organization(organization_id))
        usage = self._redemptions.usage_by_coupon([row.id for row in rows])
        return rows, usage

    def get_coupon(self, *, organization_id, actor_id, coupon_id) -> tuple[Coupon, int]:
        self._owned_organization(organization_id=organization_id, actor_id=actor_id)
        coupon = self._coupons.get_owned(organization_id=organization_id, coupon_id=coupon_id)
        if coupon is None:
            raise CouponNotFoundError()
        return coupon, self._redemptions.count_for_coupon(coupon.id)

    # ── writes ──────────────────────────────────────────────────────────────

    def create_coupon(
        self,
        *,
        organization_id,
        actor_id,
        code: str,
        kind: str,
        value: int,
        max_discount_minor: int | None = None,
        starts_at=None,
        ends_at=None,
        max_redemptions: int | None = None,
        max_per_user: int = 1,
        visible_at_checkout: bool = False,
        event_id=None,
    ) -> Coupon:
        organization = self._owned_organization(organization_id=organization_id, actor_id=actor_id)
        stored_code = validate_code(code)
        validate_terms(
            kind=kind,
            value=value,
            max_discount_minor=max_discount_minor,
            starts_at=starts_at,
            ends_at=ends_at,
            max_redemptions=max_redemptions,
            max_per_user=max_per_user,
        )
        # Only on create. An end date in the past is a typo when nothing has
        # happened yet, and it is how an organizer deliberately STOPS a running
        # coupon — so refusing it on an edit would remove a legitimate action.
        if ends_at is not None and ends_at <= timezone.now():
            raise InvalidCouponError("That coupon would already have expired.")

        scoped_event_id = self._owned_event_id(organization_id=organization.id, event_id=event_id)

        if self._coupons.list_for_organization(organization.id).count() >= (
            MAX_COUPONS_PER_ORGANIZATION
        ):
            raise InvalidInputError(f"You already have {MAX_COUPONS_PER_ORGANIZATION} coupons.")
        if self._coupons.code_exists(organization_id=organization.id, code=stored_code):
            raise CouponCodeTakenError(stored_code)

        try:
            coupon = self._coupons.create(
                id=uuid.uuid4(),
                organization_id=organization.id,
                event_id=scoped_event_id,
                code=stored_code,
                kind=kind,
                value=int(value),
                max_discount_minor=max_discount_minor,
                starts_at=starts_at,
                ends_at=ends_at,
                max_redemptions=max_redemptions,
                max_per_user=int(max_per_user),
                visible_at_checkout=bool(visible_at_checkout),
            )
        except IntegrityError:
            # `coupon_code_unique_per_org` is the real guard; the check above is
            # only there so the common case reads as a sentence about the code.
            # A concurrent create with the same code lands here.
            raise CouponCodeTakenError(stored_code) from None

        logger.info(
            "coupon_created",
            extra={"coupon_id": str(coupon.id), "organization_id": str(organization.id)},
        )
        return coupon

    #: What a PATCH may carry. `organization` is absent because moving a coupon
    #: between organizations would move a financial record; `code` is handled
    #: separately below because it is only editable while unused.
    _EDITABLE = (
        "kind",
        "value",
        "max_discount_minor",
        "starts_at",
        "ends_at",
        "max_redemptions",
        "max_per_user",
        "visible_at_checkout",
        "is_active",
    )

    def update_coupon(
        self, *, organization_id, actor_id, coupon_id, **changes
    ) -> tuple[Coupon, int]:
        """Edit the terms.

        THE TERMS STAY EDITABLE AFTER REDEMPTIONS, and that is what
        `CouponRedemption.amount_minor` is for: each booking recorded what it
        actually got off, so changing "20%" to "10%" tomorrow cannot rewrite
        what somebody paid today.

        THE CODE DOES NOT. Once a redemption exists, the code is the thing
        people were given — changing it breaks every printed copy while the
        history keeps pointing at a coupon nobody can now type. Fixing a typo
        before anybody has used it is fine, and that is the only case allowed.
        """
        self._owned_organization(organization_id=organization_id, actor_id=actor_id)
        coupon = self._coupons.get_owned(organization_id=organization_id, coupon_id=coupon_id)
        if coupon is None:
            raise CouponNotFoundError()

        fields = {key: value for key, value in changes.items() if key in self._EDITABLE}

        if "event_id" in changes:
            fields["event_id"] = self._owned_event_id(
                organization_id=organization_id, event_id=changes["event_id"]
            )

        if "code" in changes:
            stored_code = validate_code(changes["code"])
            if stored_code != coupon.code:
                if self._redemptions.exists_for_coupon(coupon.id):
                    raise InvalidCouponError(
                        "This code has already been used, so it can’t be renamed. "
                        "Switch it off and make a new one."
                    )
                if self._coupons.code_exists(
                    organization_id=organization_id, code=stored_code, excluding_id=coupon.id
                ):
                    raise CouponCodeTakenError(stored_code)
                fields["code"] = stored_code

        if not fields:
            return coupon, self._redemptions.count_for_coupon(coupon.id)

        # THE MERGED ROW, not the submitted fields. `kind`, `value` and
        # `max_discount_minor` are independently editable and any of them may be
        # absent from a PATCH — validating only what arrived is how "switch it
        # to fixed" slips a value of 20 through as 20 paise.
        merged = {key: getattr(coupon, key) for key in self._EDITABLE}
        merged.update({key: value for key, value in fields.items() if key in self._EDITABLE})
        validate_terms(
            kind=merged["kind"],
            value=merged["value"],
            max_discount_minor=merged["max_discount_minor"],
            starts_at=merged["starts_at"],
            ends_at=merged["ends_at"],
            max_redemptions=merged["max_redemptions"],
            max_per_user=merged["max_per_user"],
        )

        try:
            self._coupons.update(coupon.id, **fields)
        except IntegrityError:
            raise CouponCodeTakenError(str(fields.get("code", coupon.code))) from None

        updated = self._coupons.get_owned(organization_id=organization_id, coupon_id=coupon.id)
        assert updated is not None  # it was there a statement ago, and nothing deletes here
        return updated, self._redemptions.count_for_coupon(updated.id)

    def delete_coupon(self, *, organization_id, actor_id, coupon_id) -> None:
        """Delete an UNUSED coupon; refuse a used one and name the alternative.

        `CouponRedemption.coupon` is `PROTECT`ed, so the database would refuse
        this anyway — but an `IntegrityError` surfacing as a 500 tells an
        organizer nothing, where "switch it off instead" tells them exactly
        what to do. The same shape as removing a crew member who is on a
        lineup.
        """
        self._owned_organization(organization_id=organization_id, actor_id=actor_id)
        coupon = self._coupons.get_owned(organization_id=organization_id, coupon_id=coupon_id)
        if coupon is None:
            raise CouponNotFoundError()
        if self._redemptions.exists_for_coupon(coupon.id):
            raise InvalidCouponError(
                "This code has been used, so it can’t be deleted. Switch it off instead — "
                "it will stop working and the bookings that used it keep their record."
            )
        self._coupons.delete_owned(organization_id=organization_id, coupon_id=coupon.id)


@dataclass(frozen=True)
class Redemption:
    """What a code was worth on one booking, at the moment it was decided."""

    coupon_id: uuid.UUID
    code: str
    kind: str
    discount_minor: int


class CouponRedemptionService:
    """The checkout's half: redeem a code onto a booking, and give it back.

    ── IT ACTS ON AN EXISTING BOOKING, NOT ON A CREATE ──────────────────────

    A code is typed while somebody is READING the review screen, which is
    after the hold exists — exactly like the donation, and for exactly the
    reason `POST /bookings/{id}/donation` is its own endpoint. Threading it
    through `create_booking` would mean either re-reserving on every code
    somebody tries (a release/reserve cycle over a decision with nothing to do
    with stock — the tier could be gone by the second reserve, so trying a code
    could cost somebody their seats) or making the idempotency key depend on
    the code, which would mint a new key per attempt on the money path.

    So the subtotal is already known and already LOCKED when a coupon is
    priced: it is the sum of the booking's own line items, decided under the
    tier locks when the hold was taken. There is no unlocked price anywhere on
    this path.

    ── LOCK ORDER: BOOKING, THEN COUPON ─────────────────────────────────────

    `redeem` is called by `BookingService.set_coupon`, which already holds the
    booking's row lock. It then takes the coupon's. That is the ONLY place two
    of these locks are held together, so there is exactly one order in the
    system:

        booking → coupon

    Tier locks never meet a coupon lock at all, because nothing on this path
    reserves. And `release_for_booking` takes NO coupon lock — the redemption
    rows ARE the count (see `models.py`), so giving one back is a row delete.
    That is what keeps the cancel and sweeper paths, which hold a booking lock
    and are about to take tier locks, from ever ordering a coupon lock against
    them.
    """

    def __init__(
        self,
        *,
        coupons: CouponRepository | None = None,
        redemptions: CouponRedemptionRepository | None = None,
        events: EventRepository | None = None,
    ) -> None:
        self._coupons = coupons or CouponRepository()
        self._redemptions = redemptions or CouponRedemptionRepository()
        self._events = events or EventRepository()

    # ── the rules ───────────────────────────────────────────────────────────

    def _resolve(self, *, event_id, code: str) -> Coupon:
        """Find the coupon a customer means, or raise the reason it is not it.

        THE EVENT DECIDES THE ORGANIZATION, never the request. A coupon belongs
        to whoever owns the event being booked, so there is no request shape
        that aims one organization's code at another's tickets.
        """
        event = self._events.get_published_by_id(event_id)
        if event is None:
            # The same answer as a bad code, deliberately: somebody who cannot
            # book this event has no coupon problem to solve.
            raise CouponUnknownError()

        coupon = self._coupons.find_live_by_code(organization_id=event.organization_id, code=code)
        if coupon is None:
            raise CouponUnknownError()
        return coupon

    def _check_usable(self, coupon: Coupon, *, event_id, user_id, now, redeemed: int) -> None:
        """Every refusal that does not depend on the order's value.

        `redeemed` is an ARGUMENT rather than something counted here, because
        the count is only a decision when it was taken under the coupon's row
        lock. Making the caller supply it is what stops a display read from
        quietly being treated as one.
        """
        if coupon.event_id is not None and str(coupon.event_id) != str(event_id):
            raise CouponWrongEventError()

        started, ended = window_is_open(coupon, now=now)
        if not started:
            raise CouponNotStartedError()
        if ended:
            raise CouponExpiredError()

        if coupon.max_redemptions is not None and redeemed >= coupon.max_redemptions:
            raise CouponExhaustedError()

        used_by_this_person = self._redemptions.count_for_coupon_and_user(
            coupon_id=coupon.id, user_id=user_id
        )
        if used_by_this_person >= coupon.max_per_user:
            raise CouponAlreadyUsedError()

    @staticmethod
    def _check_leaves_something_to_charge(
        *, subtotal_minor: int, discount_minor: int, donation_minor: int
    ) -> None:
        """Refuse a discount that would make the booking unpayable.

        A provider has a floor (Razorpay's is ₹1), and a booking whose total
        lands under it can be held but never paid for — a checkout whose Pay
        button can only fail. Said at the moment the code is entered, which is
        the last point at which it is still somebody's choice.

        The platform fee is deliberately LEFT OUT of this sum. It only ever
        adds to the total, so ignoring it can refuse a coupon a hair early and
        can never let through a booking the provider would decline — and
        leaving it out keeps the fee's arithmetic in exactly one place
        (`BookingService._platform_fee_for`) rather than two.
        """
        payable = (subtotal_minor - discount_minor) + donation_minor
        if payable < MIN_PAYABLE_TOTAL_MINOR:
            raise CouponLeavesNothingToChargeError()

    @staticmethod
    def _terms_of(coupon: Coupon) -> CouponTerms:
        return CouponTerms(
            kind=coupon.kind,
            value=coupon.value,
            max_discount_minor=coupon.max_discount_minor,
        )

    # ── the decision ────────────────────────────────────────────────────────

    def redeem(
        self,
        *,
        event_id,
        user_id,
        booking_id,
        code: str,
        subtotal_minor: int,
        donation_minor: int = 0,
    ) -> Redemption:
        """Take one redemption of this code for this booking, under its lock.

        MUST run inside the caller's transaction, with the booking row already
        locked — `BookingService.set_coupon` is the only caller, and the
        ordering note in this class's docstring is why.

        The count is read AFTER the lock. Before it, "has this code been used
        up" is a check a concurrent redemption invalidates in the window before
        the insert, which is precisely how a code with fifty uses gets used
        fifty-one times.
        """
        coupon = self._resolve(event_id=event_id, code=code)

        locked = self._coupons.lock_for_update(coupon.id)
        if locked is None or not locked.is_active:
            # Switched off or deleted between the unlocked read and the lock.
            raise CouponUnknownError()

        self._check_usable(
            locked,
            event_id=event_id,
            user_id=user_id,
            now=timezone.now(),
            redeemed=self._redemptions.count_for_coupon(locked.id),
        )

        discount = discount_on(self._terms_of(locked), subtotal_minor=subtotal_minor)
        if discount <= 0:
            # A code worth nothing is refused rather than recorded. It keeps
            # `discount_amount_minor > 0` and "a redemption exists" the SAME
            # question, which every reader of the booking row relies on.
            raise CouponWorthNothingError()
        self._check_leaves_something_to_charge(
            subtotal_minor=subtotal_minor,
            discount_minor=discount,
            donation_minor=donation_minor,
        )

        try:
            self._redemptions.create(
                coupon_id=locked.id,
                booking_id=booking_id,
                user_id=user_id,
                amount_minor=discount,
            )
        except IntegrityError:
            # `CouponRedemption.booking` is a OneToOne. A booking already
            # carrying a code lands here — the caller releases the previous one
            # before redeeming, so this is a concurrent second apply on the
            # same booking rather than a state the UI can reach.
            raise CouponAlreadyAppliedError() from None

        logger.info(
            "coupon_redeemed",
            extra={
                "coupon_id": str(locked.id),
                "booking_id": str(booking_id),
                "amount_minor": discount,
            },
        )
        return Redemption(
            coupon_id=locked.id,
            code=locked.code,
            kind=locked.kind,
            discount_minor=discount,
        )

    def release_for_booking(self, *, booking_id) -> int:
        """Give the redemption back. Idempotent; returns rows removed.

        Called wherever a hold is given up — beside `_release_items` on both
        the cancel and the sweeper paths — and when somebody removes a code
        they had applied. Without it, a code with fifty uses is exhausted by
        fifty people who abandoned their checkout, which is the coupon-shaped
        version of leaking held inventory.

        A REFUND deliberately does not come here. That booking was paid, so the
        code was genuinely used; an organizer who wants the redemption back can
        raise `max_redemptions`. Returning it automatically would let a
        buy-then-refund loop spend one code without limit.

        No coupon lock, because there is nothing to serialise: a row delete
        cannot race a count that is only ever taken under a lock this path
        never holds.
        """
        return self._redemptions.delete_for_booking(booking_id)

    def redemption_for_booking(self, *, booking_id) -> CouponRedemption | None:
        """What a booking's checkout should show under its discount line."""
        return self._redemptions.get_for_booking(booking_id)


__all__ = [
    "MAX_COUPONS_PER_ORGANIZATION",
    "CouponRedemptionService",
    "CouponService",
    "Redemption",
    "validate_code",
    "validate_terms",
]
