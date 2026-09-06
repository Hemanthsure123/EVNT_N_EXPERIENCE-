"""DRF permission classes for coupons — and why the file has none that are used.

Ownership on every organizer endpoint here is proven INSIDE `CouponService`, by
scoping each query to the organization rather than fetching a row and then
comparing. A DRF `has_object_permission` would need the view to `get_object()`
first, which means loading the same row twice per request — the reason
`organizations/permissions.py` says the same thing about `IsOrganizationOwner`.

The file exists because every module in this codebase has one, and because the
seam matters: when `teams` arrives and an organizer can delegate promotions to
a colleague, the check stops being "is this the owner" and becomes a role
lookup. That belongs here, not scattered through the service.
"""

from __future__ import annotations
