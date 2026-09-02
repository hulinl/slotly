"""
Tests for M18a Google OAuth wiring.

We don't reach the actual Google endpoints — every external call is patched.
What we cover:
  - Fernet round-trip on tokens
  - /start refuses to redirect when OAuth credentials are blank (503)
  - /start signs a state we can verify
  - /callback rejects missing/invalid/expired/foreign state
  - /callback persists encrypted tokens on success (and on retry without a
    fresh refresh_token, falls back to the previous one)
  - get_credentials refreshes when expired and updates the row
"""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch

from django.core.signing import TimestampSigner
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone as djtz
from rest_framework.test import APIClient

from apps.accounts.models import User

from .google_client import _Credentials, get_credentials
from .models import GoogleAccount
from .security import decrypt, encrypt
from .views import _STATE_SALT


def _bake_state(user_pk: int) -> str:
    # Callback expects the "user:<pk>" discriminator introduced with the SSO
    # anon flow — the callback branches on this prefix to decide "link an
    # existing account" vs "create + login a new user".
    return TimestampSigner(salt=_STATE_SALT).sign(f"user:{user_pk}")


@override_settings(
    GOOGLE_OAUTH_CLIENT_ID="dev-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET="dev-client-secret",
    GOOGLE_OAUTH_REDIRECT_URI="http://localhost:8000/api/oauth/google/callback",
    FRONTEND_BASE_URL="http://localhost:3000",
)
class FernetRoundTripTests(TestCase):
    def test_encrypt_then_decrypt_returns_original(self) -> None:
        secret = "ya29.A0Af-fake-but-realistic-looking-token-string"
        cipher = encrypt(secret)
        self.assertNotEqual(cipher, secret)
        self.assertEqual(decrypt(cipher), secret)


