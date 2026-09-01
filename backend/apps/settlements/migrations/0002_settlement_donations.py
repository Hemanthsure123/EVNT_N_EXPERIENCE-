"""Donations get their own line on the settlement.

They could have been folded into `platform_fee` — both are money the platform
retains and the organizer's net is identical either way. They are not, because
a settlement is a financial record an organizer reads: one that describes
charity money as a platform fee is wrong about where the money went, and
"the arithmetic still balances" is not a defence for that.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("settlements", "0001_initial")]

    operations = [
        migrations.AddField(
            model_name="settlement",
            name="donations",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
