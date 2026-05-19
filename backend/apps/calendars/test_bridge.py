"""
Tests for the ICS bridge — rewriter (``bridge.py``) and the public endpoint
(``public_views.py``).

These cover the M25 fix: Outlook publishes feeds with Windows-style TZIDs
that Google ignores, which is why the bridge exists. The tests assert the
post-rewrite output is something Google's parser will accept.
"""

from __future__ import annotations

import re
from unittest.mock import patch

import icalendar
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from .bridge import rewrite_for_google
from .models import Calendar
from .security import encrypt_url
from apps.accounts.models import User


ICS_WINDOWS_TZID = """\
BEGIN:VCALENDAR
METHOD:PUBLISH
PRODID:Microsoft Exchange Server 2010
VERSION:2.0
X-WR-CALNAME:Calendar
BEGIN:VTIMEZONE
TZID:W. Europe Standard Time
BEGIN:STANDARD
DTSTART:16010101T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:morning@test
SUMMARY:Morning meeting
DTSTART;TZID=W. Europe Standard Time:20260519T070000
DTEND;TZID=W. Europe Standard Time:20260519T090000
END:VEVENT
BEGIN:VEVENT
UID:lunch@test
SUMMARY:Lunch
DTSTART;TZID=Central Europe Standard Time:20260519T120000
DTEND;TZID=Central Europe Standard Time:20260519T130000
END:VEVENT
BEGIN:VEVENT
UID:afternoon@test
SUMMARY:Afternoon
DTSTART;TZID=Central European Standard Time:20260519T150000
DTEND;TZID=Central European Standard Time:20260519T160000
END:VEVENT
END:VCALENDAR
"""


ICS_FLOATING = """\
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:floating@test
SUMMARY:No TZ
DTSTART:20260519T100000
DTEND:20260519T110000
END:VEVENT
END:VCALENDAR
"""


class RewriterTests(TestCase):
    def test_windows_tzids_are_replaced_with_iana(self) -> None:
        out = rewrite_for_google(ICS_WINDOWS_TZID, default_tz="Europe/Prague")
        remaining_windows = {
            m.group(1)
            for m in re.finditer(r";TZID=([^:;\r\n]+)", out)
            if "/" not in m.group(1)
        }
        self.assertEqual(remaining_windows, set(), "Windows TZIDs still present")

    def test_emits_one_vtimezone_per_iana_zone_used(self) -> None:
        out = rewrite_for_google(ICS_WINDOWS_TZID, default_tz="Europe/Prague")
        vtimezones = re.findall(r"BEGIN:VTIMEZONE\s+TZID:([^\r\n]+)", out)
        # Berlin (W. Europe), Budapest (Central Europe), Warsaw (Central European),
        # Prague (default fallback).
        self.assertIn("Europe/Berlin", vtimezones)
        self.assertIn("Europe/Budapest", vtimezones)
        self.assertIn("Europe/Warsaw", vtimezones)
        self.assertIn("Europe/Prague", vtimezones)

    def test_old_windows_vtimezone_is_dropped(self) -> None:
        out = rewrite_for_google(ICS_WINDOWS_TZID, default_tz="Europe/Prague")
        self.assertNotIn("W. Europe Standard Time", out)

    def test_x_wr_timezone_added_when_missing(self) -> None:
        out = rewrite_for_google(ICS_WINDOWS_TZID, default_tz="Europe/Prague")
        self.assertIn("X-WR-TIMEZONE:Europe/Prague", out)

    def test_event_content_passes_through(self) -> None:
        """SUMMARY, UID, etc. must survive the rewrite — bridge is a pipe."""
        out = rewrite_for_google(ICS_WINDOWS_TZID, default_tz="Europe/Prague")
        self.assertIn("Morning meeting", out)
        self.assertIn("UID:morning@test", out)

    def test_output_parses_as_valid_icalendar(self) -> None:
        out = rewrite_for_google(ICS_WINDOWS_TZID, default_tz="Europe/Prague")
        cal = icalendar.Calendar.from_ical(out)
        events = [c for c in cal.walk() if c.name == "VEVENT"]
        self.assertEqual(len(events), 3)
        # First event should resolve to CEST (+02:00) in May.
        morning = next(e for e in events if str(e.get("UID")) == "morning@test")
        dtstart = morning.get("DTSTART").dt
        self.assertEqual(dtstart.utcoffset().total_seconds(), 7200)

    def test_floating_times_pick_up_default_tz_via_x_wr(self) -> None:
        out = rewrite_for_google(ICS_FLOATING, default_tz="Europe/Prague")
        self.assertIn("X-WR-TIMEZONE:Europe/Prague", out)
        # No TZID parameter on the original floating event — must remain
        # unchanged (consumer will use X-WR-TIMEZONE as the calendar default).
        self.assertIn("DTSTART:20260519T100000", out)

    def test_unknown_input_passed_through_unmodified(self) -> None:
        garbage = "this is not a calendar"
        self.assertEqual(rewrite_for_google(garbage), garbage)


