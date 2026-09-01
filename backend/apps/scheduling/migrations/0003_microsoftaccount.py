import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("scheduling", "0002_googleaccount_write_calendar_id"),
    ]

    operations = [
        migrations.CreateModel(
            name="MicrosoftAccount",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("microsoft_email", models.EmailField(max_length=254)),
                ("access_token_encrypted", models.TextField()),
                ("refresh_token_encrypted", models.TextField()),
                ("expires_at", models.DateTimeField()),
                ("scope", models.CharField(blank=True, max_length=500)),
                ("write_calendar_id", models.CharField(blank=True, default="", max_length=1024)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "user",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="microsoft_account",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "indexes": [models.Index(fields=["user"], name="scheduling__user_id_ms_idx")],
            },
        ),
    ]
