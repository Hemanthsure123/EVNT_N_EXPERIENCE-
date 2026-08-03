"""Who may use the operator console.

`IsAdminUser` is DRF's `is_staff` check, which is exactly the flag
`AdminSettlementReleaseView` already guards the one pre-existing admin
endpoint with. Reusing it keeps "platform operator" a single concept rather
than inventing a second, parallel notion of admin.

Unlike every other module here, these permissions are NOT enforced in a
service: there is no row to load and no ownership to compare. The question
is only "is this caller staff", which is request-level, so DRF's own
permission layer is the right place for it — see the note in
`apps/organizations/permissions.py` for why object-level checks go the other
way.
"""

from __future__ import annotations

from rest_framework.permissions import IsAdminUser


class IsPlatformAdmin(IsAdminUser):
    """Staff-only. Named for what it means here, not for how it's implemented."""
