import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("scheduling", "0004_bookingrequest"),
    ]

    operations = [
        migrations.CreateModel(
            name="Booking",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uuid", models.UUIDField(db_index=True, default=uuid.uuid4, unique=True)),
                ("provider", models.CharField(choices=[("google", "Google"), ("microsoft", "Microsoft")], max_length=16)),
                ("calendar_id", models.CharField(blank=True, max_length=1024)),
                ("event_id", models.CharField(blank=True, db_index=True, max_length=256)),
                ("visitor_name", models.CharField(blank=True, max_length=120)),
                ("visitor_email", models.EmailField(blank=True, max_length=254)),
                (
                    "kind",
                    models.CharField(
                        choices=[("online", "Online"), ("physical", "In person")],
                        default="online",
                        max_length=16,
                    ),
                ),
                ("title", models.CharField(blank=True, max_length=200)),
                ("location", models.CharField(blank=True, max_length=300)),
                ("notes", models.TextField(blank=True)),
                ("start_at", models.DateTimeField()),
                ("end_at", models.DateTimeField()),
                (
                    "status",
                    models.CharField(
                        choices=[("confirmed", "Confirmed"), ("cancelled", "Cancelled")],
                        default="confirmed",
                        max_length=16,
                    ),
                ),
                ("cancelled_at", models.DateTimeField(blank=True, null=True)),
                ("cancellation_reason", models.TextField(blank=True)),
                ("cancelled_by_visitor", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "host",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="hosted_bookings",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ("-created_at",),
                "indexes": [
                    models.Index(fields=["host", "-start_at"], name="scheduling__host_id_bk_idx"),
                    models.Index(fields=["visitor_email", "-start_at"], name="scheduling__visitor_bk_idx"),
                ],
            },
        ),
    ]
