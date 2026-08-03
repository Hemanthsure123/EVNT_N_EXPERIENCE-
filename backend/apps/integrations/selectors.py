"""Read-only queries for third-party connections.

Deliberately thin. The only read this module has is "does this user have a
connection", which is a single indexed lookup by user id — there is nothing
to optimise, nothing to cache (a connection's status changes rarely but
matters immediately when it does), and no list endpoint.

Kept for module-shape uniformity. Caching connection status would be
actively wrong: a revoked grant must surface on the next request, not after
a TTL, or the UI keeps offering "add to calendar" for an account that can no
longer write to one.
"""

from __future__ import annotations
