from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("scheduling", "0009_meetingtype_questions_booking_answers"),
    ]

    operations = [
        migrations.AddField(
            model_name="booking",
            name="reminded_stages",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
