"""Initialize per-user notification prefs at signup."""

from __future__ import annotations

from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.accounts.models import User

from .models import default_notification_prefs


@receiver(post_save, sender=User)
def seed_notification_prefs(sender, instance: User, created: bool, **kwargs):  # noqa: ARG001
    if not created:
        return
    if instance.notification_prefs:
        return
    instance.notification_prefs = default_notification_prefs()
    # Use update_fields to avoid recursion / extra writes.
    instance.save(update_fields=["notification_prefs"])
