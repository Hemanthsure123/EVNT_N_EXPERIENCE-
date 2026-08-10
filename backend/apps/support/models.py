"""Support queries: a customer asking a human for help, and the reply thread.

── WHY THIS MODULE EXISTS ────────────────────────────────────────────────

The product told people to email us. Every other flow on this platform is a
row somebody can look at — a booking, a refund request, a payout attempt — and
support was an inbox: no queue, no status, no way for a customer to see whether
anyone had read it, and no way for an operator to know what was outstanding.
"Can't scan it?" on a ticket, at a gate, went to a `mailto:`.

── WHO SEES IT, AND WHY THAT IS A COLUMN ─────────────────────────────────

A query is addressed to an AUDIENCE (`organizer`, `platform`, or `both`),
because the two answer different questions. "The gate would not scan my code"
is the organiser's — they are standing at that gate. "I was charged twice" is
ours; the organiser cannot see a payment record and must not be handed one.

It is set by the CUSTOMER rather than inferred from the text, because guessing
wrong routes a refund dispute to a venue and a door problem to a support desk
in another city. `both` exists for the case somebody genuinely does not know,
and is what the ticket-scanning entry point uses.

── IT IS SCOPED BY WHAT IT IS ABOUT ──────────────────────────────────────

`event` and `ticket` are optional FKs. When a query comes from a ticket the
organiser sees it in their own queue WITHOUT any lookup, and the reply lands
against something concrete. A query with neither is platform-only by
definition: there is no organiser to route it to.

Both are `SET_NULL`: an event can be archived and a ticket refunded while a
conversation about them is still open, and losing the thread because its
subject was tidied away is the opposite of what a support record is for.

── THE THREAD IS APPEND-ONLY ─────────────────────────────────────────────

`SupportReply` rows are never edited or deleted. A support history that can be
rewritten is not a history, and this one is the record both sides would point
at if a chargeback followed.

── STATUS IS NOT A LABEL ─────────────────────────────────────────────────

`open` -> `answered` -> `resolved`, plus `closed` for one nobody needs any
more. `answered` is set by the system when a staff or organiser reply lands,
never by hand: the point of the state is "somebody has replied", and a value an
operator can set without replying is a value that will be set without replying.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models

SUBJECT_MAX = 140
BODY_MAX = 4000


class SupportAudience(models.TextChoices):
    ORGANIZER = "organizer", "The event organizer"
    PLATFORM = "platform", "Curatix support"
    BOTH = "both", "Both"


class SupportStatus(models.TextChoices):
    OPEN = "open", "Open"
    ANSWERED = "answered", "Answered"
    RESOLVED = "resolved", "Resolved"
    CLOSED = "closed", "Closed"


class SupportQuery(models.Model):
    """One question from one person, and the thread that answers it."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="support_queries",
    )

    audience = models.CharField(
        max_length=16, choices=SupportAudience.choices, default=SupportAudience.PLATFORM
    )
    status = models.CharField(
        max_length=16, choices=SupportStatus.choices, default=SupportStatus.OPEN
    )

    subject = models.CharField(max_length=SUBJECT_MAX)
    body = models.TextField(max_length=BODY_MAX)

    # What it is about. Optional, and `SET_NULL` — see the module docstring.
    event = models.ForeignKey(
        "events.Event",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="support_queries",
    )
    ticket = models.ForeignKey(
        "booking.Ticket",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="support_queries",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "support_query"
        ordering = ["-created_at", "-id"]
        indexes = [
            # The customer's own thread list.
            models.Index(fields=["user", "-created_at"], name="support_user_recent_idx"),
            # The two queues, both of which filter on status and sort newest
            # first. One compound index serves the ordering and the filter.
            models.Index(fields=["status", "-created_at"], name="support_status_recent_idx"),
            # The organiser queue joins through the event, so this is the
            # column it actually filters on.
            models.Index(fields=["event", "-created_at"], name="support_event_recent_idx"),
        ]

    def __str__(self) -> str:  # pragma: no cover - admin/debug convenience
        return f"SupportQuery {self.id} ({self.status})"


class SupportReply(models.Model):
    """A message on a query. Append-only — see the module docstring."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    query = models.ForeignKey(SupportQuery, on_delete=models.CASCADE, related_name="replies")

    # PROTECT: the author of a support reply is part of the record. A deleted
    # account must not silently orphan what it said.
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="support_replies",
    )
    #: True when the author answered AS the organizer or the platform rather
    #: than as the person who asked. Stored rather than derived from
    #: `author == query.user`, because an operator may also be a customer, and
    #: which hat they wore is a fact about the message.
    is_staff_reply = models.BooleanField(default=False)

    body = models.TextField(max_length=BODY_MAX)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "support_reply"
        # Oldest first: a thread is read top to bottom.
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["query", "created_at"], name="support_reply_thread_idx")]

    def __str__(self) -> str:  # pragma: no cover - admin/debug convenience
        return f"SupportReply {self.id}"
