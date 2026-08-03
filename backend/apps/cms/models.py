"""Admin-authored homepage content: copy, curation and categories.

Three aggregates, one capability — "what the platform says on its own front
page". They live together because they are edited together, invalidated
together, and read together by exactly one request (`GET /homepage`).

WHY A SINGLETON ROW rather than a settings table of key/value pairs: the hero
is one coherent piece of copy, and a key/value store makes it impossible to
validate ("headline ≤ 80 chars") or to version. `HomepageContent` carries an
optimistic-lock `version` for the same reason `Event` does — two operators in
the CMS at once must not silently clobber each other.

WHY CURATION IS A TABLE rather than a flag on `Event`: an event belongs to an
organizer, and a merchandising decision belongs to the platform. Putting
`is_featured` on `Event` would mean an organizer's edit endpoint touches a row
that decides homepage placement, which is exactly the authority leak the
moderation gate exists to close.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models

#: Server-side caps, mirrored by the serializers and shown as live counters in
#: the CMS. Values chosen so the hero never wraps past two lines at 360px.
HEADLINE_MAX = 80
DESCRIPTION_MAX = 180
CTA_MAX = 40
RIBBON_MAX = 120


class HomepageContent(models.Model):
    """The one row of homepage copy.

    `singleton` is a constant-valued unique column — the standard way to make
    "there is exactly one of these" a database guarantee rather than a
    convention somebody eventually breaks with a second row.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    singleton = models.BooleanField(default=True, unique=True, editable=False)

    hero_headline = models.CharField(max_length=HEADLINE_MAX, blank=True, default="")
    hero_description = models.CharField(max_length=DESCRIPTION_MAX, blank=True, default="")
    hero_primary_cta = models.CharField(max_length=CTA_MAX, blank=True, default="")
    hero_secondary_cta = models.CharField(max_length=CTA_MAX, blank=True, default="")
    search_placeholder = models.CharField(max_length=CTA_MAX * 2, blank=True, default="")
    ribbon_text = models.CharField(max_length=RIBBON_MAX, blank=True, default="")
    ribbon_enabled = models.BooleanField(default=False)
    #: A list of short strings. JSON because the count is editorial, not
    #: structural — three badges today, two tomorrow, no migration either way.
    trust_badges = models.JSONField(default=list, blank=True)
    footer_note = models.CharField(max_length=RIBBON_MAX, blank=True, default="")

    version = models.PositiveIntegerField(default=1)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "cms_homepage_content"

    def __str__(self) -> str:
        return self.hero_headline or "Homepage content"


class Collection(models.TextChoices):
    FEATURED = "featured", "Featured"
    TRENDING = "trending", "Trending"
    EDITORS_PICK = "editors_pick", "Editor's pick"
    RECOMMENDED = "recommended", "Recommended"
    NEW = "new", "New"


