"""
Whitelist test for the ICS parser — the load-bearing privacy guarantee per
PRD §5.2 and risk R11. If a future change starts smuggling SUMMARY,
DESCRIPTION, LOCATION, ATTENDEE, etc. into the parsed event, this test
fails before it reaches the database.
"""

from __future__ import annotations

import dataclasses
from datetime import datetime, timedelta, timezone

from django.test import TestCase

from .parser import ParsedEvent, parse_ics

ICS_WITH_PII = """\
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:meeting-1@test
DTSTART:20260504T100000Z
DTEND:20260504T110000Z
SUMMARY:Confidential merger discussion
DESCRIPTION:Should NEVER appear in the parsed event\\nSecond line
LOCATION:Boardroom 5
ORGANIZER;CN=Boss:mailto:boss@example.com
ATTENDEE;CN=Alice:mailto:alice@example.com
ATTENDEE;CN=Bob:mailto:bob@example.com
CATEGORIES:STRATEGY,LEGAL
URL:https://example.com/secret
STATUS:CONFIRMED
TRANSP:OPAQUE
X-CUSTOM-FIELD:should-also-be-dropped
END:VEVENT
END:VCALENDAR
"""

ICS_RECURRING = """\
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:standup@test
DTSTART:20260504T080000Z
DTEND:20260504T083000Z
RRULE:FREQ=DAILY;COUNT=5
SUMMARY:Daily standup (must not leak)
END:VEVENT
END:VCALENDAR
"""


class ParserWhitelistTests(TestCase):
    def setUp(self) -> None:
        self.window_start = datetime(2026, 5, 1, tzinfo=timezone.utc)
        self.window_end = datetime(2026, 5, 31, tzinfo=timezone.utc)

    def test_parsed_event_has_no_pii_fields_at_all(self) -> None:
        """The dataclass shape itself must not include PII columns."""
        field_names = {f.name for f in dataclasses.fields(ParsedEvent)}
        forbidden = {"summary", "description", "location", "organizer", "attendee", "categories", "url"}
        leaked = field_names & forbidden
        self.assertFalse(leaked, f"ParsedEvent must not have PII fields, found: {leaked}")

    def test_parser_drops_pii_from_real_ics(self) -> None:
        events = parse_ics(ICS_WITH_PII, window_start=self.window_start, window_end=self.window_end)
        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event.uid, "meeting-1@test")
        self.assertEqual(event.status, "confirmed")
        self.assertEqual(event.transp, "opaque")
        for forbidden in ("summary", "description", "location", "organizer"):
            self.assertFalse(
                hasattr(event, forbidden),
                f"ParsedEvent leaked attribute {forbidden!r}",
            )

    def test_parser_expands_recurrences_within_window(self) -> None:
        events = parse_ics(ICS_RECURRING, window_start=self.window_start, window_end=self.window_end)
        # COUNT=5 -> exactly 5 instances
        self.assertEqual(len(events), 5)
        for ev in events:
            self.assertEqual(ev.dtend - ev.dtstart, timedelta(minutes=30))
        rids = {ev.recurrence_id for ev in events}
        self.assertEqual(len(rids), 5)
