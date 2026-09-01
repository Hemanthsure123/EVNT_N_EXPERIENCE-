"""An optional donation, added to what the customer pays.

`default=0` rather than a nullable column: every existing booking genuinely
carried no donation, and a NULL would force every reader — the refund
calculation, the settlement aggregate, the checkout summary — to spell out a
None case that means exactly the same thing as zero. Money columns in this
codebase are integer paise and non-null; this one matches.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("booking", "0004_bookingitem_phase_name")]

    operations = [
        migrations.AddField(
            model_name="booking",
            name="donation_amount_minor",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
