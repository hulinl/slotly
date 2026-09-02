from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scheduling", "0007_meetingtype"),
    ]

    operations = [
        migrations.AddField(
            model_name="booking",
            name="attendee_emails",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
