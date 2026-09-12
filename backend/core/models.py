"""Shared-kernel tables: the transactional outbox, the audit log, and the
short-lived server-side state that must outlive a cache outage.

Both are written to from inside the same UnitOfWork transaction as the
business change they describe, which is the whole point of the outbox
pattern — an event can never be "lost" because the write that created it
and the write that recorded the event either both commit or both roll back.
"""

from __future__ import annotations

import uuid

from django.db import models


class OutboxEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event_type = models.CharField(max_length=255, db_index=True)
    aggregate_id = models.CharField(max_length=255, blank=True, db_index=True)
    payload = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    published_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        db_table = "core_outbox_event"
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.event_type} ({self.id})"


class AuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor_id = models.CharField(max_length=255, blank=True, db_index=True)
    action = models.CharField(max_length=255, db_index=True)
    target_type = models.CharField(max_length=100, blank=True)
    target_id = models.CharField(max_length=255, blank=True, db_index=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "core_audit_log"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.action} by {self.actor_id or 'system'}"


class EphemeralToken(models.Model):
    """Short-lived, single-use, server-side state — in POSTGRES, not the cache.

    ── THE OUTAGE THIS EXISTS TO SURVIVE ─────────────────────────────────

    Google sign-in was completely broken in production and the platform
    reported itself healthy throughout. `/health/` said exactly this:

        {"status": "ok", "checks": {"database": true, "cache": false},
         "degraded": ["cache"]}

    That answer is correct and the readiness rule behind it is correct —
    CLAUDE.md's "the database decides readiness, the cache never does",
    because every READ path is cache-aside and falls through to a query the
    database can still answer. An instance with no cache is slower and
    completely correct.

    Two paths were not reads. `GoogleSignInService` and the Calendar
    `CalendarService` each stored their OAuth `state` — which carries the
    PKCE verifier, and IS the proof that the browser coming back from Google
    is the one that left — in `CachePort`, with no fallback. With the cache
    down, `set` was a no-op and `get` returned nothing, so every single
    sign-in failed at the callback with `oauth_state_invalid`, rendered to
    the user as "That sign-in link expired or was already used." Measured on
    the deployed site: a state issued seconds earlier was already invalid.

    Nothing failed. Nothing was logged. The health endpoint was green,
    because by its own rule a degraded cache is survivable — and it is,
    everywhere except the two places that had quietly made it load-bearing.

    **The rule this establishes: if losing it breaks a user-visible flow, it
    is not a cache.** A short TTL and a single use make something look
    cache-shaped; what decides the question is whether the flow can still
    complete when the value is gone. For an OAuth state it cannot — there is
    no way to re-derive it and no way to proceed without it.

    ── WHY ONE GENERIC TABLE RATHER THAN ONE PER FLOW ────────────────────

    `purpose` namespaces the token, so sign-in states, sign-in handoffs and
    calendar states share a table without sharing a keyspace. Two callers
    needed the identical mechanism on the same day; a third will be a new
    `purpose` constant rather than a migration. This sits in `core` for the
    same reason `OutboxEvent` does — it is shared-kernel infrastructure, not
    a business module's data.

    ── IT IS DELETED ON USE, NOT MARKED ──────────────────────────────────

    Single use is enforced by the row ceasing to exist, under a row lock, so
    two concurrent callbacks cannot both succeed. A `consumed_at` column
    would make the same guarantee available only to code that remembers to
    check it, and would keep the PKCE verifier readable after the flow is
    over. Expired rows that nobody ever came back for are swept by
    `core.purge_ephemeral_tokens`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    #: Namespace. See `core.ephemeral` for the constants.
    purpose = models.CharField(max_length=40)
    #: The opaque value handed to the browser. Random, never derived.
    token = models.CharField(max_length=128)
    #: Whatever the flow needs on the way back — the PKCE verifier, the user
    #: id, the `next` path. Never anything the holder of the token should not
    #: be able to obtain by completing the flow.
    payload = models.JSONField(default=dict)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "core_ephemeral_token"
        # Plain assignment, NOT `ClassVar[...]` — annotating a model `Meta`
        # attribute makes django-stubs' plugin degrade quietly and lose
        # `Model.objects` across the whole project. CLAUDE.md records this
        # trap twice; it is not a style preference.
        constraints = [
            # The lookup IS `(purpose, token)`, and uniqueness on the pair is
            # what makes a replayed callback find nothing rather than one of
            # two rows. Unique on `token` alone would let one flow's collision
            # refuse another flow's perfectly good token.
            models.UniqueConstraint(fields=["purpose", "token"], name="ephemeral_token_unique"),
        ]
        indexes = [
            # The sweeper's only query. Without it, purging scans the table.
            models.Index(fields=["expires_at"], name="ephemeral_token_expiry"),
        ]

    def __str__(self) -> str:
        return f"{self.purpose} ({self.id})"
