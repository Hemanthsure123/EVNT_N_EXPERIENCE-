"""Seed the homepage's starting content.

WHY A DATA MIGRATION rather than defaults in the frontend: the goal is that
changing the front page needs no deploy. Copy and categories living in a
TypeScript array are copy an operator cannot edit — so shipping them as SEED
DATA makes the defaults sensible AND editable, and lets the frontend read from
exactly one place.

This runs once. It is deliberately non-destructive: it creates rows only if
none exist, so re-running it (or applying it to a database an operator has
already edited) cannot overwrite their work. The reverse migration is a no-op
for the same reason — un-applying a migration must not delete an operator's
homepage.

The eight categories mirror the browse taxonomy the discovery layer already
uses. `search_term` is what resolves a category to results, because `Event` has
no category column yet (BACKLOG item 2) — when it gains one, this column is the
seam that changes.
"""

from __future__ import annotations

from django.db import migrations

DEFAULT_HERO = {
    "hero_headline": "Find your next great night out",
    "hero_description": (
        "Concerts, comedy, workshops and festivals happening near you — "
        "booked in under a minute."
    ),
    "hero_primary_cta": "Browse events",
    "hero_secondary_cta": "Explore cities",
    "search_placeholder": "Search events, artists, venues or cities…",
    "trust_badges": ["Instant QR tickets", "Refunds to source", "Verified organisers"],
    "ribbon_enabled": False,
    "ribbon_text": "",
    "footer_note": "",
}

CATEGORIES = [
    ("concerts", "Concerts", "Music", "concert"),
    ("comedy", "Comedy", "Mic", "comedy"),
    ("workshops", "Workshops", "Palette", "workshop"),
    ("sports", "Sports", "Trophy", "sports"),
    ("festivals", "Festivals", "Tent", "festival"),
    ("nightlife", "Nightlife", "Disc3", "nightlife"),
    ("food-drink", "Food & Drink", "UtensilsCrossed", "food"),
    ("tech", "Tech", "Cpu", "tech"),
]


def seed(apps, schema_editor):
    HomepageContent = apps.get_model("cms", "HomepageContent")
    Category = apps.get_model("cms", "Category")

    # `get_or_create` on the singleton column, so this is safe on a database
    # where the row was already created lazily by a first homepage read.
    content, created = HomepageContent.objects.get_or_create(singleton=True)
    if created:
        for field, value in DEFAULT_HERO.items():
            setattr(content, field, value)
        content.save()

    # Only seed into an empty taxonomy. An operator who has already curated
    # their own categories must not find eight more appear on deploy.
    if not Category.objects.exists():
        Category.objects.bulk_create(
            [
                Category(
                    slug=slug,
                    label=label,
                    icon=icon,
                    search_term=term,
                    position=index,
                    is_visible=True,
                )
                for index, (slug, label, icon, term) in enumerate(CATEGORIES)
            ]
        )


def unseed(apps, schema_editor):
    """Deliberately a no-op.

    Reversing this migration must not delete a homepage an operator has since
    edited — and there is no way to tell their rows from ours.
    """


class Migration(migrations.Migration):
    dependencies = [("cms", "0001_initial")]

    operations = [migrations.RunPython(seed, unseed)]
