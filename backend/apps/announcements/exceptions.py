"""Announcement-specific domain errors.

The banner half of this module raises nothing of its own — every failure there
is a serializer validation error or a `NotFoundError` from `core.errors`. The
EMAIL half does, because "you may not send this" and "this cannot be found"
are different answers an operator has to act on differently.
"""

from __future__ import annotations

from core.errors import ConflictError, InvalidInputError, NotFoundError

__all__ = [
    "BroadcastNotConfigured",
    "ConflictError",
    "InvalidInputError",
    "NotFoundError",
    "NotSendable",
]


class NotSendable(ConflictError):
    """This announcement cannot be emailed in its current state."""

    code = "announcement_not_sendable"


class BroadcastNotConfigured(ConflictError):
    """Refuse to send rather than send something broken.

    A campaign needs two absolute URLs it cannot invent: the origin its
    tracked links point at, and the origin its unsubscribe page lives on.
    Missing either, the honest options are to send an email whose links are
    dead, or not to send. Sending would ALSO make `click_rate` structurally
    zero — a number that reads as "nobody engaged" when it means "nothing was
    measured", which is exactly the class of wrong figure this module refuses
    to produce for opens.
    """

    code = "broadcast_not_configured"
