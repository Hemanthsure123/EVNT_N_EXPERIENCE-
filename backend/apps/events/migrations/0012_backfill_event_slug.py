"""Backfills `Event.slug` for every row that predates the column.

Three properties matter here, and each is load-bearing:

1. **`atomic = False`.** Each batch commits on its own rather than holding one
   transaction open across the whole table. A single long transaction on the
   platform's hottest table is how a routine migration becomes an outage.
2. **Idempotent and resumable.** It filters on `slug=""`, so re-running only
   fills what is still missing and interrupting it costs nothing.
3. **`bulk_update`, which bypasses `auto_now`.** `updated_at` must NOT move:
   it becomes the sitemap's `lastModified`, and a backfill that stamps every
   event with the same date tells Google the entire catalogue changed at once.

Reversing is a no-op. Clearing the column back out would be destructive for no
benefit — a stale slug is harmless, because the UUID in the URL is what
resolves the event.

`event_slug` is imported from the live module rather than copied. That is safe
here, unlike the CMS seed migration's frozen defaults, because it is a PURE
FUNCTION of a title with no model or settings dependency: replaying this
migration re-derives the same text from the same titles. If the slug rules ever
change, old rows simply keep old slugs until their titles are edited — which is
exactly what happens in production anyway, and both URLs resolve regardless.
"""

from django.db import migrations

BATCH_SIZE = 500
CHUNK_SIZE = 1000


def backfill(apps, schema_editor):
    from apps.events.slugs import event_slug

    Event = apps.get_model("events", "Event")

    pending = []
    for event in Event.objects.filter(slug="").only("id", "title").iterator(chunk_size=CHUNK_SIZE):
        slug = event_slug(event.title)
        if not slug:
            # A title with no ASCII to slug. Leaving it blank is the correct
            # answer, not a failure — the event keeps serving /events/{id}.
            continue
        event.slug = slug
        pending.append(event)
        if len(pending) >= BATCH_SIZE:
            Event.objects.bulk_update(pending, ["slug"], batch_size=BATCH_SIZE)
            pending.clear()

    if pending:
        Event.objects.bulk_update(pending, ["slug"], batch_size=BATCH_SIZE)


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("events", "0011_event_slug"),
    ]

    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
