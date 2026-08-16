"""Adds `Event.slug` — schema only, no data.

Separate from the backfill (0012) on purpose: on Postgres 11+ adding a column
with a non-volatile default is a CATALOGUE-ONLY change — no table rewrite, no
long ACCESS EXCLUSIVE lock — so this is safe to apply to a live `events_event`
under load. The backfill, which does touch every row, is its own non-atomic
migration that can be interrupted and resumed.

Nothing reads the column after this migration. An unfilled row (`slug=""`)
renders as `/events/{id}`, which is the URL the platform already served, so
there is no window in which the system is half-migrated and broken.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("events", "0010_event_rating_count_event_rating_sum"),
    ]

    operations = [
        migrations.AddField(
            model_name="event",
            name="slug",
            field=models.CharField(blank=True, default="", max_length=80),
        ),
    ]
