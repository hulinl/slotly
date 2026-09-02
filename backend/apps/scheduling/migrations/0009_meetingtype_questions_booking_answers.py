from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scheduling", "0008_booking_attendee_emails"),
    ]

    operations = [
        migrations.AddField(
            model_name="meetingtype",
            name="questions",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="booking",
            name="custom_answers",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
