"""Third-party accounts a user has connected, and what we put in them.

Two tables, and the split between them is the important part:

`GoogleConnection` is the GRANT — one per user, holding the tokens and the
scopes Google actually issued. `CalendarEventLink` is what we DID with that
grant — one row per (booking, calendar entry), so an event whose time changes
can find the entries to update and a cancellation can find the ones to
delete.

Without the second table the platform could create calendar entries and
never touch them again, which is worse than not creating them: a stale
entry tells somebody to turn up to an event that moved.
"""

from __future__ import annotations

import uuid

from django.db import models
from django.utils import timezone


class ConnectionStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    #: The grant is gone — revoked in the user's Google account, expired
    #: after six months idle, or the password changed. Distinct from DELETED
    #: because the row is kept so the UI can say "reconnect" rather than
    #: silently reverting to "connect", which looks like the connection never
    #: happened and invites a support ticket.
    NEEDS_RECONNECT = "needs_reconnect", "Needs reconnect"


class GoogleConnection(models.Model):
    """One user's Google grant.

    ── ONE PER USER, ENFORCED BY THE SCHEMA ─────────────────────────────

    `OneToOneField`. Reconnecting UPDATES this row rather than adding a
    second, which is what makes "handle duplicate connections" a database
    guarantee instead of a code path somebody has to remember. A user with
    two Google accounts connects whichever one they want their tickets in;
    supporting both simultaneously would mean asking, on every booking,
    which calendar — a question nobody wants at checkout.

    ── TOKENS ARE ENCRYPTED, NOT HASHED ─────────────────────────────────

    They have to be replayable, so hashing is not an option. `core.encryption`
    (Fernet, key derived from SECRET_KEY) makes a database dump useless on
    its own. The refresh token is the one that matters: it does not expire,
    and it mints access tokens on demand.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        "accounts.User", on_delete=models.CASCADE, related_name="google_connection"
    )

    #: Which Google account this is, so a person can tell their work calendar
    #: from their personal one before pressing Disconnect.
    account_email = models.EmailField(blank=True, default="")

    #: Fernet ciphertext. Never logged, never serialised, never returned by an
    #: endpoint — see schemas.py, which exposes neither.
    access_token_encrypted = models.TextField(blank=True, default="")
    refresh_token_encrypted = models.TextField(blank=True, default="")
    access_token_expires_at = models.DateTimeField(null=True, blank=True)

    #: What Google ACTUALLY granted, which can be less than what we asked for:
    #: the consent screen lets a user untick individual scopes. Stored so the
    #: platform can refuse a calendar write up front instead of discovering it
    #: as a 403 halfway through a booking confirmation.
    granted_scopes = models.JSONField(default=list, blank=True)

    #: "primary" is Google's alias for the user's default calendar. Stored
    #: rather than assumed so a future "write to a specific calendar" setting
    #: needs no migration.
    calendar_id = models.CharField(max_length=255, default="primary")

    status = models.CharField(
        max_length=20, choices=ConnectionStatus.choices, default=ConnectionStatus.ACTIVE
    )
    #: Why the connection broke, in the user's words. Shown on the reconnect
    #: prompt — "you revoked access in your Google account" is actionable,
    #: "something went wrong" is not.
    status_detail = models.CharField(max_length=255, blank=True, default="")

    connected_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "integrations_google_connection"
        indexes = [
            # The sweep query: active connections whose access token has
            # expired. Not used on the hot path (refresh happens lazily on
            # write), but it is what an ops query would run.
            models.Index(fields=["status", "access_token_expires_at"], name="gconn_status_exp_idx"),
        ]

    def __str__(self) -> str:
        return f"google:{self.user_id} ({self.account_email or 'unknown'})"

    @property
    def is_active(self) -> bool:
        return self.status == ConnectionStatus.ACTIVE

    def has_scope(self, scope: str) -> bool:
        return scope in (self.granted_scopes or [])

    @property
    def access_token_is_fresh(self) -> bool:
        if not self.access_token_expires_at:
            return False
        return self.access_token_expires_at > timezone.now()


class CalendarEventLink(models.Model):
    """One calendar entry this platform created, and what it was for.

    Keyed on the BOOKING rather than the event: two people attending the same
    event each get their own entry, and one person booking twice should not
    get two identical entries in the same calendar.

    ── `on_delete=CASCADE` ON THE CONNECTION, `PROTECT` ON NOTHING ──────

    Disconnecting removes these rows because the tokens to manage those
    entries are gone — keeping them would be a list of calendar entries the
    platform can no longer touch. The entries themselves stay in the user's
    calendar, which is correct: they are the user's data, and silently
    deleting somebody's diary on disconnect would be worse than leaving it.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    connection = models.ForeignKey(
        GoogleConnection, on_delete=models.CASCADE, related_name="calendar_links"
    )
    booking = models.ForeignKey(
        "booking.Booking", on_delete=models.CASCADE, related_name="calendar_links"
    )
    #: Denormalised so an event-wide update (time or venue changed) finds
    #: every affected entry in one indexed query rather than joining through
    #: bookings for every attendee.
    event = models.ForeignKey(
        "events.Event", on_delete=models.CASCADE, related_name="calendar_links"
    )

    google_event_id = models.CharField(max_length=255)
    calendar_id = models.CharField(max_length=255, default="primary")
    html_link = models.URLField(blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    #: Set when the platform deleted the entry (event cancelled). The row is
    #: kept as an audit trail rather than deleted, so "why did this vanish
    #: from my calendar" has an answer.
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "integrations_calendar_event_link"
        constraints = [
            # One entry per booking per connection. This is what makes a
            # retried sync update rather than duplicate — the DB decides, not
            # a check-then-insert that two concurrent workers both pass.
            models.UniqueConstraint(
                fields=["connection", "booking"], name="uniq_calendar_link_per_booking"
            )
        ]
        indexes = [
            # The event-changed fan-out: every live link for one event.
            models.Index(fields=["event", "deleted_at"], name="clink_event_deleted_idx"),
        ]

    def __str__(self) -> str:
        return f"gcal:{self.google_event_id} (booking {self.booking_id})"
