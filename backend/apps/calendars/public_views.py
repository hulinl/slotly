"""
Public, unauthenticated ICS bridge endpoint.

Serves a timezone-normalized rebroadcast of a user's source calendar so that
consumers like Google Calendar (which insist on IANA TZIDs) display the
correct local times. The endpoint is intentionally unauthenticated — Google's
"From URL" feature can't carry credentials — and instead relies on a
high-entropy bridge_token in the URL path. Anyone holding the URL can read
the calendar, the same trust model as the underlying published Outlook feed.

The endpoint never persists fetched event data. It is a pure pipe.
"""

from __future__ import annotations

import hashlib
import ipaddress
import logging
import socket
from urllib.parse import urlsplit

import httpx
from django.core.cache import cache
from django.http import HttpRequest, HttpResponse, HttpResponseNotFound
from django.views.decorators.cache import cache_control
from django.views.decorators.http import require_GET

from .bridge import rewrite_for_google
from .models import Calendar
from .security import decrypt_url

logger = logging.getLogger(__name__)

# A token-scoped rate limit: keep generous because Google polls hours apart,
# but tight enough that a leaked token can't be used to hammer MS365 through
# us. Cache key is the token; the value is a sliding window of one minute.
_RATE_LIMIT_PER_MINUTE = 10
_RATE_LIMIT_TTL = 60

# Cache the *output* of a successful bridge fetch briefly so a curious viewer
# (or Google polling twice during a refresh) never sees an MS365 cold-start
# delay. Short TTL keeps changes propagating reasonably fast.
_BODY_CACHE_TTL = 300  # 5 minutes


def _is_public_ip(ip_str: str) -> bool:
    """True iff ``ip_str`` is a globally-routable address we'd let httpx hit."""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _ssrf_safe(url: str) -> bool:
    """
    Refuse URLs whose hostname resolves to a non-public address.

    The bridge handler is the only spot in Slotly where an external request
    URL is influenced by user-controlled state and then fired off in response
    to an *anonymous* HTTP request. Without this guard, the public endpoint
    becomes a tunnel for hitting internal services or cloud metadata.
    """
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        return False
    host = parts.hostname
    if not host:
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        addr = info[4][0]
        if not _is_public_ip(addr):
            return False
    return True


def _rate_limited(token: str) -> bool:
    key = f"bridge:rl:{token}"
    current = cache.get(key, 0)
    if current >= _RATE_LIMIT_PER_MINUTE:
        return True
    # Note the race window here is fine — at worst a token gets 1-2 extra
    # requests per minute under contention. Not worth Redis Lua.
    try:
        cache.set(key, current + 1, timeout=_RATE_LIMIT_TTL)
    except Exception:
        # If the cache is down, fail open. The endpoint is still gated by
        # token entropy and the SSRF guard.
        return False
    return False


def _fetch_source(url: str) -> tuple[int, str]:
    """Return (status_code, body). Status 0 on network error."""
    headers = {
        "User-Agent": "Slotly-Bridge/0.1 (+https://slotly.team)",
        "Accept": "text/calendar, application/octet-stream;q=0.5, */*;q=0.1",
    }
    try:
        with httpx.Client(timeout=60.0, follow_redirects=True) as client:
            response = client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        logger.info("bridge fetch failed: %s", exc.__class__.__name__)
        return 0, ""
    return response.status_code, response.text


@require_GET
@cache_control(public=True, max_age=900)
def bridge_ics(request: HttpRequest, token: str) -> HttpResponse:
    """
    GET /ics/<token>.ics — return the source feed with IANA-normalized
    timezones. 404 for unknown or disabled tokens, 429 when rate-limited,
    502 when the upstream feed can't be retrieved.
    """
    if not token or len(token) < 16:
        return HttpResponseNotFound()

    try:
        calendar = Calendar.objects.select_related("owner").get(
            bridge_token=token,
            bridge_enabled=True,
        )
    except Calendar.DoesNotExist:
        # Indistinguishable from "wrong token" — don't leak existence.
        return HttpResponseNotFound()

    if _rate_limited(token):
        return HttpResponse("rate limited", status=429, content_type="text/plain")

    # Serve from the cached body when possible. This avoids hitting MS365 on
    # every Google poll (and on every nervous user click of the URL).
    cache_key = f"bridge:body:{token}"
    cached = cache.get(cache_key)
    if cached is not None:
        body, etag = cached
        return _ics_response(body, etag)

    try:
        source_url = decrypt_url(calendar.url_encrypted)
    except ValueError:
        logger.error("bridge: decrypt failed for calendar %s", calendar.pk)
        return HttpResponse("bridge misconfigured", status=502, content_type="text/plain")

    if not _ssrf_safe(source_url):
        # The user pasted a URL that resolves to a private address. Refuse
        # rather than turning the endpoint into an SSRF gateway.
        logger.warning("bridge: refused non-public source for calendar %s", calendar.pk)
        return HttpResponse("source url not allowed", status=502, content_type="text/plain")

    status_code, body = _fetch_source(source_url)
    if status_code == 0 or status_code >= 400:
        return HttpResponse(
            f"upstream returned {status_code}", status=502, content_type="text/plain"
        )

    default_tz = calendar.source_timezone.strip() or "Europe/Prague"
    rewritten = rewrite_for_google(body, default_tz=default_tz)
    etag = hashlib.sha256(rewritten.encode("utf-8")).hexdigest()[:32]

    try:
        cache.set(cache_key, (rewritten, etag), timeout=_BODY_CACHE_TTL)
    except Exception:
        pass

    return _ics_response(rewritten, etag)


def _ics_response(body: str, etag: str) -> HttpResponse:
    response = HttpResponse(body, content_type="text/calendar; charset=utf-8")
    response["ETag"] = f'"{etag}"'
    response["Content-Disposition"] = 'inline; filename="calendar.ics"'
    return response
