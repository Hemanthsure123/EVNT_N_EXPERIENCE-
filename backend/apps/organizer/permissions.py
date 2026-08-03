"""Who may use the organizer dashboard.

`IsAuthenticated` and nothing more, deliberately — and the reason matters.

Authorization here is not a request-level question ("is this caller staff",
which is how `console` works). It is a per-ROW question: which events, bookings
and customers belong to this caller. That answer lives in
`OrganizerRepository.owned_events()`, which every query in the module starts
from, so a caller with no organizations sees empty lists rather than a 403 —
correct, because "you own nothing yet" is a real state a brand-new organizer is
in, not an error.

A `has_object_permission` class would be the wrong tool twice over: there is no
single object to check on a list endpoint, and on the detail endpoints it would
mean fetching the same row twice per request (the same reasoning documented in
`apps/organizations/permissions.py`). The detail views instead ask the
repository `owns_event(...)` and raise `NotFoundError` — **not**
`PermissionDeniedError` — so a probing request cannot tell "this event exists
but is not yours" apart from "no such event".

`IsEventOrganizer` below is kept unused and ready for the `teams` module, where
delegated staff will need an object-level check that this ownership model does
not express.
"""

from __future__ import annotations

from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.request import Request
from rest_framework.views import APIView


class IsOrganizer(IsAuthenticated):
    """Any authenticated user. Ownership scoping does the real work."""


class IsEventOrganizer(BasePermission):
    """Object-level owner check. UNUSED — see the module docstring.

    Kept because `teams` will need exactly this seam once an organization can
    have members who are not its owner.
    """

    def has_object_permission(self, request: Request, view: APIView, obj: object) -> bool:
        organization = getattr(obj, "organization", None)
        owner_id = getattr(organization, "owner_id", None)
        return bool(owner_id and owner_id == request.user.id)
