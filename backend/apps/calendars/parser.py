"""
Parse RFC 5545 ICS payloads into a list of free/busy intervals.

The parser reads only a strict whitelist of fields (DTSTART, DTEND, DURATION,
UID, STATUS, TRANSP, RRULE/EXDATE/RECURRENCE-ID via the recurrence library).
Anything else (SUMMARY, DESCRIPTION, LOCATION, ATTENDEE, ORGANIZER, …) is
intentionally ignored. The output dataclass has no fields to receive such
data, so even if a future change accidentally reads them, they have nowhere
to go. This is the schema-level half of the privacy guarantee in PRD R11.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

import icalendar
import recurring_ical_events


@dataclass(frozen=True, slots=True)
class ParsedEvent:
    uid: str
    recurrence_id: str  # "" for single/master instances
    dtstart: datetime  # always tz-aware UTC
    dtend: datetime  # always tz-aware UTC
    is_all_day: bool
    status: str  # confirmed | tentative | cancelled
    transp: str  # opaque | transparent


_STATUS_MAP = {
    "CONFIRMED": "confirmed",
    "TENTATIVE": "tentative",
    "CANCELLED": "cancelled",
}
_TRANSP_MAP = {
    "OPAQUE": "opaque",
    "TRANSPARENT": "transparent",
}


def _to_aware_utc(value: datetime | date) -> tuple[datetime, bool]:
    """Return (tz-aware UTC datetime, is_all_day)."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            # Floating time per RFC 5545 — interpret as UTC-naive treated as UTC.
            # We don't know the user's TZ here; downstream search picks it up.
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc), False
    # date-only -> all-day, midnight UTC
    return datetime.combine(value, time(0, 0), tzinfo=timezone.utc), True


def _read_event(component: icalendar.Event) -> ParsedEvent | None:
    uid = str(component.get("UID", "")).strip()
    if not uid:
        return None

    raw_start = component.get("DTSTART")
    if raw_start is None:
        return None
    dtstart, is_all_day = _to_aware_utc(raw_start.dt)

    if component.get("DTEND") is not None:
        dtend_val = component.get("DTEND").dt
        dtend, _ = _to_aware_utc(dtend_val)
    elif component.get("DURATION") is not None:
        duration = component.get("DURATION").dt  # timedelta
        dtend = dtstart + (duration if isinstance(duration, timedelta) else timedelta())
    elif is_all_day:
        # All-day with only DTSTART means a single 24h block per RFC 5545.
        dtend = dtstart + timedelta(days=1)
    else:
        dtend = dtstart  # zero-length; will be filtered out as not overlapping windows

    if dtend <= dtstart:
        return None

    status_raw = str(component.get("STATUS", "CONFIRMED")).upper()
    transp_raw = str(component.get("TRANSP", "OPAQUE")).upper()

    # Identify each (possibly expanded) instance by its dtstart. This is
    # stable across resyncs and guarantees uniqueness within a UID for RRULE
    # expansions whose instances would otherwise share the same empty
    # RECURRENCE-ID. For master/single events this collapses to a single
    # row keyed by the original dtstart.
    recurrence_id = dtstart.isoformat()

    return ParsedEvent(
        uid=uid,
        recurrence_id=recurrence_id,
        dtstart=dtstart,
        dtend=dtend,
        is_all_day=is_all_day,
        status=_STATUS_MAP.get(status_raw, "confirmed"),
        transp=_TRANSP_MAP.get(transp_raw, "opaque"),
    )


def parse_ics(
    text: str,
    *,
    window_start: datetime,
    window_end: datetime,
) -> list[ParsedEvent]:
    """
    Parse `text` and return events overlapping [window_start, window_end].

    Recurring events are expanded by `recurring-ical-events`; each
    materialised instance becomes its own ParsedEvent. Cancelled instances
    (EXDATE) are excluded. Status=CANCELLED on the master is preserved on
    each instance — downstream code uses it to mark the slot free.
    """
    if window_start.tzinfo is None or window_end.tzinfo is None:
        raise ValueError("window_start and window_end must be tz-aware")

    cal = icalendar.Calendar.from_ical(text)

    # `recurring_ical_events` returns expanded VEVENT instances within the window.
    expansions = recurring_ical_events.of(cal).between(window_start, window_end)

    results: list[ParsedEvent] = []
    for component in expansions:
        parsed = _read_event(component)
        if parsed is None:
            continue
        # Filter to overlapping window (the lib already does this, but be safe).
        if parsed.dtend <= window_start or parsed.dtstart >= window_end:
            continue
        results.append(parsed)
    return results
