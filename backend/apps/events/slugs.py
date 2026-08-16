"""Human-readable URL text for an event.

An event's public URL is `/events/{slug}-{uuid}` — the slug is DECORATION and
the UUID is the identity. That split is the whole design, and everything below
follows from it:

- **No uniqueness constraint, no collision handling, no alias table.** Two
  events called "New Year's Eve Party" both get the slug `new-years-eve-party`
  and stay distinguishable, because the UUID is right there. A bare
  `/events/{slug}` would need a UNIQUE index on the hottest table on the
  platform, a retry loop inside `create_event`'s `UnitOfWork`, a backfill that
  can fail on real duplicate titles, and a slug-history table so a rename does
  not 404 an emailed link.
- **No reserved-word problem.** `GET /events/sitemap` exists; an event titled
  "Sitemap" produces `sitemap-{uuid}`, which cannot shadow it. Under a bare
  slug scheme every future route under `/events/` would be a word organizers
  are silently forbidden from using.
- **Renaming is free.** The slug can be regenerated on every title edit,
  because the old URL still resolves — it carries the same UUID — and merely
  redirects to the new one.

The one cost is 36 characters of URL. That is the entire downside, and it is
the shape Eventbrite, Stack Overflow and Medium all settled on.

This module is deliberately PURE — no models, no ORM, no Django settings — so
it can be imported from a data migration and unit-tested without a database.
"""

from __future__ import annotations

from django.utils.text import slugify

#: Matches `Event.slug`'s column width. Kept below `title`'s 200 so a long
#: title cannot make the path unwieldy, and below `seo_title`'s 70 by only a
#: little — a slug should never out-run the title it came from.
MAX_SLUG_LENGTH = 80


def event_slug(title: str) -> str:
    """ASCII slug for an event title, or `""` when there is nothing to slug.

    An empty result is NOT an error. A Devanagari, Tamil or emoji-only title
    ASCII-slugifies to nothing, and the honest answer is a bare `/events/{uuid}`
    URL — exactly what the platform served before slugs existed.

    `allow_unicode=True` was rejected: a percent-encoded path renders as
    mojibake in the WhatsApp and Instagram share sheets that are this
    platform's actual distribution channel, which is worse than no slug.
    """
    slug = slugify(title, allow_unicode=False)
    if len(slug) <= MAX_SLUG_LENGTH:
        return slug

    # Cut at a word boundary rather than mid-word, then strip any trailing
    # separator. A slug ending in "-" would produce "...--{uuid}", which reads
    # as a typo and breaks the round-trip test's exact-match comparison.
    cut = slug[:MAX_SLUG_LENGTH]
    if "-" in cut:
        cut = cut.rsplit("-", 1)[0]
    return cut.strip("-")