class PublicEndpointTests(TestCase):
    def setUp(self) -> None:
        cache.clear()
        self.user = User.objects.create_user(
            email="bridge-user@test.local",
            password="bridge-pass-xyz",
        )
        self.calendar = Calendar.objects.create(
            owner=self.user,
            name="Outlook",
            provider=Calendar.Provider.OUTLOOK,
            url_encrypted=encrypt_url("https://outlook.office365.com/owa/calendar/abc/def/calendar.ics"),
            bridge_enabled=True,
            bridge_token="bridge-test-token-must-be-at-least-16-chars",
            source_timezone="Europe/Prague",
        )

    def _bridge_url(self, token: str) -> str:
        return reverse("bridge-ics", kwargs={"token": token})

    def test_404_when_token_unknown(self) -> None:
        resp = self.client.get(self._bridge_url("definitely-not-a-real-token-12345"))
        self.assertEqual(resp.status_code, 404)

    def test_404_when_token_too_short(self) -> None:
        resp = self.client.get(self._bridge_url("short"))
        self.assertEqual(resp.status_code, 404)

    def test_404_when_bridge_disabled(self) -> None:
        self.calendar.bridge_enabled = False
        self.calendar.save(update_fields=["bridge_enabled"])
        resp = self.client.get(self._bridge_url(self.calendar.bridge_token))
        self.assertEqual(resp.status_code, 404)

    def test_502_when_source_resolves_to_private_ip(self) -> None:
        # Re-point the source to a host that resolves to a private address;
        # the SSRF guard must refuse it.
        self.calendar.url_encrypted = encrypt_url("http://localhost/calendar.ics")
        self.calendar.save(update_fields=["url_encrypted"])
        resp = self.client.get(self._bridge_url(self.calendar.bridge_token))
        self.assertEqual(resp.status_code, 502)

    def test_serves_rewritten_ics_on_success(self) -> None:
        # Patch the network fetch — we don't want the test suite hitting MS365.
        from apps.calendars import public_views

        with patch.object(public_views, "_fetch_source", return_value=(200, ICS_WINDOWS_TZID)):
            with patch.object(public_views, "_ssrf_safe", return_value=True):
                resp = self.client.get(self._bridge_url(self.calendar.bridge_token))

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "text/calendar; charset=utf-8")
        body = resp.content.decode("utf-8")
        # Windows TZIDs replaced.
        self.assertNotIn("W. Europe Standard Time", body)
        # IANA VTIMEZONE present.
        self.assertIn("Europe/Prague", body)
        # Event content survived.
        self.assertIn("Morning meeting", body)


class RotateTokenTests(TestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            email="rotator@test.local",
            password="rotator-pass-xyz",
        )
        self.calendar = Calendar.objects.create(
            owner=self.user,
            name="Outlook",
            provider=Calendar.Provider.OUTLOOK,
            url_encrypted=encrypt_url("https://example.com/calendar.ics"),
            bridge_enabled=True,
            bridge_token="rotate-test-token-must-be-at-least-16-chars",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_rotate_changes_token(self) -> None:
        old = self.calendar.bridge_token
        resp = self.client.post(
            f"/api/calendars/{self.calendar.pk}/rotate-bridge-token",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.calendar.refresh_from_db()
        self.assertNotEqual(self.calendar.bridge_token, old)
        self.assertGreaterEqual(len(self.calendar.bridge_token), 16)

    def test_rotate_rejected_when_bridge_disabled(self) -> None:
        self.calendar.bridge_enabled = False
        self.calendar.save(update_fields=["bridge_enabled"])
        resp = self.client.post(
            f"/api/calendars/{self.calendar.pk}/rotate-bridge-token",
        )
        self.assertEqual(resp.status_code, 400)
