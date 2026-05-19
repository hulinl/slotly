"""
Republish an ICS feed with timezone fields rewritten so Google Calendar
displays correct times.

Background: Microsoft 365's published calendar feeds tag events with
Windows-style timezone identifiers like ``W. Europe Standard Time``. Google
Calendar only recognizes IANA names (``Europe/Berlin``), and MS365 often
emits multiple Windows TZIDs while supplying a VTIMEZONE definition for
only one of them. The remaining TZIDs are effectively undefined; Google
falls back to UTC and the events display shifted by the local offset.

The bridge fetches the source feed and:
  1. Replaces every ``TZID=<windows-name>`` reference with its IANA peer.
  2. Drops the original VTIMEZONE blocks and emits one fresh, RFC-5545
     compliant VTIMEZONE per IANA zone actually used by the events.
  3. Adds ``X-WR-TIMEZONE`` as a calendar-level hint for floating times.

Times themselves are *not* recalculated — they're already local wall-clock
times tagged with a broken TZID. Renaming the tag is enough.

Event content (SUMMARY, DESCRIPTION, …) passes through unchanged. Nothing
is stored — the function is pure ``str -> str``.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# Windows time-zone IDs → IANA. Sourced from the CLDR
# windowsZones.xml mapping table. Limited to zones we realistically see in
# Outlook-published feeds; unknown values fall back to the bridge's
# configured default_tz, which is correct for the typical mixed-CET case.
_WINDOWS_TO_IANA: dict[str, str] = {
    "Dateline Standard Time": "Etc/GMT+12",
    "UTC-11": "Etc/GMT+11",
    "Aleutian Standard Time": "America/Adak",
    "Hawaiian Standard Time": "Pacific/Honolulu",
    "Marquesas Standard Time": "Pacific/Marquesas",
    "Alaskan Standard Time": "America/Anchorage",
    "UTC-09": "Etc/GMT+9",
    "Pacific Standard Time (Mexico)": "America/Tijuana",
    "UTC-08": "Etc/GMT+8",
    "Pacific Standard Time": "America/Los_Angeles",
    "US Mountain Standard Time": "America/Phoenix",
    "Mountain Standard Time (Mexico)": "America/Chihuahua",
    "Mountain Standard Time": "America/Denver",
    "Central America Standard Time": "America/Guatemala",
    "Central Standard Time": "America/Chicago",
    "Easter Island Standard Time": "Pacific/Easter",
    "Central Standard Time (Mexico)": "America/Mexico_City",
    "Canada Central Standard Time": "America/Regina",
    "SA Pacific Standard Time": "America/Bogota",
    "Eastern Standard Time (Mexico)": "America/Cancun",
    "Eastern Standard Time": "America/New_York",
    "Haiti Standard Time": "America/Port-au-Prince",
    "Cuba Standard Time": "America/Havana",
    "US Eastern Standard Time": "America/Indiana/Indianapolis",
    "Turks And Caicos Standard Time": "America/Grand_Turk",
    "Paraguay Standard Time": "America/Asuncion",
    "Atlantic Standard Time": "America/Halifax",
    "Venezuela Standard Time": "America/Caracas",
    "Central Brazilian Standard Time": "America/Cuiaba",
    "SA Western Standard Time": "America/La_Paz",
    "Pacific SA Standard Time": "America/Santiago",
    "Newfoundland Standard Time": "America/St_Johns",
    "Tocantins Standard Time": "America/Araguaina",
    "E. South America Standard Time": "America/Sao_Paulo",
    "SA Eastern Standard Time": "America/Cayenne",
    "Argentina Standard Time": "America/Argentina/Buenos_Aires",
    "Greenland Standard Time": "America/Godthab",
    "Montevideo Standard Time": "America/Montevideo",
    "Magallanes Standard Time": "America/Punta_Arenas",
    "Saint Pierre Standard Time": "America/Miquelon",
    "Bahia Standard Time": "America/Bahia",
    "UTC-02": "Etc/GMT+2",
    "Mid-Atlantic Standard Time": "Atlantic/South_Georgia",
    "Azores Standard Time": "Atlantic/Azores",
    "Cape Verde Standard Time": "Atlantic/Cape_Verde",
    "UTC": "Etc/UTC",
    "GMT Standard Time": "Europe/London",
    "Greenwich Standard Time": "Atlantic/Reykjavik",
    "Sao Tome Standard Time": "Africa/Sao_Tome",
    "Morocco Standard Time": "Africa/Casablanca",
    # The three names MS365 routinely emits for Central European time. All
    # map to IANA zones in the same UTC+1/+2 group; choosing the canonical
    # Prague/Berlin/Warsaw names keeps Google happy.
    "W. Europe Standard Time": "Europe/Berlin",
    "Central Europe Standard Time": "Europe/Budapest",
    "Central European Standard Time": "Europe/Warsaw",
    "Romance Standard Time": "Europe/Paris",
    "GTB Standard Time": "Europe/Bucharest",
    "Middle East Standard Time": "Asia/Beirut",
    "Egypt Standard Time": "Africa/Cairo",
    "E. Europe Standard Time": "Europe/Chisinau",
    "Syria Standard Time": "Asia/Damascus",
    "West Bank Standard Time": "Asia/Hebron",
    "South Africa Standard Time": "Africa/Johannesburg",
    "FLE Standard Time": "Europe/Kiev",
    "Israel Standard Time": "Asia/Jerusalem",
    "Kaliningrad Standard Time": "Europe/Kaliningrad",
    "Sudan Standard Time": "Africa/Khartoum",
    "Libya Standard Time": "Africa/Tripoli",
    "Namibia Standard Time": "Africa/Windhoek",
    "Arabic Standard Time": "Asia/Baghdad",
    "Turkey Standard Time": "Europe/Istanbul",
    "Arab Standard Time": "Asia/Riyadh",
    "Belarus Standard Time": "Europe/Minsk",
    "Russian Standard Time": "Europe/Moscow",
    "E. Africa Standard Time": "Africa/Nairobi",
    "Iran Standard Time": "Asia/Tehran",
    "Arabian Standard Time": "Asia/Dubai",
    "Astrakhan Standard Time": "Europe/Astrakhan",
    "Azerbaijan Standard Time": "Asia/Baku",
    "Russia Time Zone 3": "Europe/Samara",
    "Mauritius Standard Time": "Indian/Mauritius",
    "Saratov Standard Time": "Europe/Saratov",
    "Georgian Standard Time": "Asia/Tbilisi",
    "Caucasus Standard Time": "Asia/Yerevan",
    "Afghanistan Standard Time": "Asia/Kabul",
    "West Asia Standard Time": "Asia/Tashkent",
    "Ekaterinburg Standard Time": "Asia/Yekaterinburg",
    "Pakistan Standard Time": "Asia/Karachi",
    "India Standard Time": "Asia/Calcutta",
    "Sri Lanka Standard Time": "Asia/Colombo",
    "Nepal Standard Time": "Asia/Katmandu",
    "Central Asia Standard Time": "Asia/Almaty",
    "Bangladesh Standard Time": "Asia/Dhaka",
    "Omsk Standard Time": "Asia/Omsk",
    "Myanmar Standard Time": "Asia/Rangoon",
    "SE Asia Standard Time": "Asia/Bangkok",
    "Altai Standard Time": "Asia/Barnaul",
    "W. Mongolia Standard Time": "Asia/Hovd",
    "North Asia Standard Time": "Asia/Krasnoyarsk",
    "N. Central Asia Standard Time": "Asia/Novosibirsk",
    "Tomsk Standard Time": "Asia/Tomsk",
    "China Standard Time": "Asia/Shanghai",
    "North Asia East Standard Time": "Asia/Irkutsk",
    "Singapore Standard Time": "Asia/Singapore",
    "W. Australia Standard Time": "Australia/Perth",
    "Taipei Standard Time": "Asia/Taipei",
    "Ulaanbaatar Standard Time": "Asia/Ulaanbaatar",
    "Aus Central W. Standard Time": "Australia/Eucla",
    "Transbaikal Standard Time": "Asia/Chita",
    "Tokyo Standard Time": "Asia/Tokyo",
    "North Korea Standard Time": "Asia/Pyongyang",
    "Korea Standard Time": "Asia/Seoul",
    "Yakutsk Standard Time": "Asia/Yakutsk",
    "Cen. Australia Standard Time": "Australia/Adelaide",
    "AUS Central Standard Time": "Australia/Darwin",
    "E. Australia Standard Time": "Australia/Brisbane",
    "AUS Eastern Standard Time": "Australia/Sydney",
    "West Pacific Standard Time": "Pacific/Port_Moresby",
    "Tasmania Standard Time": "Australia/Hobart",
    "Vladivostok Standard Time": "Asia/Vladivostok",
    "Lord Howe Standard Time": "Australia/Lord_Howe",
    "Bougainville Standard Time": "Pacific/Bougainville",
    "Russia Time Zone 10": "Asia/Srednekolymsk",
    "Magadan Standard Time": "Asia/Magadan",
    "Norfolk Standard Time": "Pacific/Norfolk",
    "Sakhalin Standard Time": "Asia/Sakhalin",
    "Central Pacific Standard Time": "Pacific/Guadalcanal",
    "Russia Time Zone 11": "Asia/Kamchatka",
    "New Zealand Standard Time": "Pacific/Auckland",
    "UTC+12": "Etc/GMT-12",
    "Fiji Standard Time": "Pacific/Fiji",
    "Chatham Islands Standard Time": "Pacific/Chatham",
    "UTC+13": "Etc/GMT-13",
    "Tonga Standard Time": "Pacific/Tongatapu",
    "Samoa Standard Time": "Pacific/Apia",
    "Line Islands Standard Time": "Pacific/Kiritimati",
}


_TZID_PARAM_RE = re.compile(r";TZID=([^:;\r\n]+)")
_VTIMEZONE_BLOCK_RE = re.compile(
    r"BEGIN:VTIMEZONE.*?END:VTIMEZONE\r?\n?",
    re.DOTALL,
)


def _resolve_iana(tzid: str, default_tz: str) -> str:
    """Map ``tzid`` to an IANA zone, using default_tz when unknown."""
    tzid = tzid.strip()
    if not tzid:
        return default_tz
    # Already IANA (contains a slash and is recognized by zoneinfo).
    if "/" in tzid:
        try:
            ZoneInfo(tzid)
            return tzid
        except ZoneInfoNotFoundError:
            pass
    mapped = _WINDOWS_TO_IANA.get(tzid)
    if mapped:
        return mapped
    return default_tz


def _format_offset(td: timedelta) -> str:
    """Render a timedelta as ``±HHMM`` for ICS TZOFFSETFROM/TO."""
    total = int(td.total_seconds())
    sign = "+" if total >= 0 else "-"
    total = abs(total)
    hours, rem = divmod(total, 3600)
    minutes = rem // 60
    return f"{sign}{hours:02d}{minutes:02d}"


def _emit_vtimezone(iana: str) -> str:
    """
    Emit a static VTIMEZONE block for ``iana`` covering the years around now.

    We sample DST transitions from zoneinfo for the rolling sync window
    (last year through next two years) and emit one STANDARD + one DAYLIGHT
    sub-component per transition. Most consumers (Google included) honor a
    VTIMEZONE with explicit historical transitions; an RRULE-based recurring
    form would be smaller but is unnecessary for the short bridge window.
    """
    tz = ZoneInfo(iana)
    now = datetime.now(tz=timezone.utc)
    # Generate one entry per month over the window — coarse enough to catch
    # both spring-forward and fall-back transitions in any IANA zone.
    start_year = now.year - 1
    end_year = now.year + 2
    lines: list[str] = ["BEGIN:VTIMEZONE", f"TZID:{iana}"]
    prev_offset: timedelta | None = None
    prev_dst: timedelta | None = None
    samples: list[datetime] = []
    for year in range(start_year, end_year + 1):
        for month in range(1, 13):
            for day in (1, 15):
                samples.append(datetime(year, month, day, 12, 0, tzinfo=tz))
    seen_transitions: set[tuple[str, str, str]] = set()
    for sample in samples:
        offset = sample.utcoffset() or timedelta(0)
        dst = sample.dst() or timedelta(0)
        if prev_offset is None:
            prev_offset = offset
            prev_dst = dst
            continue
        if offset == prev_offset:
            continue
        # Transition: emit the block that we're switching into.
        kind = "DAYLIGHT" if dst > timedelta(0) else "STANDARD"
        offset_from = _format_offset(prev_offset)
        offset_to = _format_offset(offset)
        # Find the precise transition by binary-searching the day.
        transition = _find_transition(tz, sample - timedelta(days=20), sample)
        dtstart = transition.strftime("%Y%m%dT%H%M%S")
        tzname = sample.tzname() or kind.title()
        key = (kind, offset_from, offset_to)
        if key in seen_transitions:
            prev_offset = offset
            prev_dst = dst
            continue
        seen_transitions.add(key)
        lines.extend([
            f"BEGIN:{kind}",
            f"DTSTART:{dtstart}",
            f"TZOFFSETFROM:{offset_from}",
            f"TZOFFSETTO:{offset_to}",
            f"TZNAME:{tzname}",
            f"END:{kind}",
        ])
        prev_offset = offset
        prev_dst = dst
    if len(lines) == 2:
        # No DST in this zone — emit a single STANDARD with the current offset.
        offset = now.astimezone(tz).utcoffset() or timedelta(0)
        lines.extend([
            "BEGIN:STANDARD",
            f"DTSTART:{start_year:04d}0101T000000",
            f"TZOFFSETFROM:{_format_offset(offset)}",
            f"TZOFFSETTO:{_format_offset(offset)}",
            f"TZNAME:{datetime.now(tz=tz).tzname() or 'STD'}",
            "END:STANDARD",
        ])
    lines.append("END:VTIMEZONE")
    return "\r\n".join(lines) + "\r\n"


def _find_transition(tz: ZoneInfo, lo: datetime, hi: datetime) -> datetime:
    """Binary-search the wall-clock moment where ``tz`` changes offset."""
    lo_off = lo.utcoffset()
    while (hi - lo) > timedelta(minutes=1):
        mid = lo + (hi - lo) / 2
        mid = mid.replace(tzinfo=tz)
        if mid.utcoffset() == lo_off:
            lo = mid
        else:
            hi = mid
    # ``hi`` is the first sample past the boundary; the TZNAME and offsets in
    # the calling frame already reflect that side. Return as naive local time.
    return hi.replace(tzinfo=None)


def rewrite_for_google(ics_text: str, default_tz: str = "Europe/Prague") -> str:
    """
    Return a copy of ``ics_text`` with TZIDs and VTIMEZONE blocks normalized
    to IANA, suitable for Google Calendar consumption.

    Steps:
      1. Collect every ``TZID=...`` value referenced in the body.
      2. Build the Windows→IANA mapping for those values; unknown TZIDs
         fall back to ``default_tz``.
      3. Strip the original VTIMEZONE blocks and prepend fresh IANA ones.
      4. Rewrite every TZID parameter to the IANA name.
      5. Add ``X-WR-TIMEZONE`` if absent.
    """
    if not ics_text:
        return ics_text

    tzids_seen = {m.group(1) for m in _TZID_PARAM_RE.finditer(ics_text)}
    mapping: dict[str, str] = {tz: _resolve_iana(tz, default_tz) for tz in tzids_seen}

    body_without_vtz = _VTIMEZONE_BLOCK_RE.sub("", ics_text)

    def _rewrite_param(match: re.Match[str]) -> str:
        original = match.group(1)
        return f";TZID={mapping.get(original, default_tz)}"

    rewritten = _TZID_PARAM_RE.sub(_rewrite_param, body_without_vtz)

    # Always emit a VTIMEZONE for default_tz so X-WR-TIMEZONE has a backing
    # definition, even if no events explicitly reference it.
    zones_to_emit = {default_tz, *mapping.values()}
    vtimezones = "".join(_emit_vtimezone(z) for z in sorted(zones_to_emit))

    has_xwr = "X-WR-TIMEZONE" in rewritten
    xwr_line = "" if has_xwr else f"X-WR-TIMEZONE:{default_tz}\r\n"

    # Inject the VTIMEZONE blocks and X-WR-TIMEZONE right after VERSION (or
    # after BEGIN:VCALENDAR if VERSION is missing). Keep CRLF line endings
    # per RFC 5545.
    anchor = re.search(r"(VERSION:[^\r\n]*\r?\n)", rewritten)
    if anchor is None:
        anchor = re.search(r"(BEGIN:VCALENDAR\r?\n)", rewritten)
    if anchor is None:
        # Not a recognizable calendar — leave the original alone rather than
        # corrupt it. The endpoint will surface this as a 502.
        return ics_text
    insertion = f"{xwr_line}{vtimezones}"
    return rewritten[: anchor.end()] + insertion + rewritten[anchor.end():]
