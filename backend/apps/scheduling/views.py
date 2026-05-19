"""
M18a — Google OAuth connect endpoints + status/disconnect API.

Flow:
  1. Frontend opens /api/oauth/google/start in a new tab.
  2. We mint a signed state (binds the user's PK so the callback knows whose
     row to write), and 302 the browser to Google's consent screen.
  3. Google bounces back to /api/oauth/google/callback with `code` + `state`.
  4. We verify the state, exchange the code for tokens, fetch userinfo,
     persist the GoogleAccount, then 302 the browser to the frontend with
     a status flag.

The status + disconnect endpoints are plain JSON, used by /settings/integrations.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
from django.http import HttpRequest, HttpResponseRedirect
from django.utils import timezone as djtz
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .google_client import (
    GoogleNotConfigured,
    GoogleOAuthError,
    authorize_url,
    exchange_code,
    fetch_userinfo,
)
from .models import GoogleAccount
from .security import encrypt

logger = logging.getLogger(__name__)

_STATE_SALT = "scheduling.google_oauth.state"
_STATE_MAX_AGE = 60 * 10  # 10 minutes is plenty for a consent screen round-trip


def _signer() -> TimestampSigner:
    return TimestampSigner(salt=_STATE_SALT)


def _frontend_return(status: str, **extra: str) -> HttpResponseRedirect:
    """Bounce back to the frontend integrations page with a result flag."""
    from urllib.parse import urlencode

    qs = urlencode({"google": status, **extra})
    base = settings.FRONTEND_BASE_URL.rstrip("/") + settings.GOOGLE_OAUTH_FRONTEND_RETURN
    return HttpResponseRedirect(f"{base}?{qs}")


class OAuthStartView(APIView):
    """
    GET /api/oauth/google/start
    Authenticated. Returns a 302 redirect to Google's authorize URL.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Any:
        try:
            state = _signer().sign(str(request.user.pk))
            url = authorize_url(state)
        except GoogleNotConfigured:
            return Response(
                {"detail": "Google Calendar is not configured on this server."},
                status=503,
            )
        return HttpResponseRedirect(url)


@api_view(["GET"])
@permission_classes([])  # Public — Google calls this on the user's behalf.
def oauth_callback(request: HttpRequest) -> HttpResponseRedirect:
    """
    GET /api/oauth/google/callback?code=...&state=...&error=...
    Unauthenticated (Google can't send our session cookie); the signed state
    carries the user id we want to write to.
    """
    err = request.GET.get("error")
    if err:
        # User declined consent, or Google rejected. Surface to frontend.
        return _frontend_return("error", reason=err[:64])

    code = request.GET.get("code", "")
    state = request.GET.get("state", "")
    if not code or not state:
        return _frontend_return("error", reason="missing_code_or_state")

    try:
        unsigned = _signer().unsign(state, max_age=_STATE_MAX_AGE)
    except SignatureExpired:
        return _frontend_return("error", reason="state_expired")
    except BadSignature:
        return _frontend_return("error", reason="state_invalid")

    try:
        user_pk = int(unsigned)
    except ValueError:
        return _frontend_return("error", reason="state_malformed")

    from apps.accounts.models import User  # local import — circular-safe

    try:
        user = User.objects.get(pk=user_pk)
    except User.DoesNotExist:
        return _frontend_return("error", reason="user_missing")

    try:
        token_payload = exchange_code(code)
        userinfo = fetch_userinfo(token_payload["access_token"])
    except GoogleNotConfigured:
        return _frontend_return("error", reason="not_configured")
    except (GoogleOAuthError, KeyError) as exc:
        logger.info("Google OAuth callback failed for user %s: %s", user_pk, exc)
        return _frontend_return("error", reason="exchange_failed")

    access_token = token_payload["access_token"]
    refresh_token = token_payload.get("refresh_token")
    if not refresh_token:
        # Without offline+prompt=consent we wouldn't get one. Defensive: if a
        # second connect somehow lacks it, keep the previously stored refresh
        # token so we don't lock the user out.
        existing = GoogleAccount.objects.filter(user=user).only("refresh_token_encrypted").first()
        if existing is None:
            return _frontend_return("error", reason="no_refresh_token")
        refresh_encrypted = existing.refresh_token_encrypted
    else:
        refresh_encrypted = encrypt(refresh_token)

    expires_in = int(token_payload.get("expires_in", 3600))
    expires_at = djtz.now() + timedelta(seconds=expires_in)

    GoogleAccount.objects.update_or_create(
        user=user,
        defaults={
            "google_email": userinfo.get("email", "")[:254],
            "access_token_encrypted": encrypt(access_token),
            "refresh_token_encrypted": refresh_encrypted,
            "expires_at": expires_at,
            "scope": token_payload.get("scope", "")[:500],
        },
    )
    return _frontend_return("connected", email=userinfo.get("email", ""))


class GoogleAccountStatusView(APIView):
    """
    GET    /api/google-account   — returns {connected, google_email?}
    DELETE /api/google-account   — disconnects (deletes the row; doesn't
                                    revoke the grant Google-side, user can
                                    do that from myaccount.google.com)
    """

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        try:
            account = GoogleAccount.objects.get(user=request.user)
        except GoogleAccount.DoesNotExist:
            return Response({"connected": False})
        return Response({"connected": True, "google_email": account.google_email})

    def delete(self, request: Request) -> Response:
        GoogleAccount.objects.filter(user=request.user).delete()
        return Response(status=204)
