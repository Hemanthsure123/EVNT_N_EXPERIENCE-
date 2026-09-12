"""Issue, consume and sweep short-lived single-use server-side state.

The store behind an OAuth `state` and the one-time handoff code that carries a
session from a browser redirect into the SPA. See `core.models.EphemeralToken`
for why this is a table and not a cache entry — the short version is that a
degraded cache is survivable everywhere else on this platform and was silently
fatal here.

Module-level functions over the model directly, matching `core.outbox`: `core`
is the shared kernel rather than a business module, so it does not carry the
`repositories.py` / `services.py` shape the apps under `apps/` do.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from django.db import transaction
from django.utils import timezone

from core.models import EphemeralToken

logger = logging.getLogger(__name__)

#: Namespaces. A constant rather than a hand-typed literal at each call site,
#: for the same reason `core.events` holds the event-type strings: a typo in
#: one of a matched pair of literals is a flow that issues into one keyspace
#: and reads from another, and it fails as "expired", which is the single most
#: misleading thing it could say.
SIGN_IN_STATE = "oauth:signin:state"
SIGN_IN_HANDOFF = "oauth:signin:handoff"
CALENDAR_STATE = "oauth:calendar:state"


def issue(*, purpose: str, token: str, payload: dict[str, Any], ttl_seconds: int) -> None:
    """Record a token that `consume` will hand back exactly once.

    A collision on `(purpose, token)` means the caller generated a value that
    already exists. With `secrets.token_urlsafe(32)` that is not a real event —
    it is 256 bits — so it is raised rather than swallowed: quietly overwriting
    would destroy a live flow belonging to somebody else.
    """
    EphemeralToken.objects.create(
        purpose=purpose,
        token=token,
        payload=payload,
        expires_at=timezone.now() + timedelta(seconds=ttl_seconds),
    )


def consume(*, purpose: str, token: str) -> dict[str, Any] | None:
    """Read a token's payload and destroy it. `None` if it is absent or spent.

    ── SINGLE USE IS ENFORCED BY THE LOCK, NOT BY THE CALLER ─────────────

    The row is selected FOR UPDATE and deleted inside one transaction, so two
    callbacks arriving together serialise and exactly one gets the payload.
    A read-then-delete without the lock is a race whose losing branch is "two
    sessions minted from one authorization code".

    An EXPIRED row is treated as absent and deleted on the way past — the
    sweeper is a backstop for tokens nobody ever came back for, not the thing
    that makes expiry correct.

    Deliberately returns `None` for every failure rather than raising a reason.
    The caller cannot act differently on "never existed" versus "already used"
    — both mean this browser cannot complete this flow — and a distinction
    published to an unauthenticated endpoint would confirm which random
    strings were once real states.
    """
    with transaction.atomic():
        row = (
            EphemeralToken.objects.select_for_update().filter(purpose=purpose, token=token).first()
        )
        if row is None:
            return None
        payload = dict(row.payload or {})
        expired = row.expires_at <= timezone.now()
        row.delete()
        return None if expired else payload


def purge_expired(*, limit: int = 1000) -> int:
    """Delete expired rows. Returns how many went.

    Bounded, so a table that has been left to grow is cleared over several
    ticks instead of in one long-running statement holding locks. Anything
    `consume` reaches first is already gone; this only collects the flows
    nobody ever finished, which is most of them — a user who changes their
    mind on Google's consent screen simply never comes back.
    """
    ids = list(
        EphemeralToken.objects.filter(expires_at__lte=timezone.now()).values_list("id", flat=True)[
            :limit
        ]
    )
    if not ids:
        return 0
    deleted, _ = EphemeralToken.objects.filter(id__in=ids).delete()
    logger.info("ephemeral_tokens_purged", extra={"count": deleted})
    return int(deleted)


__all__ = [
    "CALENDAR_STATE",
    "SIGN_IN_HANDOFF",
    "SIGN_IN_STATE",
    "consume",
    "issue",
    "purge_expired",
]
