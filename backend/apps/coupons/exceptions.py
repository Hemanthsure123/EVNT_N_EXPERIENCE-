"""Coupon-specific domain errors.

── TWO FAMILIES, AND THE SPLIT IS DELIBERATE ────────────────────────────────

**Organizer errors** describe a management action that cannot be taken: the
coupon is not theirs, the code is taken, the terms are contradictory. The id
comes from a URL, so `404` and `409` mean what they always mean.

**Checkout refusals** all subclass `CouponRejectedError` and are all `422`,
including "no such code". These answer a request that names a BOOKING in its
URL, so a `404` would be read by every generic client as "that booking is not
there" rather than "that code is not usable" — the booking is real and the
request was well-formed; one field of it was not acceptable. Which is what 422
means.

── WHAT A REFUSAL IS ALLOWED TO REVEAL ──────────────────────────────────────

Each refusal carries its own `code` so the checkout can put a specific sentence
under the field — "that code ran out" and "that code has expired" send somebody
to two different places, and a single "invalid code" sends them to neither.

The one thing deliberately NOT distinguished is a code that does not exist from
a code the organizer has switched OFF. Both answer `coupon_not_found`. A
deactivated code is one somebody decided should stop working, and confirming it
is real tells a code-guesser they have found a live prefix. Every other reason
concerns a code the customer demonstrably already has, where naming the actual
problem is worth far more than the nothing it conceals.
"""

from __future__ import annotations

from core.errors import ConflictError, InvalidInputError, NotFoundError

__all__ = [
    "CouponAlreadyAppliedError",
    "CouponAlreadyUsedError",
    "CouponCodeTakenError",
    "CouponExhaustedError",
    "CouponExpiredError",
    "CouponLeavesNothingToChargeError",
    "CouponNotFoundError",
    "CouponNotStartedError",
    "CouponRejectedError",
    "CouponUnknownError",
    "CouponWrongEventError",
    "InvalidCouponError",
]


# ── the organizer's management path ─────────────────────────────────────────


class CouponNotFoundError(NotFoundError):
    """No such coupon for this organization.

    Answered identically for "does not exist" and "belongs to somebody else",
    because the service scopes its queries by organization rather than fetching
    then comparing — a row that is not yours is never loaded, so there is
    nothing to leak.
    """

    code = "coupon_not_found"

    def __init__(self, message: str = "Coupon not found.") -> None:
        super().__init__(message)


class CouponCodeTakenError(ConflictError):
    """This organization already has a coupon with this code."""

    code = "coupon_code_taken"

    def __init__(self, code_text: str) -> None:
        super().__init__(f"You already have a coupon called “{code_text}”.")


class InvalidCouponError(InvalidInputError):
    """The submitted terms cannot describe a usable discount.

    One code for every structural problem, with the specific sentence in the
    message: unlike the checkout refusals above, this is read by the person who
    wrote the terms and is displayed beside the form they are looking at.
    """

    code = "invalid_coupon"

    def __init__(self, message: str) -> None:
        super().__init__(message)


# ── the checkout's path ─────────────────────────────────────────────────────


class CouponRejectedError(InvalidInputError):
    """Base for every "this code cannot be used" answer.

    A caller that does not care WHY — the booking API's own error envelope, a
    test asserting a coupon was refused — catches this one and gets them all.
    """

    code = "coupon_rejected"


class CouponUnknownError(CouponRejectedError):
    """No live coupon with this code — or one the organizer switched off."""

    code = "coupon_not_found"

    def __init__(self) -> None:
        super().__init__("That code isn’t valid.")


class CouponWrongEventError(CouponRejectedError):
    """A real code, scoped to a different event.

    Named rather than folded into "not valid", because the customer holds a
    code that genuinely works — telling them it is for another event is the
    difference between using it and giving up on it.
    """

    code = "coupon_wrong_event"

    def __init__(self) -> None:
        super().__init__("That code isn’t valid for this event.")


class CouponNotStartedError(CouponRejectedError):
    """The coupon's window has not opened yet."""

    code = "coupon_not_started"

    def __init__(self) -> None:
        super().__init__("That code isn’t active yet.")


class CouponExpiredError(CouponRejectedError):
    """The coupon's window has closed."""

    code = "coupon_expired"

    def __init__(self) -> None:
        super().__init__("That code has expired.")


class CouponExhaustedError(CouponRejectedError):
    """Every redemption the organizer allowed has been taken."""

    code = "coupon_exhausted"

    def __init__(self) -> None:
        super().__init__("That code has been fully claimed.")


class CouponAlreadyUsedError(CouponRejectedError):
    """This account has already used it as many times as it allows."""

    code = "coupon_already_used"

    def __init__(self) -> None:
        super().__init__("You’ve already used that code.")


class CouponLeavesNothingToChargeError(CouponRejectedError):
    """The discount would take the payable total below what can be charged.

    A payment provider has a floor (Razorpay's is ₹1), so a booking whose total
    lands under it can be created and then never paid for — the customer would
    be held on a checkout whose Pay button can only fail. Refusing at the point
    the code is entered is the only place this can be said while it is still
    somebody's choice.

    Comped tickets are the real answer to "I want this to be free", and they
    are a different feature: they need issuance without a payment at all, which
    is a money path of its own rather than a discount of 100%.
    """

    code = "coupon_leaves_nothing_to_charge"

    def __init__(self) -> None:
        super().__init__("That code covers more than this order — it can’t be used here.")


class CouponAlreadyAppliedError(ConflictError):
    """This booking already carries a code.

    `CouponRedemption.booking` is a OneToOne, so stacking is refused by the
    DATABASE rather than by a check — a product rule made structural, because
    two codes on one order raises an ordering question ("which applies to
    what") that nothing in this module answers.

    A 409 rather than a 422: the request is fine, the booking's state is what
    refuses it. The checkout's own remove-then-apply never reaches this; a
    concurrent second apply does.
    """

    code = "coupon_already_applied"

    def __init__(self) -> None:
        super().__init__("This booking already has a code on it.")
