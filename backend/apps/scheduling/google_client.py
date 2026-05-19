"""
Thin wrapper around Google's OAuth + Calendar API.

We avoid the heavy `google-auth` / `google-api-python-client` stack — the
calls we need (token exchange, token refresh, events.insert, freeBusy) are
straightforward HTTPS POSTs to documented endpoints. Keeping it as httpx
saves ~30MB of dependencies and surface area.

Public entry points:
  - exchange_code(code, redirect_uri) -> dict          (M18a callback)
  - refresh_access_token(refresh_token) -> dict        (M18a, called by helper)
  - get_credentials(user) -> _Credentials              (M18b — picks up DB row,
                                                        refreshes if expired,
                                                        persists new token)
  - bearer_session(creds) -> httpx.Client              (M18b)

The module is self-contained and importable without Google secrets being
configured; configuration is only checked at call time, so unit tests that
mock the wrapper functions don't need env to be set.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
from django.conf import settings
from django.utils import timezone as djtz

from .models import GoogleAccount
from .security import decrypt, encrypt

logger = logging.getLogger(__name__)


GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"


class GoogleNotConfigured(RuntimeError):
    """GOOGLE_OAUTH_CLIENT_ID/SECRET are blank — connect/booking endpoints
    must return a clear 503 rather than letting the request reach Google
    and fail opaquely."""


class GoogleOAuthError(RuntimeError):
    """Token exchange or refresh failed — typically a revoked grant. The
    caller is expected to delete the GoogleAccount row and prompt the user
    to reconnect."""


def _require_client() -> tuple[str, str]:
    cid = settings.GOOGLE_OAUTH_CLIENT_ID
    csecret = settings.GOOGLE_OAUTH_CLIENT_SECRET
    if not cid or not csecret:
        raise GoogleNotConfigured(
            "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set"
        )
    return cid, csecret


def authorize_url(state: str) -> str:
    """Build the Google consent URL the user is redirected to from /start."""
    cid, _ = _require_client()
    from urllib.parse import urlencode

    params = {
        "client_id": cid,
        "redirect_uri": settings.GOOGLE_OAUTH_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(settings.GOOGLE_OAUTH_SCOPES),
        # offline + prompt=consent guarantee a refresh_token on first connect
        # and on reconnect after a revoke.
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{GOOGLE_AUTHORIZE_URL}?{urlencode(params)}"


def exchange_code(code: str) -> dict:
    """
    Trade an authorization code for tokens. Returns the raw Google JSON:
      {access_token, refresh_token, expires_in, scope, token_type, id_token}
    Caller is responsible for fetching userinfo for the email.
    """
    cid, csecret = _require_client()
    payload = {
        "code": code,
        "client_id": cid,
        "client_secret": csecret,
        "redirect_uri": settings.GOOGLE_OAUTH_REDIRECT_URI,
        "grant_type": "authorization_code",
    }
    with httpx.Client(timeout=20.0) as client:
        r = client.post(GOOGLE_TOKEN_URL, data=payload)
    if r.status_code != 200:
        logger.info("Google token exchange failed: %s %s", r.status_code, r.text[:200])
        raise GoogleOAuthError(f"token exchange returned {r.status_code}")
    return r.json()


def refresh_access_token(refresh_token: str) -> dict:
    """Get a fresh access_token. Returns Google JSON (no refresh_token unless
    Google decides to rotate it). Raises if the grant was revoked."""
    cid, csecret = _require_client()
    payload = {
        "client_id": cid,
        "client_secret": csecret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }
    with httpx.Client(timeout=20.0) as client:
        r = client.post(GOOGLE_TOKEN_URL, data=payload)
    if r.status_code == 400:
        # Most common payload here is {"error":"invalid_grant"} → revoked.
        raise GoogleOAuthError(f"refresh denied: {r.text[:200]}")
    if r.status_code != 200:
        raise GoogleOAuthError(f"refresh returned {r.status_code}: {r.text[:200]}")
    return r.json()


def fetch_userinfo(access_token: str) -> dict:
    """Pull the user's profile (specifically `email`) using a freshly-issued
    access token. Used by the OAuth callback to label the GoogleAccount."""
    with httpx.Client(timeout=20.0) as client:
        r = client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if r.status_code != 200:
        raise GoogleOAuthError(f"userinfo returned {r.status_code}")
    return r.json()


@dataclass(slots=True)
class _Credentials:
    """In-memory snapshot of a usable Google access token."""

    access_token: str
    expires_at: datetime


def get_credentials(user, *, refresh_grace: timedelta = timedelta(seconds=60)) -> _Credentials:
    """
    Resolve a usable access token for ``user``. Refreshes the stored token
    via Google when within ``refresh_grace`` of expiry, persisting the new
    access_token + expires_at in the DB. Raises if no GoogleAccount or if
    the refresh was rejected (caller should delete the row + reconnect).
    """
    try:
        account = GoogleAccount.objects.get(user=user)
    except GoogleAccount.DoesNotExist as exc:
        raise GoogleOAuthError("user has no connected Google account") from exc

    if account.expires_at > djtz.now() + refresh_grace:
        return _Credentials(
            access_token=decrypt(account.access_token_encrypted),
            expires_at=account.expires_at,
        )

    # Token is expired or about to be — exchange the refresh token.
    refresh_plain = decrypt(account.refresh_token_encrypted)
    payload = refresh_access_token(refresh_plain)
    new_access = payload["access_token"]
    expires_in = int(payload.get("expires_in", 3600))
    new_expires_at = djtz.now() + timedelta(seconds=expires_in)
    # Google may rotate the refresh token (rare, but possible).
    new_refresh = payload.get("refresh_token", refresh_plain)

    GoogleAccount.objects.filter(pk=account.pk).update(
        access_token_encrypted=encrypt(new_access),
        refresh_token_encrypted=encrypt(new_refresh),
        expires_at=new_expires_at,
    )
    return _Credentials(access_token=new_access, expires_at=new_expires_at)


def bearer_session(creds: _Credentials) -> httpx.Client:
    """A short-lived httpx client preconfigured with the user's bearer token.
    The caller is responsible for closing it (``with`` block recommended)."""
    return httpx.Client(
        base_url="https://www.googleapis.com",
        headers={"Authorization": f"Bearer {creds.access_token}"},
        timeout=30.0,
    )
