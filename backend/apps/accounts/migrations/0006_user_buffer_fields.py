from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0005_user_share_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="buffer_before_min",
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="user",
            name="buffer_after_min",
            field=models.PositiveSmallIntegerField(default=0),
        ),
    ]
