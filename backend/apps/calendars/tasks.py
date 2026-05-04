"""Celery tasks for ICS subscription polling."""

from __future__ import annotations

import logging

from celery import shared_task

from .models import Calendar
from .sync import sync_calendar

logger = logging.getLogger(__name__)


@shared_task(name="calendars.sync_one")
def sync_one(calendar_id: int) -> dict:
    try:
        calendar = Calendar.objects.get(pk=calendar_id)
    except Calendar.DoesNotExist:
        logger.warning("Calendar %s no longer exists", calendar_id)
        return {"skipped": True}
    result = sync_calendar(calendar)
    return {
        "calendar_id": calendar_id,
        "status_code": result.status_code,
        "fetched": result.fetched,
        "written": result.written,
        "deleted": result.deleted,
        "notes": result.notes,
    }


@shared_task(name="calendars.sync_all_due")
def sync_all_due() -> dict:
    """Enqueue a sync_one task for every calendar that is meant to be polled."""
    queued = 0
    for cal_id in Calendar.objects.filter(include_in_busy=True).values_list("pk", flat=True):
        sync_one.apply_async(args=[cal_id], countdown=_jitter())
        queued += 1
    return {"queued": queued}


def _jitter() -> int:
    """0–30s of jitter to spread provider load (PRD §5.2)."""
    import random

    return random.randint(0, 30)
