"""No models, deliberately.

Google is the source of truth for place data, and its terms permit caching
CONTENT for at most 30 days — a table would become a stale copy of somebody
else's data that outlives its licence. What this platform is allowed to
store indefinitely, and does, is the **place id**, which lives on
`Event.place_id` next to the coordinates it resolves to.

Everything else is cache-aside through `CachePort` (see `selectors.py`),
which expires on its own.
"""

from __future__ import annotations
