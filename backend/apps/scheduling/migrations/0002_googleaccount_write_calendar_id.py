from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scheduling", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="googleaccount",
            name="write_calendar_id",
            field=models.CharField(default="primary", max_length=1024),
        ),
    ]
