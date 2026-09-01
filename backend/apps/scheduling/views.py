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
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
from django.http import HttpRequest, HttpResponseRedirect
from django.utils import timezone as djtz
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from . import graph_client as _graph
from .google_client import (
    GoogleApiError,
    GoogleNotConfigured,
    GoogleOAuthError,
    authorize_url,
    create_calendar_event,
    exchange_code,
    fetch_userinfo,
    list_writable_calendars,
)
from .models import BookingRequest, GoogleAccount, MicrosoftAccount
from .security import encrypt

logger = logging.getLogger(__name__)

_STATE_SALT = "scheduling.google_oauth.state"
_STATE_MAX_AGE = 60 * 10  # 10 minutes is plenty for a consent screen round-trip


def _signer() -> TimestampSigner:
    return TimestampSigner(salt=_STATE_SALT)


def _frontend_return(status: str, provider: str = "google", **extra: str) -> HttpResponseRedirect:
    """Bounce back to the frontend after the OAuth round-trip. The `anon`
    flag in `extra` picks the return path: anon=1 → /profile (SSO users
    land on their fresh account), anon=0 or missing → /settings/integrations
    (users mid-config get their success banner). `provider` names the
    integration in the query string ("google" or "microsoft") so the
    frontend can render provider-specific banners."""
    from urllib.parse import urlencode

    qs = urlencode({provider: status, **extra})
    path = "/profile" if extra.get("anon") == "1" else settings.GOOGLE_OAUTH_FRONTEND_RETURN
    base = settings.FRONTEND_BASE_URL.rstrip("/") + path
    return HttpResponseRedirect(f"{base}?{qs}")


class OAuthStartView(APIView):
    """
    GET /api/oauth/google/start[?anon=1]

    Two modes packed into one endpoint:

    - Authenticated call → link Google to the current user (existing "connect
      Calendar" flow used from /settings/integrations).
    - Anonymous call with ?anon=1 → "Sign in with Google": the callback
      creates or finds the User by verified Google email, logs them in, and
      stores the GoogleAccount in the same round-trip. One consent screen,
      no password step, no separate connect step.

    The state string carries the flow discriminator so the callback can
    branch without needing another cookie: ``user:<pk>`` for link-mode,
    ``anon`` for SSO.
    """

    permission_classes = [AllowAny]

    def get(self, request: Request) -> Any:
        anon = request.query_params.get("anon") == "1"
        if not anon and not request.user.is_authenticated:
            # Non-anon caller must be logged in; otherwise the callback would
            # have no user to attach the GoogleAccount to.
            return Response(
                {"detail": "Sign in first, or use ?anon=1 for SSO signup."},
                status=401,
            )
        try:
            state = _signer().sign("anon" if anon else f"user:{request.user.pk}")
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

    from apps.accounts.models import User  # local import — circular-safe

    # Determine the flow BEFORE exchanging the code so a malformed state
    # doesn't burn the authorization code (single-use, expires quickly).
    if unsigned == "anon":
        anon = True
        user = None
    elif unsigned.startswith("user:"):
        anon = False
        try:
            user_pk = int(unsigned[5:])
            user = User.objects.get(pk=user_pk)
        except (ValueError, User.DoesNotExist):
            return _frontend_return("error", reason="user_missing")
    else:
        return _frontend_return("error", reason="state_malformed")

    try:
        token_payload = exchange_code(code)
        userinfo = fetch_userinfo(token_payload["access_token"])
    except GoogleNotConfigured:
        return _frontend_return("error", reason="not_configured")
    except (GoogleOAuthError, KeyError) as exc:
        logger.info("Google OAuth callback failed (anon=%s): %s", anon, exc)
        return _frontend_return("error", reason="exchange_failed")

    google_email = (userinfo.get("email") or "").strip().lower()
    if not google_email:
        return _frontend_return("error", reason="no_email")

    if anon:
        # SSO signup or signin. Look up (or create) the Slotly user by the
        # verified Google email, mark the allauth EmailAddress row verified,
        # log in via the normal Django session backend, then fall through to
        # the shared GoogleAccount upsert below.
        from django.contrib.auth import login as _django_login
        from django.db import transaction

        with transaction.atomic():
            user, created = User.objects.get_or_create(
                email=google_email,
                defaults={
                    "first_name": (userinfo.get("given_name") or "")[:80],
                    "last_name": (userinfo.get("family_name") or "")[:80],
                },
            )
            if created:
                # SSO users don't have a Slotly password — they always come
                # back through Google. They can still set one via /auth/forgot
                # if they want a password-based fallback.
                user.set_unusable_password()
                user.save(update_fields=["password"])
            # allauth gates a lot of behavior on EmailAddress.verified; Google
            # already verified the mailbox for us, so mirror that in the row.
            try:
                from allauth.account.models import EmailAddress as _EA
                _EA.objects.update_or_create(
                    user=user,
                    email=google_email,
                    defaults={"verified": True, "primary": True},
                )
            except ImportError:  # allauth not installed — safe to skip
                pass
        # Attach the ModelBackend so django.contrib.auth.login doesn't need to
        # guess between our two configured auth backends.
        user.backend = "django.contrib.auth.backends.ModelBackend"
        _django_login(request, user)

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
            "google_email": google_email[:254],
            "access_token_encrypted": encrypt(access_token),
            "refresh_token_encrypted": refresh_encrypted,
            "expires_at": expires_at,
            "scope": token_payload.get("scope", "")[:500],
        },
    )
    # Anon flows go to /profile (welcome / next-step) rather than
    # /settings/integrations, which is meant for users who were mid-config.
    return _frontend_return("connected", email=google_email, anon="1" if anon else "0")


