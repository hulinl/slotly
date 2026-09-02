from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scheduling", "0010_booking_reminded_stages"),
    ]

    operations = [
        migrations.AddField(
            model_name="meetingtype",
            name="redirect_url",
            field=models.URLField(blank=True, max_length=2000),
        ),
    ]
