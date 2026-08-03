"""Who may edit the homepage.

Reads are PUBLIC — the front page is served to anonymous visitors, and the
payload contains nothing but copy an operator wrote to be seen.

Writes are staff-only, enforced here at the request layer rather than in the
service, because there is no row-level ownership question: the homepage belongs
to the platform. Same reasoning as `apps/console/permissions.py`.
"""

from __future__ import annotations

from rest_framework.permissions import IsAdminUser


class IsPlatformAdmin(IsAdminUser):
    """Staff-only. Named for what it means, not how it is implemented."""