class GoogleAccountStatusView(APIView):
    """
    GET    /api/google-account   — returns {connected, google_email?, write_calendar_id?}
    PATCH  /api/google-account   — body {write_calendar_id} — set the write target
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
        return Response({
            "connected": True,
            "google_email": account.google_email,
            "write_calendar_id": account.write_calendar_id,
        })

    def patch(self, request: Request) -> Response:
        try:
            account = GoogleAccount.objects.get(user=request.user)
        except GoogleAccount.DoesNotExist:
            return Response({"detail": "Google Calendar is not connected."}, status=404)
        raw = request.data.get("write_calendar_id")
        if not isinstance(raw, str) or not raw.strip():
            return Response({"write_calendar_id": "Required non-empty string."}, status=400)
        # Validate that the chosen ID is one of the user's writable calendars —
        # otherwise events.insert would 404 later with a confusing message.
        try:
            calendars = list_writable_calendars(request.user)
        except (GoogleOAuthError, GoogleApiError) as exc:
            return Response({"detail": f"Google refused: {exc}"}, status=502)
        allowed = {c["id"] for c in calendars}
        if raw not in allowed:
            return Response(
                {"write_calendar_id": "Pick a calendar you have writer access to."},
                status=400,
            )
        account.write_calendar_id = raw
        account.save(update_fields=["write_calendar_id", "updated_at"])
        return Response({
            "connected": True,
            "google_email": account.google_email,
            "write_calendar_id": account.write_calendar_id,
        })

    def delete(self, request: Request) -> Response:
        GoogleAccount.objects.filter(user=request.user).delete()
        return Response(status=204)


class WritableCalendarsView(APIView):
    """
    GET /api/google-account/writable-calendars — the connected user's
    calendars the OAuth grant can write into (owner + writer). Feeds the
    settings dropdown for picking the write target.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        try:
            GoogleAccount.objects.get(user=request.user)
        except GoogleAccount.DoesNotExist:
            return Response({"detail": "Google Calendar is not connected."}, status=404)
        try:
            items = list_writable_calendars(request.user)
        except GoogleOAuthError as exc:
            # Refresh token was revoked / grant broken — nudge reconnect.
            return Response({"detail": f"Reconnect needed: {exc}"}, status=401)
        except GoogleApiError as exc:
            return Response({"detail": f"Google refused: {exc}"}, status=502)
        return Response({"calendars": items})


# ---------------------------------------------------------------------------
# Microsoft 365 / Outlook — mirror of the Google endpoints above.
# ---------------------------------------------------------------------------


_MS_STATE_SALT = "scheduling.microsoft_oauth.state"


def _ms_signer() -> TimestampSigner:
    return TimestampSigner(salt=_MS_STATE_SALT)


