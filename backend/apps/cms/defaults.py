"""The copy a homepage starts with.

── WHY THIS MODULE EXISTS ────────────────────────────────────────────────

These values used to live in exactly one place: the data migration
`0002_seed_defaults`. That made them a one-time event rather than a
guarantee, and left a failure mode with no error attached to it.

`HomepageRepository.get_or_create_singleton()` is on the READ path — the
homepage lazily creates its own row if none exists. Every hero field is
`blank=True, default=""`, so a row created that way is EMPTY, and the
migration cannot repair it: it is deliberately non-destructive
(`if created:`), because re-applying it must never overwrite an operator's
edits.

So a platform whose singleton row was created before the migration ran, or
deleted afterwards, serves a **blank hero forever** — no exception, no log
line, nothing failing a health check. Just an empty front page.

Applying these at the point of creation closes that: however the row comes
to exist — migration, lazy first read, or an operator recreating it — it
starts with real, editable copy.

── WHY THE MIGRATION STILL HAS ITS OWN COPY ──────────────────────────────

`0002_seed_defaults` deliberately does NOT import this module, and the
duplication is intentional. A migration is a historical record: replaying it
on a fresh database must produce what it produced originally. If it imported
these constants, changing the defaults would retroactively change what that
migration did — and Django's own guidance is that migrations must not depend
on application code that moves underneath them.

The migration is frozen history. This module is the live default. When they
differ, this one wins for every row created from now on, which is the
correct precedence.
"""

from __future__ import annotations

from typing import Any

#: Applied by `HomepageRepository.get_or_create_singleton` as `defaults=`, so
#: a lazily created singleton is never blank. Keys are `HomepageContent`
#: field names; anything absent keeps the model's own default.
DEFAULT_HERO: dict[str, Any] = {
    "hero_headline": "Find your next great night out",
    "hero_description": (
        "Concerts, comedy, workshops and festivals happening near you — booked in under a minute."
    ),
    "hero_primary_cta": "Browse events",
    "hero_secondary_cta": "Explore cities",
    "search_placeholder": "Search events, artists, venues or cities…",
    "trust_badges": ["Instant QR tickets", "Refunds to source", "Verified organisers"],
    "ribbon_enabled": False,
    "ribbon_text": "",
    "footer_note": "",
}


def initial_hero() -> dict[str, Any]:
    """A fresh copy per call.

    `trust_badges` is a list, and `get_or_create(defaults=...)` hands whatever
    it is given straight to the model instance. Returning the module-level
    dict would let one request's edit mutate the default for the life of the
    process.
    """
    return {
        key: list(value) if isinstance(value, list) else value
        for key, value in DEFAULT_HERO.items()
    }


#: Cities the homepage promotes out of the box. Names match `Event.city` as
#: organizers type it — a mismatch is a tile leading to an empty page.
DEFAULT_FEATURED_CITIES: list[str] = [
    "Mumbai",
    "Delhi",
    "Bengaluru",
    "Hyderabad",
    "Pune",
    "Chennai",
    "Kolkata",
    "Ahmedabad",
]

#: Suggested searches for the panel's empty state.
#:
#: `label` is what the chip says; `query` is what it searches. They differ on
#: purpose — a chip can read "Comedy nights" while querying the stem that
#: actually matches rows.
DEFAULT_POPULAR_SEARCHES: list[tuple[str, str]] = [
    ("Live music", "concert"),
    ("Comedy nights", "comedy"),
    ("Weekend workshops", "workshop"),
    ("Food festivals", "food festival"),
    ("Tech meetups", "tech"),
    ("Theatre", "theatre"),
]
