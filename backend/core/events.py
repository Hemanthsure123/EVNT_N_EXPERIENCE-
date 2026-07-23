"""Registry of well-known domain event type strings.

Event payloads are plain dicts (see core/outbox.py) — this module exists
only so event type names are declared once and imported, instead of
re-typed as string literals at every publish/subscribe call site."""

from __future__ import annotations

# apps.accounts
USER_REGISTERED = "accounts.user_registered"