class MicrosoftOAuthStartView(APIView):
    """GET /api/oauth/microsoft/start[?anon=1] — see the Google twin for the
    two-mode explanation. Anon flow uses Microsoft's userinfo email to
    create / find the Slotly user."""

    permission_classes = [AllowAny]

    def get(self, request: Request) -> Any:
        anon = request.query_params.get("anon") == "1"
        if not anon and not request.user.is_authenticated:
            return Response(
                {"detail": "Sign in first, or use ?anon=1 for SSO signup."},
                status=401,
            )
        try:
            state = _ms_signer().sign("anon" if anon else f"user:{request.user.pk}")
            url = _graph.authorize_url(state)
        except _graph.MicrosoftNotConfigured:
            return Response(
                {"detail": "Microsoft 365 is not configured on this server."},
                status=503,
            )
        return HttpResponseRedirect(url)


@api_view(["GET"])
@permission_classes([])
def microsoft_oauth_callback(request: HttpRequest) -> HttpResponseRedirect:
    err = request.GET.get("error")
    if err:
        return _frontend_return("error", provider="microsoft", reason=err[:64])

    code = request.GET.get("code", "")
    state = request.GET.get("state", "")
    if not code or not state:
        return _frontend_return("error", provider="microsoft", reason="missing_code_or_state")

    try:
        unsigned = _ms_signer().unsign(state, max_age=_STATE_MAX_AGE)
    except SignatureExpired:
        return _frontend_return("error", provider="microsoft", reason="state_expired")
    except BadSignature:
        return _frontend_return("error", provider="microsoft", reason="state_invalid")

    from apps.accounts.models import User

    if unsigned == "anon":
        anon = True
        user = None
    elif unsigned.startswith("user:"):
        anon = False
        try:
            user_pk = int(unsigned[5:])
            user = User.objects.get(pk=user_pk)
        except (ValueError, User.DoesNotExist):
            return _frontend_return("error", provider="microsoft", reason="user_missing")
    else:
        return _frontend_return("error", provider="microsoft", reason="state_malformed")

    try:
        token_payload = _graph.exchange_code(code)
        userinfo = _graph.fetch_userinfo(token_payload["access_token"])
    except _graph.MicrosoftNotConfigured:
        return _frontend_return("error", provider="microsoft", reason="not_configured")
    except (_graph.MicrosoftOAuthError, KeyError) as exc:
        logger.info("MS OAuth callback failed (anon=%s): %s", anon, exc)
        return _frontend_return("error", provider="microsoft", reason="exchange_failed")

    ms_email = ((userinfo.get("mail") or userinfo.get("userPrincipalName") or "").strip().lower())
    if not ms_email:
        return _frontend_return("error", provider="microsoft", reason="no_email")

    if anon:
        from django.contrib.auth import login as _django_login
        from django.db import transaction

        with transaction.atomic():
            user, created = User.objects.get_or_create(
                email=ms_email,
                defaults={
                    "first_name": (userinfo.get("givenName") or "")[:80],
                    "last_name": (userinfo.get("surname") or "")[:80],
                },
            )
            if created:
                user.set_unusable_password()
                user.save(update_fields=["password"])
            try:
                from allauth.account.models import EmailAddress as _EA
                _EA.objects.update_or_create(
                    user=user,
                    email=ms_email,
                    defaults={"verified": True, "primary": True},
                )
            except ImportError:
                pass
        user.backend = "django.contrib.auth.backends.ModelBackend"
        _django_login(request, user)

    access_token = token_payload["access_token"]
    refresh_token = token_payload.get("refresh_token")
    if not refresh_token:
        existing = MicrosoftAccount.objects.filter(user=user).only("refresh_token_encrypted").first()
        if existing is None:
            return _frontend_return("error", provider="microsoft", reason="no_refresh_token")
        refresh_encrypted = existing.refresh_token_encrypted
    else:
        refresh_encrypted = encrypt(refresh_token)

    expires_in = int(token_payload.get("expires_in", 3600))
    expires_at = djtz.now() + timedelta(seconds=expires_in)

    MicrosoftAccount.objects.update_or_create(
        user=user,
        defaults={
            "microsoft_email": ms_email[:254],
            "access_token_encrypted": encrypt(access_token),
            "refresh_token_encrypted": refresh_encrypted,
            "expires_at": expires_at,
            "scope": token_payload.get("scope", "")[:500],
        },
    )
    return _frontend_return(
        "connected",
        provider="microsoft",
        email=ms_email,
        anon="1" if anon else "0",
    )


