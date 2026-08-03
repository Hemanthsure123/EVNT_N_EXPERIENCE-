"""Who each ticket admits, when it isn't the buyer.

Two columns on the ticket rather than an assignment table: one ticket admits
exactly one person, and a table would permit two rows for one seat.

**No index, deliberately.** Nothing queries by attendee — every read of these
columns arrives via the booking (`ticket_booking_created_idx`) or the ticket's
own primary key. An index here would be speculative, which the performance
checklist rules out; add one in the same change as the first query that filters
on an attendee.

Both default to '' and are backfilled as '' on every existing ticket, which is
the correct historical answer: the buyer was going.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('booking', '0002_booking_booking_reconcile_idx'),
    ]

    operations = [
        migrations.AddField(
            model_name='ticket',
            name='attendee_email',
            field=models.EmailField(blank=True, default='', max_length=254),
        ),
        migrations.AddField(
            model_name='ticket',
            name='attendee_name',
            field=models.CharField(blank=True, default='', max_length=120),
        ),
    ]
