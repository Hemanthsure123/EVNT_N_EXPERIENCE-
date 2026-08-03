"""No write-side service.

Every Maps operation is a READ of somebody else's data; nothing in this
module changes platform state. The cache-aside read path is
`selectors.MapsReadService`, which is where the CQRS-lite split puts it.

The one place Maps data becomes platform state is an organizer choosing a
venue — and that write belongs to `apps/events` (`Event.place_id`,
`latitude`, `longitude`), not here, because it is an event edit that happens
to have been informed by Places.
"""

from __future__ import annotations