class MicrosoftAccountStatusView(APIView):
    """GET/PATCH/DELETE /api/microsoft-account — parallel of GoogleAccountStatusView."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        try:
            account = MicrosoftAccount.objects.get(user=request.user)
        except MicrosoftAccount.DoesNotExist:
            return Response({"connected": False})
        return Response({
            "connected": True,
            "microsoft_email": account.microsoft_email,
            "write_calendar_id": account.write_calendar_id,
        })

    def patch(self, request: Request) -> Response:
        try:
            account = MicrosoftAccount.objects.get(user=request.user)
        except MicrosoftAccount.DoesNotExist:
            return Response({"detail": "Microsoft is not connected."}, status=404)
        raw = request.data.get("write_calendar_id")
        # Empty string is valid — Graph treats /me/events as "primary calendar".
        if not isinstance(raw, str):
            return Response({"write_calendar_id": "Required string."}, status=400)
        try:
            calendars = _graph.list_writable_calendars(request.user)
        except (_graph.MicrosoftOAuthError, _graph.MicrosoftApiError) as exc:
            return Response({"detail": f"Microsoft refused: {exc}"}, status=502)
        allowed = {c["id"] for c in calendars}
        if raw and raw not in allowed:
            return Response(
                {"write_calendar_id": "Pick a calendar you have edit access to."},
                status=400,
            )
        account.write_calendar_id = raw
        account.save(update_fields=["write_calendar_id", "updated_at"])
        return Response({
            "connected": True,
            "microsoft_email": account.microsoft_email,
            "write_calendar_id": account.write_calendar_id,
        })

    def delete(self, request: Request) -> Response:
        MicrosoftAccount.objects.filter(user=request.user).delete()
        return Response(status=204)


class MicrosoftWritableCalendarsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        try:
            MicrosoftAccount.objects.get(user=request.user)
        except MicrosoftAccount.DoesNotExist:
            return Response({"detail": "Microsoft is not connected."}, status=404)
        try:
            items = _graph.list_writable_calendars(request.user)
        except _graph.MicrosoftOAuthError as exc:
            return Response({"detail": f"Reconnect needed: {exc}"}, status=401)
        except _graph.MicrosoftApiError as exc:
            return Response({"detail": f"Microsoft refused: {exc}"}, status=502)
        return Response({"calendars": items})


# ---------------------------------------------------------------------------
# Meeting creation
# ---------------------------------------------------------------------------


class MeetingCreateView(APIView):
    """
    POST /api/meetings
    body: {peer_user_id, start, end, title?, notes?}

    Creates an event on the caller's write_calendar_id (default: primary)
    and invites `peer_user_id` by email. Before insert, re-checks that both
    sides are free in [start, end] — a slot in the /people/<id> intersection
    view could have been consumed by an ICS sync between render and click.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        from django.conf import settings as _settings

        body = request.data or {}
        try:
            peer_id = int(body.get("peer_user_id"))
        except (TypeError, ValueError):
            return Response({"peer_user_id": "Required integer."}, status=400)
        try:
            start_dt = _parse_iso_dt(body.get("start", ""))
            end_dt = _parse_iso_dt(body.get("end", ""))
        except ValueError:
            return Response({"detail": "start/end must be ISO 8601 datetimes."}, status=400)
        if end_dt <= start_dt:
            return Response({"detail": "end must be after start."}, status=400)
        if (end_dt - start_dt) > timedelta(hours=12):
            return Response({"detail": "Meeting longer than 12 hours refused."}, status=400)

        from apps.accounts.models import User as _User
        peer = get_object_or_404(_User, pk=peer_id)
        if peer.pk == request.user.pk:
            return Response({"peer_user_id": "Pick a peer other than yourself."}, status=400)

        if not _can_view_peer(request.user, peer):
            return Response(
                {"detail": "You're not connected to this user."},
                status=403,
            )

        provider = _pick_write_provider(request.user)
        if provider is None:
            return Response(
                {"detail": "Connect a calendar in /settings/integrations first."},
                status=409,
            )

        # Re-check availability — one last defensive sweep against races.
        conflict_user = _first_busy_user([request.user, peer], start_dt, end_dt)
        if conflict_user is not None:
            who = "You are" if conflict_user.pk == request.user.pk else f"{conflict_user.first_name or 'The other person'} is"
            return Response(
                {"detail": f"{who} no longer free at that time — please pick another slot."},
                status=409,
            )

        title = _clean_text(body.get("title"), fallback=_default_title(peer), maxlen=200)
        notes = _clean_text(body.get("notes"), fallback="", maxlen=2000)

        try:
            event = provider.create_event(
                request.user,
                calendar_id=provider.write_calendar_id,
                summary=title,
                description=notes,
                start_iso=start_dt.isoformat(),
                end_iso=end_dt.isoformat(),
                time_zone=_settings.TIME_ZONE,
                attendees=[peer.email],
            )
        except (GoogleOAuthError, _graph.MicrosoftOAuthError) as exc:
            return Response({"detail": f"Reconnect calendar: {exc}"}, status=401)
        except (GoogleApiError, _graph.MicrosoftApiError) as exc:
            return Response({"detail": f"Calendar refused: {exc}"}, status=502)

        return Response({
            "ok": True,
            "event": {
                "id": event.get("id"),
                # htmlLink for Google, webLink for Graph — surface whichever
                # the provider returned so the frontend can link to the event.
                "html_link": event.get("htmlLink") or event.get("webLink"),
                "start": start_dt.isoformat(),
                "end": end_dt.isoformat(),
                "provider": provider.name,
            },
        }, status=201)


