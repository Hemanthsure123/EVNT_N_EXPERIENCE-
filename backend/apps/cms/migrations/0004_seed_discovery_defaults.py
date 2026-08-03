"""Seed the featured cities and popular searches a fresh install ships with.

Same discipline as `0002_seed_defaults`: non-destructive (creates only when
the table is empty, so re-applying cannot overwrite an operator's curation)
and carrying its OWN copy of the data rather than importing
`apps/cms/defaults.py`.

The duplication is deliberate. A migration is a historical record — replaying
it must produce what it produced originally — so it must not depend on
constants that move underneath it. `defaults.py` is the live value for
anything created from now on; this is what the platform shipped with.
"""

from __future__ import annotations

from django.db import migrations

CITIES = [
    "Mumbai",
    "Delhi",
    "Bengaluru",
    "Hyderabad",
    "Pune",
    "Chennai",
    "Kolkata",
    "Ahmedabad",
]

SEARCHES = [
    ("Live music", "concert"),
    ("Comedy nights", "comedy"),
    ("Weekend workshops", "workshop"),
    ("Food festivals", "food festival"),
    ("Tech meetups", "tech"),
    ("Theatre", "theatre"),
]


def seed(apps, schema_editor):
    FeaturedCity = apps.get_model("cms", "FeaturedCity")
    PopularSearch = apps.get_model("cms", "PopularSearch")

    # Only on an EMPTY table. An operator who has already curated these must
    # not have their list appended to by a redeploy.
    if not FeaturedCity.objects.exists():
        FeaturedCity.objects.bulk_create(
            FeaturedCity(name=name, position=index) for index, name in enumerate(CITIES)
        )
    if not PopularSearch.objects.exists():
        PopularSearch.objects.bulk_create(
            PopularSearch(label=label, query=query, position=index)
            for index, (label, query) in enumerate(SEARCHES)
        )


def unseed(apps, schema_editor):
    """A no-op, like 0002's.

    Un-applying a migration must not delete an operator's curation — by the
    time anyone reverses this, the rows may have been edited beyond
    recognition and there is no way to tell which were ours.
    """


class Migration(migrations.Migration):
    dependencies = [("cms", "0003_featuredcity_popularsearch_and_more")]
    operations = [migrations.RunPython(seed, unseed)]
