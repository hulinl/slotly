import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("scheduling", "0006_booking_reminded_at"),
    ]

    operations = [
        migrations.CreateModel(
            name="MeetingType",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=80)),
                ("slug", models.SlugField(max_length=60)),
                ("description", models.TextField(blank=True)),
                ("duration_min", models.PositiveSmallIntegerField(default=30)),
                (
                    "kind",
                    models.CharField(
                        choices=[("online", "Online"), ("physical", "In person")],
                        default="online",
                        max_length=16,
                    ),
                ),
                ("location", models.CharField(blank=True, max_length=300)),
                ("color", models.CharField(default="#4f46e5", max_length=7)),
                ("is_active", models.BooleanField(default=True)),
                ("display_order", models.PositiveSmallIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "host",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="meeting_types",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ("display_order", "id"),
                "indexes": [models.Index(fields=["host", "is_active"], name="scheduling__host_id_mt_idx")],
                "constraints": [
                    models.UniqueConstraint(fields=("host", "slug"), name="uniq_meeting_type_host_slug"),
                ],
            },
        ),
    ]
