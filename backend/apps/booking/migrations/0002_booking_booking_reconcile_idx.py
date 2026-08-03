"""The index `payments.reconcile_pending` needs, added in the same change as
the query — per the performance checklist.

Partial on BOTH halves of that query's WHERE: the terminal statuses, and
"holds a payment order at all". Bookings that never reached the payment step
are most of the table and none of this job's work, so keeping them out of the
index keeps it small enough that a two-minute sweep costs nothing.
"""

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('booking', '0001_initial'),
        ('events', '0005_savedevent_savedevent_saved_event_user_event_uniq'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddIndex(
            model_name='booking',
            index=models.Index(condition=models.Q(('status__in', ('expired', 'cancelled')), models.Q(('payment_order_id', ''), _negated=True)), fields=['hold_expires_at'], name='booking_reconcile_idx'),
        ),
    ]
