"""Catch-up migration for the `payout_released` notification type.

`settlements` added that type to `NotificationType` without regenerating the
migration, so `makemigrations --check` (a CI step) had been failing on a module
nobody was touching. Choices live only in Django's own validation, so this
`AlterField` is a no-op against Postgres — it exists purely to make the
migration state match the models again.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notifications', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='notificationlog',
            name='type',
            field=models.CharField(choices=[('welcome', 'Welcome email'), ('ticket_delivery', 'Ticket delivery email'), ('booking_confirmation_sms', 'Booking confirmation SMS'), ('refund_confirmation', 'Refund confirmation email'), ('refund_confirmation_sms', 'Refund confirmation SMS'), ('otp', 'OTP SMS'), ('event_reminder', 'Event reminder email'), ('payout_released', 'Payout released email')], max_length=64),
        ),
    ]
