"""
Add public profile share fields. share_token gets a unique UUID per row
via a 3-step migration so existing users don't collide on the same default.
"""

from __future__ import annotations

import uuid

from django.db import migrations, models


def populate_share_tokens(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    for user in User.objects.all():
        user.share_token = uuid.uuid4()
        user.save(update_fields=["share_token"])


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0004_user_country"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="share_enabled",
            field=models.BooleanField(default=False),
        ),
        # Step 1: nullable, no default — safe to add to populated table.
        migrations.AddField(
            model_name="user",
            name="share_token",
            field=models.UUIDField(null=True, blank=True),
        ),
        # Step 2: assign a unique UUID per existing row.
        migrations.RunPython(populate_share_tokens, reverse_code=migrations.RunPython.noop),
        # Step 3: tighten to default + unique + non-null.
        migrations.AlterField(
            model_name="user",
            name="share_token",
            field=models.UUIDField(default=uuid.uuid4, unique=True, db_index=True),
        ),
    ]
