"""No models.

`organizer` is a read module — the per-organizer twin of `console`. It owns no
tables and no business rules; it reports on rows the other modules own, and the
one place ownership is decided is `OrganizerRepository.owned_events()`.

Kept as an empty file for module-shape uniformity (CLAUDE.md), the same way
`apps/console/models.py` is.
"""

from __future__ import annotations