@override_settings(
    GOOGLE_OAUTH_CLIENT_ID="",
    GOOGLE_OAUTH_CLIENT_SECRET="",
    FRONTEND_BASE_URL="http://localhost:3000",
)
class OAuthStartUnconfiguredTests(TestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(email="u@test.local", password="pwpw12345xyz")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_returns_503_when_client_secret_missing(self) -> None:
        resp = self.client.get(reverse("google-oauth-start"))
        self.assertEqual(resp.status_code, 503)
        self.assertIn("not configured", resp.json()["detail"].lower())


@override_settings(
    GOOGLE_OAUTH_CLIENT_ID="dev-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET="dev-client-secret",
    GOOGLE_OAUTH_REDIRECT_URI="http://localhost:8000/api/oauth/google/callback",
    FRONTEND_BASE_URL="http://localhost:3000",
)
class OAuthStartTests(TestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(email="u@test.local", password="pwpw12345xyz")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_redirects_to_google_with_signed_state(self) -> None:
        resp = self.client.get(reverse("google-oauth-start"))
        self.assertEqual(resp.status_code, 302)
        location = resp["Location"]
        self.assertIn("accounts.google.com/o/oauth2/v2/auth", location)
        self.assertIn("client_id=dev-client-id", location)
        self.assertIn("state=", location)
        # State must verify under the same salt and resolve back to our user.
        import urllib.parse
        params = urllib.parse.parse_qs(urllib.parse.urlsplit(location).query)
        state = params["state"][0]
        signed_pk = TimestampSigner(salt=_STATE_SALT).unsign(state, max_age=600)
        # State discriminator changed with SSO — "user:<pk>" for link-mode,
        # "anon" for signup-with-Google. Verify we're on the link branch.
        self.assertEqual(signed_pk, f"user:{self.user.pk}")


@override_settings(
    GOOGLE_OAUTH_CLIENT_ID="dev-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET="dev-client-secret",
    GOOGLE_OAUTH_REDIRECT_URI="http://localhost:8000/api/oauth/google/callback",
    FRONTEND_BASE_URL="http://localhost:3000",
)
class OAuthCallbackTests(TestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(email="cb@test.local", password="pwpw12345xyz")
        self.client = APIClient()

    def test_missing_state_redirects_with_error(self) -> None:
        resp = self.client.get(reverse("google-oauth-callback"))
        self.assertEqual(resp.status_code, 302)
        self.assertIn("google=error", resp["Location"])
        self.assertIn("reason=missing", resp["Location"])

    def test_invalid_state_signature(self) -> None:
        resp = self.client.get(
            reverse("google-oauth-callback"),
            {"code": "abc", "state": "tampered-not-signed"},
        )
        self.assertIn("google=error", resp["Location"])
        self.assertIn("state_invalid", resp["Location"])

    def test_google_consent_error_passes_through(self) -> None:
        resp = self.client.get(reverse("google-oauth-callback"), {"error": "access_denied"})
        self.assertIn("google=error", resp["Location"])
        self.assertIn("reason=access_denied", resp["Location"])

    def test_successful_exchange_persists_encrypted_tokens(self) -> None:
        state = _bake_state(self.user.pk)
        with patch("apps.scheduling.views.exchange_code") as mx, patch(
            "apps.scheduling.views.fetch_userinfo"
        ) as mu:
            mx.return_value = {
                "access_token": "AT-xyz",
                "refresh_token": "RT-xyz",
                "expires_in": 3600,
                "scope": "openid email https://www.googleapis.com/auth/calendar.events",
            }
            mu.return_value = {"email": "user@gmail.com"}
            resp = self.client.get(
                reverse("google-oauth-callback"),
                {"code": "AUTHCODE", "state": state},
            )
        self.assertEqual(resp.status_code, 302)
        self.assertIn("google=connected", resp["Location"])
        account = GoogleAccount.objects.get(user=self.user)
        self.assertEqual(account.google_email, "user@gmail.com")
        # Stored ciphertext must NOT equal the plaintext token.
        self.assertNotEqual(account.access_token_encrypted, "AT-xyz")
        self.assertEqual(decrypt(account.access_token_encrypted), "AT-xyz")
        self.assertEqual(decrypt(account.refresh_token_encrypted), "RT-xyz")

    def test_reconnect_without_new_refresh_token_keeps_old_one(self) -> None:
        # Seed an existing connect with a known refresh token.
        GoogleAccount.objects.create(
            user=self.user,
            google_email="user@gmail.com",
            access_token_encrypted=encrypt("OLD-AT"),
            refresh_token_encrypted=encrypt("OLD-RT"),
            expires_at=djtz.now() + timedelta(hours=1),
            scope="openid email",
        )
        state = _bake_state(self.user.pk)
        with patch("apps.scheduling.views.exchange_code") as mx, patch(
            "apps.scheduling.views.fetch_userinfo"
        ) as mu:
            # Google omits refresh_token on subsequent connects in some cases.
            mx.return_value = {
                "access_token": "NEW-AT",
                "expires_in": 3600,
                "scope": "openid email",
            }
            mu.return_value = {"email": "user@gmail.com"}
            resp = self.client.get(
                reverse("google-oauth-callback"),
                {"code": "AUTHCODE", "state": state},
            )
        self.assertIn("google=connected", resp["Location"])
        account = GoogleAccount.objects.get(user=self.user)
        # Old refresh token preserved, new access token written.
        self.assertEqual(decrypt(account.refresh_token_encrypted), "OLD-RT")
        self.assertEqual(decrypt(account.access_token_encrypted), "NEW-AT")


@override_settings(
    GOOGLE_OAUTH_CLIENT_ID="dev-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET="dev-client-secret",
)
class TokenRefreshHelperTests(TestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(email="r@test.local", password="pwpw12345xyz")

    def test_returns_existing_token_when_not_expired(self) -> None:
        GoogleAccount.objects.create(
            user=self.user,
            google_email="r@gmail.com",
            access_token_encrypted=encrypt("CURRENT-AT"),
            refresh_token_encrypted=encrypt("RT"),
            expires_at=djtz.now() + timedelta(minutes=30),
            scope="",
        )
        creds = get_credentials(self.user)
        self.assertIsInstance(creds, _Credentials)
        self.assertEqual(creds.access_token, "CURRENT-AT")

    def test_refreshes_when_expired_and_persists(self) -> None:
        GoogleAccount.objects.create(
            user=self.user,
            google_email="r@gmail.com",
            access_token_encrypted=encrypt("STALE-AT"),
            refresh_token_encrypted=encrypt("RT"),
            expires_at=djtz.now() - timedelta(minutes=1),
            scope="",
        )
        with patch("apps.scheduling.google_client.refresh_access_token") as mr:
            mr.return_value = {"access_token": "FRESH-AT", "expires_in": 3600}
            creds = get_credentials(self.user)
        self.assertEqual(creds.access_token, "FRESH-AT")
        account = GoogleAccount.objects.get(user=self.user)
        self.assertEqual(decrypt(account.access_token_encrypted), "FRESH-AT")
        # Refresh token unchanged because Google didn't rotate.
        self.assertEqual(decrypt(account.refresh_token_encrypted), "RT")


class StatusAndDisconnectTests(TestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(email="s@test.local", password="pwpw12345xyz")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_status_reports_disconnected_when_no_row(self) -> None:
        resp = self.client.get(reverse("google-account"))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"connected": False})

    def test_status_includes_email_when_connected(self) -> None:
        GoogleAccount.objects.create(
            user=self.user,
            google_email="me@gmail.com",
            access_token_encrypted=encrypt("AT"),
            refresh_token_encrypted=encrypt("RT"),
            expires_at=djtz.now() + timedelta(hours=1),
            scope="",
        )
        resp = self.client.get(reverse("google-account"))
        self.assertEqual(
            resp.json(),
            {"connected": True, "google_email": "me@gmail.com", "write_calendar_id": "primary"},
        )

    def test_disconnect_deletes_row(self) -> None:
        GoogleAccount.objects.create(
            user=self.user,
            google_email="me@gmail.com",
            access_token_encrypted=encrypt("AT"),
            refresh_token_encrypted=encrypt("RT"),
            expires_at=djtz.now() + timedelta(hours=1),
            scope="",
        )
        resp = self.client.delete(reverse("google-account"))
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(GoogleAccount.objects.filter(user=self.user).exists())


# ---------------------------------------------------------------------------
# Booking flows — public link + peer + booking-request approval.
#
# These exercise the code the user actually clicks through: the earlier
# `timezone.now()` NameError in PublicMeetingCreateView would have been
# caught by test_public_online_booking_creates_event on the very first run.
# ---------------------------------------------------------------------------

from django.contrib.auth import get_user_model  # noqa: E402
from django.core import mail  # noqa: E402

from .models import Booking, BookingRequest  # noqa: E402


def _connect_google(user):
    """Give `user` a GoogleAccount so _pick_write_provider picks Google."""
    return GoogleAccount.objects.create(
        user=user,
        google_email=user.email,
        access_token_encrypted=encrypt("AT"),
        refresh_token_encrypted=encrypt("RT"),
        expires_at=djtz.now() + timedelta(hours=1),
        scope="calendar.events calendar.readonly",
        write_calendar_id="primary",
    )


def _future_slot(hours_from_now: int = 24):
    start = djtz.now() + timedelta(hours=hours_from_now)
    end = start + timedelta(minutes=30)
    return start.isoformat(), end.isoformat()


class PublicMeetingOnlineTests(TestCase):
    """POST /api/public/meetings/<token> with kind='online' — the immediate
    booking path. Mocks the Google API layer; asserts the view wires all
    params through correctly and returns 201 with an event payload."""

    def setUp(self):
        UserModel = get_user_model()
        self.host = UserModel.objects.create_user(email="host@test.local", password="pwpw12345xyz")
        self.host.share_enabled = True
        self.host.save(update_fields=["share_enabled"])
        _connect_google(self.host)
        self.client = APIClient()

    def _post(self, **overrides):
        start, end = _future_slot()
        body = {
            "visitor_name": "Alice Visitor",
            "visitor_email": "alice@example.com",
            "start": start,
            "end": end,
            "kind": "online",
            "title": "Coffee chat",
        }
        body.update(overrides)
        return self.client.post(
            reverse("public-meetings-create", args=[str(self.host.share_token)]),
            body,
            format="json",
        )

    def test_online_booking_creates_event_and_returns_201(self):
        with patch("apps.scheduling.views.create_calendar_event") as mc:
            mc.return_value = {"id": "abc123", "htmlLink": "https://cal.google.com/e/abc123"}
            resp = self._post()
        self.assertEqual(resp.status_code, 201, resp.content)
        payload = resp.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["event"]["id"], "abc123")
        self.assertEqual(payload["event"]["provider"], "google")
        # Provider was called with the visitor as attendee, on the host's
        # write_calendar_id (default "primary"), with an online meeting.
        args, kwargs = mc.call_args
        self.assertEqual(args[0], self.host)
        self.assertEqual(kwargs["calendar_id"], "primary")
        self.assertEqual(kwargs["attendees"], ["alice@example.com"])
        self.assertTrue(kwargs.get("include_online_meeting", True))

    def test_unknown_token_returns_404(self):
        resp = self.client.post(
            reverse("public-meetings-create", args=["00000000-0000-0000-0000-000000000000"]),
            {},
            format="json",
        )
        self.assertEqual(resp.status_code, 404)

    def test_share_disabled_host_returns_404(self):
        self.host.share_enabled = False
        self.host.save(update_fields=["share_enabled"])
        resp = self._post()
        self.assertEqual(resp.status_code, 404)

    def test_missing_visitor_email_returns_400(self):
        resp = self._post(visitor_email="not-an-email")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("visitor_email", resp.json())

    def test_honeypot_returns_204_and_does_not_book(self):
        with patch("apps.scheduling.views.create_calendar_event") as mc:
            resp = self._post(hp="http://spam.example.com")
        self.assertEqual(resp.status_code, 204)
        mc.assert_not_called()

    def test_host_without_provider_returns_409(self):
        GoogleAccount.objects.filter(user=self.host).delete()
        resp = self._post()
        self.assertEqual(resp.status_code, 409)
        self.assertIn("hasn't set up", resp.json()["detail"])

    def test_past_slot_rejected(self):
        past_start = (djtz.now() - timedelta(hours=2)).isoformat()
        past_end = (djtz.now() - timedelta(hours=1)).isoformat()
        resp = self._post(start=past_start, end=past_end)
        self.assertEqual(resp.status_code, 400)


class PublicMeetingPhysicalTests(TestCase):
    """kind='physical' opens a BookingRequest for the host to approve —
    should never touch the calendar API on submission."""

    def setUp(self):
        UserModel = get_user_model()
        self.host = UserModel.objects.create_user(email="host@test.local", password="pwpw12345xyz")
        self.host.share_enabled = True
        self.host.save(update_fields=["share_enabled"])
        _connect_google(self.host)  # even with provider connected, physical waits
        self.client = APIClient()

    def test_physical_booking_creates_request_row_returns_202(self):
        start, end = _future_slot()
        with patch("apps.scheduling.views.create_calendar_event") as mc:
            resp = self.client.post(
                reverse("public-meetings-create", args=[str(self.host.share_token)]),
                {
                    "visitor_name": "Bob Guest",
                    "visitor_email": "bob@example.com",
                    "start": start,
                    "end": end,
                    "kind": "physical",
                    "location": "Café Slovanský dům, Prague",
                    "notes": "Would love to discuss the project.",
                },
                format="json",
            )
        self.assertEqual(resp.status_code, 202, resp.content)
        payload = resp.json()
        self.assertTrue(payload["pending"])
        mc.assert_not_called()  # no calendar event yet — pending approval
        req = BookingRequest.objects.get(pk=payload["request_id"])
        self.assertEqual(req.host, self.host)
        self.assertEqual(req.status, BookingRequest.Status.PENDING)
        self.assertEqual(req.location, "Café Slovanský dům, Prague")
        self.assertEqual(req.visitor_email, "bob@example.com")

    def test_physical_missing_location_returns_400(self):
        start, end = _future_slot()
        resp = self.client.post(
            reverse("public-meetings-create", args=[str(self.host.share_token)]),
            {
                "visitor_name": "Bob",
                "visitor_email": "bob@example.com",
                "start": start,
                "end": end,
                "kind": "physical",
                # location omitted
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("location", resp.json())


class BookingRequestDecideTests(TestCase):
    """Host approves / rejects a physical booking request."""

    def setUp(self):
        UserModel = get_user_model()
        self.host = UserModel.objects.create_user(email="host@test.local", password="pwpw12345xyz")
        _connect_google(self.host)
        self.client = APIClient()
        self.client.force_authenticate(self.host)
        self.req = BookingRequest.objects.create(
            host=self.host,
            visitor_name="Carol",
            visitor_email="carol@example.com",
            kind=BookingRequest.Kind.PHYSICAL,
            start_at=djtz.now() + timedelta(hours=48),
            end_at=djtz.now() + timedelta(hours=48, minutes=30),
            title="Coffee",
            location="Prague",
        )

    def test_approve_creates_event_and_marks_row(self):
        with patch("apps.scheduling.views.create_calendar_event") as mc:
            mc.return_value = {"id": "evt-1"}
            resp = self.client.post(
                reverse("booking-requests-decide", args=[self.req.pk]),
                {"decision": "approve"},
                format="json",
            )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.req.refresh_from_db()
        self.assertEqual(self.req.status, BookingRequest.Status.APPROVED)
        self.assertEqual(self.req.event_id, "evt-1")
        # Physical meetings don't include a Meet/Teams link, and the address
        # rides on the event's first-class `location` field (not stuffed
        # inside the free-text description) so Google/Outlook can generate
        # a Maps deep-link from it.
        _, kwargs = mc.call_args
        self.assertFalse(kwargs.get("include_online_meeting", True))
        self.assertEqual(kwargs["location"], "Prague")

    def test_reject_marks_row_and_emails_visitor(self):
        resp = self.client.post(
            reverse("booking-requests-decide", args=[self.req.pk]),
            {"decision": "reject", "note": "Sorry, conflict."},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.req.refresh_from_db()
        self.assertEqual(self.req.status, BookingRequest.Status.REJECTED)
        self.assertEqual(self.req.decision_note, "Sorry, conflict.")
        # The rejection email is best-effort — assert either it was sent or
        # the backend used a no-op backend without raising.
        recipients = [addr for m in mail.outbox for addr in m.to]
        # In tests EmailBackend is memory-locmem — mail should have been sent.
        self.assertIn("carol@example.com", recipients)

    def test_double_decide_is_idempotent(self):
        self.req.status = BookingRequest.Status.APPROVED
        self.req.save(update_fields=["status"])
        resp = self.client.post(
            reverse("booking-requests-decide", args=[self.req.pk]),
            {"decision": "approve"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)  # returns current state, no 409

    def test_only_host_can_decide(self):
        UserModel = get_user_model()
        other = UserModel.objects.create_user(email="other@test.local", password="pwpw12345xyz")
        self.client.force_authenticate(other)
        resp = self.client.post(
            reverse("booking-requests-decide", args=[self.req.pk]),
            {"decision": "approve"},
            format="json",
        )
        self.assertEqual(resp.status_code, 404)  # host-scoped queryset


class CreateEventPayloadTests(TestCase):
    """Regression tests for google_client.create_calendar_event — the JSON
    shape sent to Google matters (missing conferenceData → no Meet link,
    missing conferenceDataVersion → Google ignores the createRequest)."""

    def setUp(self):
        UserModel = get_user_model()
        self.user = UserModel.objects.create_user(email="c@test.local", password="pwpw12345xyz")
        _connect_google(self.user)

    def test_online_booking_requests_meet_link(self):
        from .google_client import create_calendar_event
        with patch("apps.scheduling.google_client.httpx.Client") as mc:
            instance = mc.return_value.__enter__.return_value
            instance.post.return_value.status_code = 200
            instance.post.return_value.json.return_value = {"id": "e1", "htmlLink": "x"}
            create_calendar_event(
                self.user,
                calendar_id="primary",
                summary="Test",
                description="",
                start_iso="2026-09-02T10:00:00+02:00",
                end_iso="2026-09-02T10:30:00+02:00",
                time_zone="Europe/Prague",
                attendees=["a@b.co"],
                include_online_meeting=True,
            )
        _, kwargs = instance.post.call_args
        self.assertEqual(kwargs["params"]["conferenceDataVersion"], "1")
        self.assertIn("conferenceData", kwargs["json"])
        self.assertEqual(
            kwargs["json"]["conferenceData"]["createRequest"]["conferenceSolutionKey"]["type"],
            "hangoutsMeet",
        )

    def test_physical_booking_skips_meet_link(self):
        from .google_client import create_calendar_event
        with patch("apps.scheduling.google_client.httpx.Client") as mc:
            instance = mc.return_value.__enter__.return_value
            instance.post.return_value.status_code = 200
            instance.post.return_value.json.return_value = {"id": "e2"}
            create_calendar_event(
                self.user,
                calendar_id="primary",
                summary="Test",
                description="",
                start_iso="2026-09-02T10:00:00+02:00",
                end_iso="2026-09-02T10:30:00+02:00",
                time_zone="Europe/Prague",
                attendees=["a@b.co"],
                include_online_meeting=False,
            )
        _, kwargs = instance.post.call_args
        self.assertNotIn("conferenceDataVersion", kwargs["params"])
        self.assertNotIn("conferenceData", kwargs["json"])


class PublicBookingManageTests(TestCase):
    """/api/public/bookings/<uuid> — visitor's cancel flow."""

    def setUp(self):
        UserModel = get_user_model()
        self.host = UserModel.objects.create_user(email="host@test.local", password="pwpw12345xyz")
        _connect_google(self.host)
        self.client = APIClient()
        self.booking = Booking.objects.create(
            host=self.host,
            provider=Booking.Provider.GOOGLE,
            calendar_id="primary",
            event_id="evt-xyz",
            visitor_name="Zoe",
            visitor_email="zoe@example.com",
            kind=Booking.Kind.ONLINE,
            title="Coffee chat",
            start_at=djtz.now() + timedelta(hours=48),
            end_at=djtz.now() + timedelta(hours=48, minutes=30),
        )

    def test_get_returns_booking_details(self):
        resp = self.client.get(
            reverse("public-booking-manage", args=[str(self.booking.uuid)]),
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["uuid"], str(self.booking.uuid))
        self.assertEqual(body["visitor_name"], "Zoe")
        self.assertEqual(body["status"], "confirmed")

    def test_get_unknown_uuid_returns_404(self):
        resp = self.client.get(
            reverse("public-booking-manage", args=["00000000-0000-0000-0000-000000000000"]),
        )
        self.assertEqual(resp.status_code, 404)

    def test_cancel_deletes_event_and_marks_row(self):
        with patch("apps.scheduling.views.delete_calendar_event") as md:
            resp = self.client.post(
                reverse("public-booking-manage", args=[str(self.booking.uuid)]),
                {"reason": "Conflict came up"},
                format="json",
            )
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CANCELLED)
        self.assertTrue(self.booking.cancelled_by_visitor)
        self.assertEqual(self.booking.cancellation_reason, "Conflict came up")
        md.assert_called_once()
        _, kwargs = md.call_args
        self.assertEqual(kwargs["calendar_id"], "primary")
        self.assertEqual(kwargs["event_id"], "evt-xyz")

    def test_cancel_is_idempotent(self):
        self.booking.status = Booking.Status.CANCELLED
        self.booking.save(update_fields=["status"])
        with patch("apps.scheduling.views.delete_calendar_event") as md:
            resp = self.client.post(
                reverse("public-booking-manage", args=[str(self.booking.uuid)]),
                {},
                format="json",
            )
        self.assertEqual(resp.status_code, 200)
        md.assert_not_called()

    def test_cancel_past_booking_returns_409(self):
        self.booking.start_at = djtz.now() - timedelta(hours=2)
        self.booking.end_at = djtz.now() - timedelta(hours=1)
        self.booking.save(update_fields=["start_at", "end_at"])
        resp = self.client.post(
            reverse("public-booking-manage", args=[str(self.booking.uuid)]),
            {},
            format="json",
        )
        self.assertEqual(resp.status_code, 409)

    def test_cancel_survives_provider_error(self):
        """If Google/MS refuses the delete (event already gone, grant broken,
        etc.) we still mark our row cancelled so the visitor sees success."""
        from .google_client import GoogleApiError
        with patch("apps.scheduling.views.delete_calendar_event") as md:
            md.side_effect = GoogleApiError(410, "gone")
            resp = self.client.post(
                reverse("public-booking-manage", args=[str(self.booking.uuid)]),
                {},
                format="json",
            )
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.CANCELLED)


class PublicBookingCreatesRowTests(TestCase):
    """POST /api/public/meetings/<token> now records a Booking row so the
    visitor can later cancel via /b/<uuid>. Covers the online path;
    physical goes through BookingRequestDecideView (tested separately)."""

    def setUp(self):
        UserModel = get_user_model()
        self.host = UserModel.objects.create_user(email="host@test.local", password="pwpw12345xyz")
        self.host.share_enabled = True
        self.host.save(update_fields=["share_enabled"])
        _connect_google(self.host)
        self.client = APIClient()

    def test_online_booking_creates_booking_row_with_manage_url(self):
        start, end = _future_slot()
        with patch("apps.scheduling.views.create_calendar_event") as mc:
            mc.return_value = {"id": "evt-abc"}
            resp = self.client.post(
                reverse("public-meetings-create", args=[str(self.host.share_token)]),
                {
                    "visitor_name": "Alice",
                    "visitor_email": "alice@example.com",
                    "start": start,
                    "end": end,
                    "kind": "online",
                },
                format="json",
            )
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertIn("manage_url", body)
        # A Booking row now exists tying visitor to the calendar event.
        bookings = Booking.objects.filter(host=self.host)
        self.assertEqual(bookings.count(), 1)
        booking = bookings.first()
        self.assertEqual(booking.visitor_email, "alice@example.com")
        self.assertEqual(booking.event_id, "evt-abc")
        self.assertIn(str(booking.uuid), body["manage_url"])
        # The manage URL is baked into the event description sent to Google.
        _, kwargs = mc.call_args
        self.assertIn(str(booking.uuid), kwargs["description"])


class MeetingCreateGroupTests(TestCase):
    """POST /api/meetings with multiple attendees — feeds the /search
    "book a group slot" flow. Also verifies the legacy single peer_user_id
    field still works so an old cached frontend doesn't hard-fail on us."""

    def setUp(self):
        UserModel = get_user_model()
        self.host = UserModel.objects.create_user(email="host@test.local", password="pwpw12345xyz")
        _connect_google(self.host)
        self.a = UserModel.objects.create_user(email="a@test.local", password="pwpw12345xyz")
        self.b = UserModel.objects.create_user(email="b@test.local", password="pwpw12345xyz")
        # Team membership so _can_view_peer passes for both attendees.
        from apps.teams.models import Team, Membership
        team = Team.objects.create(name="Squad")
        Membership.objects.create(team=team, user=self.host, role=Membership.Role.ADMIN)
        Membership.objects.create(team=team, user=self.a, role=Membership.Role.MEMBER)
        Membership.objects.create(team=team, user=self.b, role=Membership.Role.MEMBER)
        self.client = APIClient()
        self.client.force_authenticate(self.host)

    def test_group_booking_invites_every_attendee(self):
        start = (djtz.now() + timedelta(hours=24)).isoformat()
        end = (djtz.now() + timedelta(hours=24, minutes=30)).isoformat()
        with patch("apps.scheduling.views.create_calendar_event") as mc:
            mc.return_value = {"id": "e1"}
            resp = self.client.post(
                reverse("meetings-create"),
                {
                    "attendee_user_ids": [self.a.pk, self.b.pk],
                    "start": start,
                    "end": end,
                },
                format="json",
            )
        self.assertEqual(resp.status_code, 201, resp.content)
        _, kwargs = mc.call_args
        self.assertEqual(sorted(kwargs["attendees"]), sorted([self.a.email, self.b.email]))

    def test_legacy_peer_user_id_still_works(self):
        start = (djtz.now() + timedelta(hours=24)).isoformat()
        end = (djtz.now() + timedelta(hours=24, minutes=30)).isoformat()
        with patch("apps.scheduling.views.create_calendar_event") as mc:
            mc.return_value = {"id": "e2"}
            resp = self.client.post(
                reverse("meetings-create"),
                {"peer_user_id": self.a.pk, "start": start, "end": end},
                format="json",
            )
        self.assertEqual(resp.status_code, 201, resp.content)
        _, kwargs = mc.call_args
        self.assertEqual(kwargs["attendees"], [self.a.email])

    def test_self_stripped_from_attendees(self):
        start = (djtz.now() + timedelta(hours=24)).isoformat()
        end = (djtz.now() + timedelta(hours=24, minutes=30)).isoformat()
        with patch("apps.scheduling.views.create_calendar_event") as mc:
            mc.return_value = {"id": "e3"}
            resp = self.client.post(
                reverse("meetings-create"),
                {
                    "attendee_user_ids": [self.host.pk, self.a.pk],
                    "start": start,
                    "end": end,
                },
                format="json",
            )
        self.assertEqual(resp.status_code, 201, resp.content)
        _, kwargs = mc.call_args
        # Host is the calendar owner — inviting themselves is nonsense.
        self.assertEqual(kwargs["attendees"], [self.a.email])

    def test_empty_attendees_returns_400(self):
        start = (djtz.now() + timedelta(hours=24)).isoformat()
        end = (djtz.now() + timedelta(hours=24, minutes=30)).isoformat()
        resp = self.client.post(
            reverse("meetings-create"),
            {"attendee_user_ids": [], "start": start, "end": end},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)


class SendBookingRemindersCommandTests(TestCase):
    """`python manage.py send_booking_reminders` — cron entrypoint for the
    T-24h visitor reminder. Verifies (a) rows in the window get mailed and
    stamped, (b) already-reminded rows are skipped, (c) cancelled bookings
    are skipped, (d) dry-run touches neither mail nor DB."""

    def setUp(self):
        UserModel = get_user_model()
        self.host = UserModel.objects.create_user(
            email="host@test.local", password="pwpw12345xyz",
            first_name="Han", last_name="Solo",
        )
        # 24h from now → inside default window
        self.due = Booking.objects.create(
            host=self.host,
            provider=Booking.Provider.GOOGLE,
            calendar_id="primary",
            event_id="evt-due",
            visitor_name="Leia",
            visitor_email="leia@example.com",
            kind=Booking.Kind.ONLINE,
            title="Diplomacy",
            start_at=djtz.now() + timedelta(hours=24),
            end_at=djtz.now() + timedelta(hours=24, minutes=30),
        )
        # 5 days from now → outside window
        self.far = Booking.objects.create(
            host=self.host,
            provider=Booking.Provider.GOOGLE,
            calendar_id="primary",
            event_id="evt-far",
            visitor_email="chewie@example.com",
            start_at=djtz.now() + timedelta(days=5),
            end_at=djtz.now() + timedelta(days=5, hours=1),
        )
        # 24h but already reminded
        self.already = Booking.objects.create(
            host=self.host,
            provider=Booking.Provider.GOOGLE,
            calendar_id="primary",
            event_id="evt-already",
            visitor_email="lando@example.com",
            start_at=djtz.now() + timedelta(hours=24),
            end_at=djtz.now() + timedelta(hours=24, minutes=30),
            reminded_at=djtz.now(),
        )
        # 24h but cancelled — should not remind
        self.cxl = Booking.objects.create(
            host=self.host,
            provider=Booking.Provider.GOOGLE,
            calendar_id="primary",
            event_id="evt-cxl",
            visitor_email="wedge@example.com",
            start_at=djtz.now() + timedelta(hours=24),
            end_at=djtz.now() + timedelta(hours=24, minutes=30),
            status=Booking.Status.CANCELLED,
        )

    def test_command_reminds_due_bookings_only(self):
        from django.core.management import call_command
        from django.core import mail as _mail
        call_command("send_booking_reminders")
        recipients = {addr for m in _mail.outbox for addr in m.to}
        self.assertEqual(recipients, {"leia@example.com"})
        self.due.refresh_from_db()
        self.assertIsNotNone(self.due.reminded_at)
        # Others untouched
        self.already.refresh_from_db()
        self.far.refresh_from_db()
        self.cxl.refresh_from_db()
        # Already stayed already; far still null; cancelled still null.
        self.assertIsNone(self.far.reminded_at)
        self.assertIsNone(self.cxl.reminded_at)

    def test_dry_run_sends_no_mail_and_no_db_writes(self):
        from django.core.management import call_command
        from django.core import mail as _mail
        call_command("send_booking_reminders", "--dry-run")
        self.assertEqual(len(_mail.outbox), 0)
        self.due.refresh_from_db()
        self.assertIsNone(self.due.reminded_at)


class ProviderPickerTests(TestCase):
    """_pick_write_provider picks Google when both are connected, MS as
    fallback, None when neither. Direct unit test — cheap to run and covers
    a decision that changes the entire dispatch."""

    def setUp(self):
        UserModel = get_user_model()
        self.user = UserModel.objects.create_user(email="p@test.local", password="pwpw12345xyz")

    def test_none_when_no_provider_connected(self):
        from .views import _pick_write_provider
        self.assertIsNone(_pick_write_provider(self.user))

    def test_google_selected_when_only_google_connected(self):
        from .views import _pick_write_provider
        _connect_google(self.user)
        p = _pick_write_provider(self.user)
        self.assertIsNotNone(p)
        self.assertEqual(p.name, "google")
        self.assertEqual(p.write_calendar_id, "primary")
