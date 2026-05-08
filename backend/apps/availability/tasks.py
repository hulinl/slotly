"""
Periodic cleanup of stale Unavailability rows.

Past blocks are useful in the UI for a while (the user just lived through
them), but holding on forever bloats the search engine's busy queries and
the user's archive. After RETENTION_DAYS, drop them.
"""

from __future__ import annotations

from datetime import timedelta

from celery import shared_task
from django.utils import timezone

RETENTION_DAYS = 90


@shared_task(name="availability.purge_old_blocks")
def purge_old_blocks() -> int:
    """Delete Unavailability rows whose `ends_at` is older than the
    retention window. Returns the number of rows deleted (handy for logs)."""
    from .models import Unavailability

    cutoff = timezone.now() - timedelta(days=RETENTION_DAYS)
    deleted, _ = Unavailability.objects.filter(ends_at__lt=cutoff).delete()
    return deleted
