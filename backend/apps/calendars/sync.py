"""
Sync a Calendar: fetch its ICS URL, parse, and replace the cached events
within the rolling window (now-1d → now+3M, per PRD §5.2).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
from django.db import transaction
from django.utils import timezone as djtz

from .models import Calendar, CalendarEvent
from .parser import parse_ics
from .security import decrypt_url

logger = logging.getLogger(__name__)

# PRD §5.2 sync window
WINDOW_PAST = timedelta(days=1)
WINDOW_FUTURE = timedelta(days=90)

# Fail buckets per PRD §5.2 ("Errors and stale URLs")
SYNC_FAILING_THRESHOLD = 3   # 3 consecutive failures → mark sync_failing
UNREACHABLE_THRESHOLD = 24 * 60 // 5   # 24h at 5-minute polls → unreachable


@dataclass
class SyncResult:
    fetched: bool        # True iff we got a 200; False on 304-not-modified
    written: int         # number of events upserted
    deleted: int         # number of events removed (out of window or stale)
    status_code: int     # HTTP status from the provider
    notes: str = ""


def _conditional_headers(calendar: Calendar) -> dict[str, str]:
    headers: dict[str, str] = {
        "User-Agent": "Slotly/0.1 (+https://github.com/hulinl/slotly)",
        "Accept": "text/calendar, application/octet-stream;q=0.5, */*;q=0.1",
    }
    if calendar.last_etag:
        headers["If-None-Match"] = calendar.last_etag
    if calendar.last_modified:
        headers["If-Modified-Since"] = calendar.last_modified
    return headers


def _fetch(url: str, headers: dict[str, str]) -> httpx.Response:
    with httpx.Client(timeout=20.0, follow_redirects=True) as client:
        return client.get(url, headers=headers)


def sync_calendar(calendar: Calendar) -> SyncResult:
    """
    Fetch + parse + upsert. Updates the Calendar row's sync metadata in place.
    Never raises on expected failures (network, 4xx, parse) — those are
    encoded in `Calendar.status` + `last_error`.
    """
    now = djtz.now()
    window_start = now - WINDOW_PAST
    window_end = now + WINDOW_FUTURE

    Calendar.objects.filter(pk=calendar.pk).update(status=Calendar.Status.SYNCING)

    try:
        url = decrypt_url(calendar.url_encrypted)
    except ValueError as exc:
        return _record_failure(calendar, now, status_code=0, error=str(exc))

    try:
        response = _fetch(url, _conditional_headers(calendar))
    except httpx.HTTPError as exc:
        return _record_failure(calendar, now, status_code=0, error=f"network: {exc.__class__.__name__}: {exc}")

    if response.status_code == 304:
        # Not modified — just bump last_synced_at.
        Calendar.objects.filter(pk=calendar.pk).update(
            status=Calendar.Status.OK,
            last_synced_at=now,
            last_error="",
            consecutive_failures=0,
        )
        return SyncResult(fetched=False, written=0, deleted=0, status_code=304, notes="not modified")

    if response.status_code >= 400:
        return _record_failure(
            calendar,
            now,
            status_code=response.status_code,
            error=f"HTTP {response.status_code}: {response.reason_phrase}",
        )

    try:
        events = parse_ics(response.text, window_start=window_start, window_end=window_end)
    except Exception as exc:  # noqa: BLE001 — parser raises many shapes; surface as failure
        return _record_failure(calendar, now, status_code=response.status_code, error=f"parse: {exc}")

    written, deleted = _persist(calendar, events, window_start=window_start, window_end=window_end)

    Calendar.objects.filter(pk=calendar.pk).update(
        status=Calendar.Status.OK,
        last_synced_at=now,
        last_error="",
        consecutive_failures=0,
        last_etag=response.headers.get("ETag", "")[:400],
        last_modified=response.headers.get("Last-Modified", "")[:200],
    )
    return SyncResult(
        fetched=True,
        written=written,
        deleted=deleted,
        status_code=response.status_code,
    )


@transaction.atomic
def _persist(calendar: Calendar, events: list, *, window_start: datetime, window_end: datetime) -> tuple[int, int]:
    """Replace the calendar's events within the sync window with the new set."""
    deleted, _ = CalendarEvent.objects.filter(
        calendar=calendar,
        dtstart__lt=window_end,
        dtend__gt=window_start,
    ).delete()

    rows = [
        CalendarEvent(
            calendar=calendar,
            uid=ev.uid[:512],
            recurrence_id=ev.recurrence_id[:200],
            dtstart=ev.dtstart,
            dtend=ev.dtend,
            is_all_day=ev.is_all_day,
            status=ev.status,
            transp=ev.transp,
        )
        for ev in events
    ]
    CalendarEvent.objects.bulk_create(rows, ignore_conflicts=True, batch_size=500)
    return len(rows), deleted


def _record_failure(calendar: Calendar, now: datetime, *, status_code: int, error: str) -> SyncResult:
    Calendar.objects.filter(pk=calendar.pk).update(
        status=_status_for_failure(calendar.consecutive_failures + 1),
        last_synced_at=now,
        last_error=error[:1000],
        consecutive_failures=models_F_increment(),
    )
    logger.info("Calendar %s sync failed: %s", calendar.pk, error)
    return SyncResult(fetched=False, written=0, deleted=0, status_code=status_code, notes=error)


def _status_for_failure(consecutive: int) -> str:
    if consecutive >= UNREACHABLE_THRESHOLD:
        return Calendar.Status.UNREACHABLE
    if consecutive >= SYNC_FAILING_THRESHOLD:
        return Calendar.Status.SYNC_FAILING
    return Calendar.Status.OK  # below threshold, keep optimistic


def models_F_increment():
    """Build an F-expression for `consecutive_failures = consecutive_failures + 1`."""
    from django.db.models import F

    return F("consecutive_failures") + 1
