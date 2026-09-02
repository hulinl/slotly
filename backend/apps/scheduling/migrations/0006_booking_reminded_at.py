from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scheduling", "0005_booking"),
    ]

    operations = [
        migrations.AddField(
            model_name="booking",
            name="reminded_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
