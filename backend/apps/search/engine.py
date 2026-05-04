"""
Pure availability-search algorithm. No DB access; takes plain dicts and
list[(datetime,datetime)] in, returns list[Slot]. Designed to be unit-testable
without running migrations.

Approach (PRD §5.4, strict match):
    1. For each user in the request, compute that user's *working windows*
       within [window_start, window_end] by walking each calendar day in
       the app timezone and checking their per-weekday working_hours.
    2. Subtract their *busy intervals*, expanded by `buffer` on each side,
       from those working windows → user's free intervals.
    3. Intersect all users' free intervals.
    4. Walk the resulting intersection and emit `duration`-long slots
       starting on a `granularity` boundary aligned in the app TZ
       (15 min by default).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")

Interval = tuple[datetime, datetime]  # tz-aware on both ends


@dataclass(frozen=True, slots=True)
class Slot:
    start: datetime
    end: datetime


def compute_slots(
    *,
    working_hours_per_user: dict[int, dict],
    busy_per_user: dict[int, list[Interval]],
    user_ids: list[int],
    window_start: datetime,
    window_end: datetime,
    duration: timedelta,
    tz: ZoneInfo,
    buffer: timedelta = timedelta(0),
    granularity: timedelta = timedelta(minutes=15),
    max_results: int = 100,
) -> tuple[list[Slot], bool]:
    """
    Returns (slots, truncated). `slots` are tz-aware in `tz`. `truncated` is
    True iff the engine hit `max_results` and stopped early.
    """
    if not user_ids or window_start >= window_end:
        return [], False

    per_user_free: list[list[Interval]] = []
    for uid in user_ids:
        wh = working_hours_per_user.get(uid) or {}
        busy = busy_per_user.get(uid, [])
        per_user_free.append(_user_free(wh, busy, window_start, window_end, buffer, tz))

    intersection = per_user_free[0]
    for other in per_user_free[1:]:
        intersection = _intersect_two(intersection, other)
        if not intersection:
            break

    slots: list[Slot] = []
    truncated = False
    for s, e in intersection:
        cursor = _snap_up_to_grid(s, granularity, tz)
        while cursor + duration <= e:
            local_start = cursor.astimezone(tz)
            slots.append(Slot(start=local_start, end=local_start + duration))
            if len(slots) >= max_results:
                truncated = True
                break
            cursor = cursor + granularity
        if truncated:
            break

    return slots, truncated


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _user_free(
    working_hours: dict,
    busy: list[Interval],
    window_start: datetime,
    window_end: datetime,
    buffer: timedelta,
    tz: ZoneInfo,
) -> list[Interval]:
    available = _working_intervals(working_hours, window_start, window_end, tz)
    if not available:
        return []
    if not busy:
        return available

    buffered = [(b[0] - buffer, b[1] + buffer) for b in busy]
    buffered = _merge(buffered)
    return _subtract(available, buffered)


def _working_intervals(
    working_hours: dict, window_start: datetime, window_end: datetime, tz: ZoneInfo
) -> list[Interval]:
    out: list[Interval] = []
    local_start = window_start.astimezone(tz)
    local_end = window_end.astimezone(tz)
    cursor = local_start.date()
    end_date = local_end.date()
    while cursor <= end_date:
        weekday_name = WEEKDAYS[cursor.weekday()]
        spec = working_hours.get(weekday_name) or {"available": False}
        if spec.get("available"):
            wh_start = _parse_hhmm(spec.get("start", "00:00"))
            wh_end = _parse_hhmm(spec.get("end", "23:59"))
            day_start_local = datetime.combine(cursor, wh_start, tzinfo=tz)
            day_end_local = datetime.combine(cursor, wh_end, tzinfo=tz)
            s = max(day_start_local, window_start)
            e = min(day_end_local, window_end)
            if s < e:
                out.append((s, e))
        cursor += timedelta(days=1)
    return out


def _parse_hhmm(s: str) -> time:
    h, m = s.split(":")
    return time(int(h), int(m))


def _merge(intervals: list[Interval]) -> list[Interval]:
    if not intervals:
        return []
    intervals = sorted(intervals)
    out = [intervals[0]]
    for s, e in intervals[1:]:
        last_s, last_e = out[-1]
        if s <= last_e:
            out[-1] = (last_s, max(last_e, e))
        else:
            out.append((s, e))
    return out


def _intersect_two(a: list[Interval], b: list[Interval]) -> list[Interval]:
    out: list[Interval] = []
    i = j = 0
    while i < len(a) and j < len(b):
        s = max(a[i][0], b[j][0])
        e = min(a[i][1], b[j][1])
        if s < e:
            out.append((s, e))
        if a[i][1] < b[j][1]:
            i += 1
        else:
            j += 1
    return out


def _subtract(a: list[Interval], b: list[Interval]) -> list[Interval]:
    """`a` minus `b`, both sorted; `b` is assumed already merged."""
    out: list[Interval] = []
    for ai in a:
        pieces: list[Interval] = [ai]
        for bi in b:
            next_pieces: list[Interval] = []
            for p in pieces:
                if bi[1] <= p[0] or bi[0] >= p[1]:
                    next_pieces.append(p)
                else:
                    if p[0] < bi[0]:
                        next_pieces.append((p[0], bi[0]))
                    if p[1] > bi[1]:
                        next_pieces.append((bi[1], p[1]))
            pieces = next_pieces
            if not pieces:
                break
        out.extend(pieces)
    return out


def _snap_up_to_grid(dt: datetime, granularity: timedelta, tz: ZoneInfo) -> datetime:
    """Round `dt` UP to the next `granularity` boundary aligned in `tz`."""
    local = dt.astimezone(tz)
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    seconds_into_day = (local - midnight).total_seconds()
    granularity_seconds = granularity.total_seconds()
    rounded = (
        (seconds_into_day + granularity_seconds - 1) // granularity_seconds
    ) * granularity_seconds
    snapped_local = midnight + timedelta(seconds=rounded)
    return snapped_local.astimezone(dt.tzinfo)
