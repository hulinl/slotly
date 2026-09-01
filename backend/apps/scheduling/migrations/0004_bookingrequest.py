import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("scheduling", "0003_microsoftaccount"),
    ]

    operations = [
        migrations.CreateModel(
            name="BookingRequest",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("visitor_name", models.CharField(blank=True, max_length=120)),
                ("visitor_email", models.EmailField(blank=True, max_length=254)),
                ("kind", models.CharField(choices=[("physical", "In person")], default="physical", max_length=16)),
                ("start_at", models.DateTimeField()),
                ("end_at", models.DateTimeField()),
                ("title", models.CharField(blank=True, max_length=200)),
                ("notes", models.TextField(blank=True)),
                ("location", models.CharField(blank=True, max_length=300)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("approved", "Approved"),
                            ("rejected", "Rejected"),
                            ("cancelled", "Cancelled"),
                        ],
                        default="pending",
                        max_length=16,
                    ),
                ),
                ("decision_note", models.CharField(blank=True, max_length=500)),
                ("event_id", models.CharField(blank=True, max_length=256)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("decided_at", models.DateTimeField(blank=True, null=True)),
                (
                    "host",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="booking_requests",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "requester_user",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ("-created_at",),
                "indexes": [
                    models.Index(fields=["host", "status", "-created_at"], name="scheduling__host_id_br_idx"),
                ],
            },
        ),
    ]
