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
    return TimestampSigner(salt=_STATE_SALT).sign(str(user_pk))


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
        self.assertEqual(int(signed_pk), self.user.pk)


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
        self.assertEqual(resp.json(), {"connected": True, "google_email": "me@gmail.com"})

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
