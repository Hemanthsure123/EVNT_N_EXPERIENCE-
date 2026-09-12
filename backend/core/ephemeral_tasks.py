"""The sweeper for `core.ephemeral`.

A backstop, not the thing that makes expiry correct: `consume` already treats
an expired row as absent and deletes it on the way past. What this collects is
the flows nobody ever came back for — somebody who opened Google's consent
screen and changed their mind — which is most of the rows this table ever
holds, and none of which any request will look at again.

Its own module rather than a `core/tasks.py` entry, because `core.tasks` is the
REGISTRY (`register_task` / `run_task`) and putting a registered task inside it
makes the registry import its own consumers.
"""

from __future__ import annotations

from core import ephemeral
from core.tasks import register_task


@register_task("core.purge_ephemeral_tokens")
def purge_ephemeral_tokens(payload: dict) -> None:
    ephemeral.purge_expired(limit=int(payload.get("limit", 1000)))