class PublicMeetingCreateView(APIView):
    """
    POST /api/public/meetings/<token>
    body: {visitor_name, visitor_email, start, end, title?, notes?, hp?}

    Unauthenticated: someone with the public share link books a slot in the
    host's calendar. The host must have Google connected. Rate-limited per
    token and per IP. A honeypot field (`hp`) must be empty — filled means
    a bot filled every text input and we drop silently.
    """

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def post(self, request: Request, token) -> Response:
        from django.conf import settings as _settings
        from apps.accounts.models import User as _User

        body = request.data or {}

        # Honeypot: bots typically fill every input. Return 204 so scripts
        # can't distinguish "spam blocked" from "success" and keep guessing.
        if (body.get("hp") or "").strip():
            return Response(status=204)

        user = _User.objects.filter(share_token=token, share_enabled=True).first()
        if user is None:
            return Response(status=404)

        # Rate limit — burst protection. Two axes:
        #   token bucket: caps abuse of one link (host's problem)
        #   IP bucket:    caps a single client hammering many links
        # Redis-backed cache (see settings.CACHES).
        from django.core.cache import cache as _cache
        minute = int(timezone.now().timestamp() // 60)
        ip = _client_ip(request)
        for key, limit in (
            (f"pubmeet:t:{token}:{minute}", 10),
            (f"pubmeet:ip:{ip}:{minute}", 20),
        ):
            count = _cache.get(key) or 0
            if count >= limit:
                return Response({"detail": "Too many requests. Please wait a minute."}, status=429)
            _cache.set(key, count + 1, timeout=120)

        visitor_name = _clean_text(body.get("visitor_name"), fallback="", maxlen=120)
        visitor_email = (body.get("visitor_email") or "").strip().lower()
        if not visitor_name:
            return Response({"visitor_name": "Please enter your name."}, status=400)
        if not _looks_like_email(visitor_email):
            return Response({"visitor_email": "Please enter a valid email."}, status=400)

        # `kind` splits the flow. Default "online" preserves the old
        # behavior. "physical" opens a BookingRequest for the host to
        # approve — the visitor gets a "waiting for approval" screen and
        # no calendar event is created yet.
        kind = (body.get("kind") or "online").strip().lower()
        if kind not in ("online", "physical"):
            return Response({"kind": "Must be 'online' or 'physical'."}, status=400)
        location = _clean_text(body.get("location"), fallback="", maxlen=300)
        if kind == "physical" and not location:
            return Response({"location": "Please tell the host where to meet."}, status=400)

        try:
            start_dt = _parse_iso_dt(body.get("start", ""))
            end_dt = _parse_iso_dt(body.get("end", ""))
        except ValueError:
            return Response({"detail": "start/end must be ISO 8601 datetimes."}, status=400)
        if end_dt <= start_dt:
            return Response({"detail": "end must be after start."}, status=400)
        if (end_dt - start_dt) > timedelta(hours=12):
            return Response({"detail": "Meeting longer than 12 hours refused."}, status=400)
        # Don't book into the past (with 2-min grace for clock skew).
        if end_dt < timezone.now() - timedelta(minutes=2):
            return Response({"detail": "Cannot book a slot in the past."}, status=400)

        # Physical meetings never touch the calendar directly — they go into
        # a pending BookingRequest. Host approves later, which triggers the
        # calendar event insertion (and shifts the visitor's slot to busy).
        if kind == "physical":
            default_title = f"Meeting with {visitor_name}"
            title = _clean_text(body.get("title"), fallback=default_title, maxlen=200)
            notes = _clean_text(body.get("notes"), fallback="", maxlen=2000)
            req = BookingRequest.objects.create(
                host=user,
                visitor_name=visitor_name,
                visitor_email=visitor_email,
                kind=BookingRequest.Kind.PHYSICAL,
                start_at=start_dt,
                end_at=end_dt,
                title=title,
                notes=notes,
                location=location,
            )
            _notify_booking_request(user, req)
            return Response({
                "ok": True,
                "pending": True,
                "request_id": req.pk,
            }, status=202)

        provider = _pick_write_provider(user)
        if provider is None:
            return Response(
                {"detail": "The host hasn't set up direct booking yet."},
                status=409,
            )

        conflict_user = _first_busy_user([user], start_dt, end_dt)
        if conflict_user is not None:
            return Response(
                {"detail": "That slot is no longer free — please pick another time."},
                status=409,
            )

        default_title = f"Meeting with {visitor_name}"
        title = _clean_text(body.get("title"), fallback=default_title, maxlen=200)
        notes_from_visitor = _clean_text(body.get("notes"), fallback="", maxlen=2000)
        description = f"Booked via your Slotly public link by {visitor_name} <{visitor_email}>."
        if notes_from_visitor:
            description += f"\n\nNote:\n{notes_from_visitor}"

        try:
            event = provider.create_event(
                user,
                calendar_id=provider.write_calendar_id,
                summary=title,
                description=description,
                start_iso=start_dt.isoformat(),
                end_iso=end_dt.isoformat(),
                time_zone=_settings.TIME_ZONE,
                attendees=[visitor_email],
            )
        except (GoogleOAuthError, _graph.MicrosoftOAuthError):
            return Response(
                {"detail": "The host's calendar connection needs a refresh — try again later."},
                status=502,
            )
        except (GoogleApiError, _graph.MicrosoftApiError) as exc:
            logger.info("public booking failed for user %s (%s): %s", user.pk, provider.name, exc)
            return Response(
                {"detail": "Couldn't create the event. Please try again."},
                status=502,
            )

        return Response({
            "ok": True,
            "event": {
                "id": event.get("id"),
                "start": start_dt.isoformat(),
                "end": end_dt.isoformat(),
                "provider": provider.name,
            },
        }, status=201)


# ---------------------------------------------------------------------------
# Booking requests — host-side approval flow for physical (in-person)
# meetings. Online bookings never touch this model; they hit the calendar
# API directly. Physical bookings live here until the host clicks approve
# in the UI, at which point we create the calendar event.
# ---------------------------------------------------------------------------


class BookingRequestListView(APIView):
    """GET /api/booking-requests[?status=pending|all]

    Returns the host's booking requests, newest first. Powers the /bookings
    page where the host sees pending physical-meeting requests and can
    approve or reject."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        status_filter = request.query_params.get("status", "pending")
        qs = BookingRequest.objects.filter(host=request.user).order_by("-created_at")
        if status_filter != "all":
            qs = qs.filter(status=status_filter)
        rows = [_serialize_booking_request(r) for r in qs[:100]]
        return Response({"requests": rows})


class BookingRequestDecideView(APIView):
    """POST /api/booking-requests/<id>/decide  body: {decision, note?}

    `decision` is "approve" or "reject". Approving a request creates the
    corresponding calendar event and mails the visitor a confirmation.
    Rejecting simply marks the row and emails the visitor a decline note.
    Idempotent on second call for the same terminal status — no-op."""

    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        req = get_object_or_404(BookingRequest, pk=pk, host=request.user)
        decision = (request.data.get("decision") or "").strip().lower()
        note = _clean_text(request.data.get("note"), fallback="", maxlen=500)

        if decision not in ("approve", "reject"):
            return Response({"decision": "Must be 'approve' or 'reject'."}, status=400)
        if req.status != BookingRequest.Status.PENDING:
            # Return the current state rather than 409 — makes the UI's
            # double-click safe.
            return Response(_serialize_booking_request(req))

        from django.conf import settings as _settings

        if decision == "approve":
            provider = _pick_write_provider(req.host)
            if provider is None:
                return Response(
                    {"detail": "Connect a calendar first — the request needs a home."},
                    status=409,
                )
            conflict_user = _first_busy_user([req.host], req.start_at, req.end_at)
            if conflict_user is not None:
                return Response(
                    {"detail": "You're no longer free at that time — reject and ask them to pick another slot."},
                    status=409,
                )
            description = (
                f"Booked via your Slotly public link by {req.visitor_name} <{req.visitor_email}>."
                + (f"\n\nLocation: {req.location}" if req.location else "")
                + (f"\n\nVisitor note:\n{req.notes}" if req.notes else "")
                + (f"\n\nYour note:\n{note}" if note else "")
            )
            try:
                event = provider.create_event(
                    req.host,
                    calendar_id=provider.write_calendar_id,
                    summary=req.title or f"Meeting with {req.visitor_name}",
                    description=description,
                    start_iso=req.start_at.isoformat(),
                    end_iso=req.end_at.isoformat(),
                    time_zone=_settings.TIME_ZONE,
                    attendees=[req.visitor_email],
                    # Physical meetings don't need an online meeting link.
                    include_online_meeting=False,
                )
            except (GoogleOAuthError, _graph.MicrosoftOAuthError):
                return Response(
                    {"detail": "Reconnect your calendar and try again."},
                    status=502,
                )
            except (GoogleApiError, _graph.MicrosoftApiError) as exc:
                logger.info("approve booking failed for req %s: %s", req.pk, exc)
                return Response(
                    {"detail": "Calendar refused the event. Try again."},
                    status=502,
                )
            req.status = BookingRequest.Status.APPROVED
            req.decided_at = timezone.now()
            req.decision_note = note
            req.event_id = event.get("id", "") or event.get("iCalUId", "")
            req.save(update_fields=["status", "decided_at", "decision_note", "event_id"])
        else:  # reject
            req.status = BookingRequest.Status.REJECTED
            req.decided_at = timezone.now()
            req.decision_note = note
            req.save(update_fields=["status", "decided_at", "decision_note"])
            _mail_visitor_rejection(req, note)

        return Response(_serialize_booking_request(req))


def _serialize_booking_request(r) -> dict:
    return {
        "id": r.pk,
        "kind": r.kind,
        "status": r.status,
        "start": r.start_at.isoformat(),
        "end": r.end_at.isoformat(),
        "title": r.title,
        "notes": r.notes,
        "location": r.location,
        "visitor_name": r.visitor_name,
        "visitor_email": r.visitor_email,
        "decision_note": r.decision_note,
        "created_at": r.created_at.isoformat(),
        "decided_at": r.decided_at.isoformat() if r.decided_at else None,
    }


def _notify_booking_request(host, req) -> None:
    from apps.notifications.dispatch import notify as _notify
    from apps.notifications.models import Notification as _N

    when = req.start_at.strftime("%a %d %b %H:%M")
    _notify(
        host,
        _N.Type.BOOKING_REQUEST_RECEIVED,
        {
            "request_id": req.pk,
            "visitor_name": req.visitor_name,
            "visitor_email": req.visitor_email,
            "when": when,
            "location": req.location,
        },
    )


def _mail_visitor_rejection(req, note: str) -> None:
    """Send the visitor a short "sorry, can't make it" email. Kept plain
    text and best-effort — booking approval must not fail because SMTP
    was flaky."""
    from django.conf import settings as _settings
    from django.core.mail import send_mail

    when = req.start_at.strftime("%A %d %B, %H:%M")
    subject = f"Your Slotly meeting request on {when} was declined"
    host_name = f"{req.host.first_name} {req.host.last_name}".strip() or req.host.email
    body = (
        f"Hi {req.visitor_name},\n\n"
        f"{host_name} isn't able to meet {when}."
    )
    if note:
        body += f"\n\nNote from {host_name}:\n{note}"
    body += "\n\nFeel free to pick another slot from their booking page."
    try:
        send_mail(
            subject=f"[Slotly] {subject}",
            message=body,
            from_email=_settings.DEFAULT_FROM_EMAIL,
            recipient_list=[req.visitor_email],
            fail_silently=True,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("visitor rejection mail failed for req %s: %s", req.pk, exc)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class _WriteProvider:
    """Uniform handle over Google vs. Microsoft. Booking code calls
    ``provider.create_event(user, ...)`` without caring which backend it
    dispatches to. Fields it needs: which provider name (for the response),
    which calendar to write into (each provider's own default sentinel),
    and the callable to invoke."""

    name: str
    write_calendar_id: str
    create_event: Any


def _pick_write_provider(user) -> _WriteProvider | None:
    """Choose which OAuth-connected provider should host the new event.
    Prefers Google when both are connected — arbitrary but stable, and
    the user can effectively override by disconnecting the one they don't
    want us writing into. Returns None when neither is connected."""
    g = GoogleAccount.objects.filter(user=user).only("write_calendar_id").first()
    if g is not None:
        return _WriteProvider(
            name="google",
            write_calendar_id=g.write_calendar_id or "primary",
            create_event=create_calendar_event,
        )
    m = MicrosoftAccount.objects.filter(user=user).only("write_calendar_id").first()
    if m is not None:
        return _WriteProvider(
            name="microsoft",
            write_calendar_id=m.write_calendar_id,  # empty = primary
            create_event=_graph.create_calendar_event,
        )
    return None


def _parse_iso_dt(value):
    """Accept an ISO 8601 datetime (with tz) or reject."""
    from datetime import datetime as _dt
    if not isinstance(value, str) or not value:
        raise ValueError("empty")
    parsed = _dt.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        # Treat naive as app-local so the frontend can send local ISO without tz.
        from django.conf import settings as _settings
        from zoneinfo import ZoneInfo
        parsed = parsed.replace(tzinfo=ZoneInfo(_settings.TIME_ZONE))
    return parsed


def _can_view_peer(caller, peer) -> bool:
    """Same visibility rule as /api/me/peer-availability: shared team OR
    accepted connection OR peer is publicly bookable."""
    from apps.connections.models import Connection as _Connection
    from apps.teams.models import Team as _Team
    if peer.pk == caller.pk:
        return True
    if _Team.objects.filter(memberships__user=caller).filter(memberships__user=peer).exists():
        return True
    if _Connection.are_connected(caller.pk, peer.pk):
        return True
    return bool(peer.share_enabled)


def _first_busy_user(users, start_dt, end_dt):
    """Return the first user in ``users`` whose calendar or unavailability
    overlaps [start_dt, end_dt), or None if all are free. Mirrors the busy
    aggregation used by the availability views."""
    from django.db.models import Q as _Q
    from apps.availability.models import Unavailability as _Un
    from apps.calendars.models import CalendarEvent as _CE

    ids = [u.pk for u in users]
    busy_ids = set()
    for ev in _CE.objects.filter(
        _Q(transp=_CE.Transparency.OPAQUE) | _Q(is_all_day=True),
        calendar__owner_id__in=ids,
        calendar__include_in_busy=True,
        dtstart__lt=end_dt,
        dtend__gt=start_dt,
    ).exclude(status=_CE.Status.CANCELLED).values("calendar__owner_id")[:1]:
        busy_ids.add(ev["calendar__owner_id"])
    if len(busy_ids) < len(ids):
        for u in _Un.objects.filter(
            user_id__in=ids,
            starts_at__lt=end_dt,
            ends_at__gt=start_dt,
        ).values("user_id")[:1]:
            busy_ids.add(u["user_id"])
    for u in users:
        if u.pk in busy_ids:
            return u
    return None


def _clean_text(value, *, fallback: str, maxlen: int) -> str:
    if not isinstance(value, str):
        return fallback
    v = value.strip()
    if not v:
        return fallback
    return v[:maxlen]


def _default_title(peer) -> str:
    name = f"{peer.first_name} {peer.last_name}".strip() or peer.email
    return f"Meeting with {name}"


def _looks_like_email(s: str) -> bool:
    # Rough — Django's EmailValidator would raise on invalid, but that pulls
    # in the whole validators module for a single call. Enough to reject
    # empty / malformed inputs; Google Calendar will further reject nonsense.
    import re as _re
    return bool(s) and bool(_re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", s))


def _client_ip(request) -> str:
    xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if xff:
        return xff.split(",")[0].strip()[:64]
    return (request.META.get("REMOTE_ADDR") or "unknown")[:64]