class FeaturedEntry(models.Model):
    """One curated slot: this event, in this collection, at this position.

    SCHEDULING is `starts_at`/`ends_at` rather than a cron job flipping a flag:
    a window is declarative, survives a restart, and lets an operator queue a
    seasonal collection weeks ahead. The read path filters on `now`, so a slot
    appears and disappears with no job needing to have run.

    `city` scopes a slot to one city's landing page; blank means everywhere.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        "events.Event", on_delete=models.CASCADE, related_name="featured_entries"
    )
    collection = models.CharField(max_length=32, choices=Collection.choices)
    position = models.PositiveIntegerField(default=0)
    city = models.CharField(max_length=120, blank=True, default="")
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "cms_featured_entry"
        constraints = [
            # An event cannot occupy the same collection twice — the second
            # would just be a duplicate card on the same rail.
            models.UniqueConstraint(
                fields=["collection", "event"], name="cms_featured_unique_per_collection"
            ),
        ]
        indexes = [
            # The read path's exact query: one collection, in order.
            models.Index(fields=["collection", "position"], name="cms_featured_collection_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.collection}:{self.event_id}"


class Category(models.Model):
    """A browse category, admin-controlled.

    ARCHIVING rather than deleting: a category that has been linked from a
    campaign, an email or a bookmark must keep resolving. `archived_at` hides
    it from navigation while leaving its landing page reachable — the same
    soft-delete discipline `Event` and `Organization` already use.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(max_length=60, unique=True)
    label = models.CharField(max_length=60)
    #: The lucide icon name the frontend renders. A name, not a file: the
    #: icon set is bundled, so an arbitrary URL would be an unvalidated remote
    #: image on the busiest page on the platform.
    icon = models.CharField(max_length=60, blank=True, default="")
    #: The search term pushed at the events index — categories have no column
    #: on `Event` yet (BACKLOG item 2), so this is how one resolves to results.
    search_term = models.CharField(max_length=120, blank=True, default="")
    position = models.PositiveIntegerField(default=0)
    is_visible = models.BooleanField(default=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "cms_category"
        indexes = [
            models.Index(
                fields=["position"],
                name="cms_category_visible_idx",
                condition=models.Q(is_visible=True, archived_at__isnull=True),
            ),
        ]

    def __str__(self) -> str:
        return self.label


class FeaturedCity(models.Model):
    """A city promoted on the homepage.

    ── CURATION, NOT THE CITY LIST ──────────────────────────────────────

    This table is NOT the set of cities the platform supports. `Event.city` is
    a free string, so every city with an event in it is already searchable and
    already has a landing page — that is what "all Indian cities" means and it
    needs no table.

    What an operator actually needs to decide is which handful to SHOW on the
    front page, in what order, this month. That is a merchandising decision
    with maybe eight rows in it, and it is all this holds.

    `name` matches `Event.city` verbatim, because that is what the browse
    query filters on. A mismatch means a tile that leads to an empty page, so
    it is compared case-insensitively at read time rather than trusted.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    #: Must match `Event.city` as organizers type it.
    name = models.CharField(max_length=80, unique=True)
    #: Optional hero image for the tile. A URL rather than an upload: these are
    #: eight rows an operator edits by hand, and a whole upload pipeline for
    #: them would be machinery nobody asked for.
    image_url = models.URLField(blank=True, default="")
    position = models.PositiveIntegerField(default=0)
    is_visible = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "cms_featured_city"
        ordering = ["position", "name"]
        indexes = [
            models.Index(
                fields=["position"],
                condition=models.Q(is_visible=True),
                name="cms_city_visible_pos",
            )
        ]

    def __str__(self) -> str:
        return self.name


class PopularSearch(models.Model):
    """A suggested search, shown in the empty state of the search panel.

    ── WHY THIS IS CONFIGURATION AND NOT ANALYTICS ──────────────────────

    "Popular" here means "what we want to point people at", not "what was
    searched most" — the platform has no search-term log, and inventing a
    number from nothing is precisely what this codebase refuses to do
    elsewhere. An operator picks these.

    When there IS a query log, this table becomes the fallback and the
    seam does not move: the panel already asks for a list of
    `(label, query)` pairs and does not care where they came from.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    #: What the chip says.
    label = models.CharField(max_length=60)
    #: What pressing it searches for. Separate from `label` so a chip can read
    #: "Comedy nights" while querying the term that actually matches rows.
    query = models.CharField(max_length=120)
    position = models.PositiveIntegerField(default=0)
    is_visible = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "cms_popular_search"
        ordering = ["position", "label"]
        constraints = [
            # Two chips with the same label are a curation mistake, not a
            # state the front page should be able to reach.
            models.UniqueConstraint(fields=["label"], name="cms_popular_search_label_uniq"),
        ]
        indexes = [
            models.Index(
                fields=["position"],
                condition=models.Q(is_visible=True),
                name="cms_popular_visible_pos",
            )
        ]

    def __str__(self) -> str:
        return self.label
