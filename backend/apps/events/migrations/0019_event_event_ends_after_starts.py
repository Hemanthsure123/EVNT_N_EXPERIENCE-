"""The event window becomes a database invariant.

Until now nothing at any layer stopped `ends_at` being written before
`starts_at`. The serializer compared the two only when a payload carried
BOTH, so a PATCH sending just `ends_at` — which the organizer wizard does
whenever somebody edits only the end time — was never checked against the
stored start at all.

That is not a cosmetic date on a page. `ends_at` drives the check-in grace
window, the "event has finished" gate `settlements` will not release a payout
before, and the payout date itself. An inverted window is a settlement that
becomes releasable before its event has happened.

The application refuses it in two places now (the serializer's cheap
both-fields pre-check and `_validate_schedule_against_stored`, which judges a
PATCH against the merged row). This constraint is the backstop that makes it
impossible even if a future write path forgets — exactly the role
`ticket_type_no_oversell` plays for inventory.

── WHY THERE IS A REPAIR STEP IN FRONT OF IT ──────────────────────────────

`AddConstraint` VALIDATES existing rows, so a single legacy row violating it
fails the whole migration. Migrations here are run by hand through
`manage.py migrate_safe` with a printed plan and a confirmation, so that
failure would be visible rather than silent — but it would still be a deploy
stopped by data nobody can inspect from the error message.

Inverted rows are unlikely (create has always checked when both fields were
present) and are meaningless where they exist, so they are repaired to NULL:
an open-ended event, which is a state the column is nullable for and which
every consumer already handles. Nulling rather than guessing a corrected end
time, because there is no honest way to infer what the organizer meant, and
inventing one would put a fabricated finish time on a settlement gate.

The repair logs what it touched. It is irreversible in the sense that the
original (meaningless) value is not recoverable — hence a no-op reverse
rather than a pretence.
"""

from django.conf import settings
from django.db import migrations, models


def _null_out_inverted_windows(apps, schema_editor):
    Event = apps.get_model("events", "Event")
    inverted = Event.objects.filter(
        ends_at__isnull=False, ends_at__lte=models.F("starts_at")
    )
    # Evaluated before the UPDATE, so the log reports what was actually there.
    affected = list(inverted.values_list("id", flat=True))
    if not affected:
        return
    inverted.update(ends_at=None)
    print(
        f"  events.0019: cleared {len(affected)} inverted ends_at value(s) "
        f"before applying event_ends_after_starts: {', '.join(str(i) for i in affected)}"
    )


def _noop_reverse(apps, schema_editor):
    """Nothing to restore: the values removed were not recoverable data."""


class Migration(migrations.Migration):
    dependencies = [
        ("events", "0018_eventwaitlist"),
        ("organizations", "0002_organizationfollow_and_more"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RunPython(_null_out_inverted_windows, _noop_reverse),
        migrations.AddConstraint(
            model_name="event",
            constraint=models.CheckConstraint(
                condition=models.Q(("ends_at__isnull", True), ("ends_at__gt", models.F("starts_at")), _connector="OR"),
                name="event_ends_after_starts",
            ),
        ),
    ]
