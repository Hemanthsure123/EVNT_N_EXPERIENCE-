"""Who may use the marketplace.

Three different questions, answered in three different places:

- **Browsing** is public. Anyone can see live performers, signed in or not —
  the whole point of a marketplace is that people find it before they register.
- **Owning a profile** is a per-ROW question ("is this act mine"), answered in
  the service by comparing the organisation's owner, exactly as `events` does.
  A caller who owns nothing gets empty lists rather than a 403, because "you
  have no acts yet" is a real state, not an error.
- **Moderating** is a request-level question ("is this caller staff"), and the
  console's own `IsPlatformAdmin` already answers it.

The detail writes raise `NotFoundError` rather than `PermissionDeniedError` for
a profile the caller does not own — a 403 would confirm the profile exists to
anyone guessing ids.
"""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated


class IsMarketplaceUser(IsAuthenticated):
    """Any authenticated user. Ownership scoping does the real work."""
