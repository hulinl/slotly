"""
Serializers for the Calendar resource. The plaintext URL only ever travels
inbound (POST/PATCH); responses never include it. Other PII never enters
the model in the first place (CalendarEvent has no such fields).
"""

from __future__ import annotations

import re
import secrets
from urllib.parse import urlsplit, urlunsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.urls import reverse
from rest_framework import serializers

from .models import Calendar
from .security import encrypt_url

_ALLOWED_SCHEMES = {"http", "https", "webcal"}
_HOST_PROVIDER_HINTS: dict[str, str] = {
    "calendar.google.com": Calendar.Provider.GOOGLE,
    "p01-caldav.icloud.com": Calendar.Provider.APPLE,
    "p02-caldav.icloud.com": Calendar.Provider.APPLE,
    "p03-caldav.icloud.com": Calendar.Provider.APPLE,
    "p04-caldav.icloud.com": Calendar.Provider.APPLE,
    "p05-caldav.icloud.com": Calendar.Provider.APPLE,
    "outlook.office365.com": Calendar.Provider.OUTLOOK,
    "outlook.live.com": Calendar.Provider.OUTLOOK,
}


def _normalize_url(value: str) -> str:
    """Lowercase scheme/host, force webcal:// → https:// (per PRD §5.2)."""
    parts = urlsplit(value.strip())
    if parts.scheme.lower() == "webcal":
        parts = parts._replace(scheme="https")
    if parts.scheme.lower() not in _ALLOWED_SCHEMES:
        raise serializers.ValidationError(
            f"Unsupported URL scheme {parts.scheme!r}; expected http(s) or webcal",
        )
    return urlunsplit(parts)


def _detect_provider(url: str) -> str:
    host = urlsplit(url).hostname or ""
    if "google" in host:
        return Calendar.Provider.GOOGLE
    if "icloud" in host or "calendar.icloud" in host:
        return Calendar.Provider.APPLE
    if "outlook" in host or "office" in host or "live.com" in host:
        return Calendar.Provider.OUTLOOK
    return Calendar.Provider.OTHER


def _validate_iana_tz(value: str) -> str:
    """Return ``value`` if it is an IANA zone, raise otherwise. Empty allowed."""
    if not value:
        return ""
    try:
        ZoneInfo(value)
    except ZoneInfoNotFoundError as exc:
        raise serializers.ValidationError(
            f"Unknown IANA timezone: {value!r}",
        ) from exc
    return value


def _bridge_url(calendar: Calendar, request) -> str | None:
    """Absolute /ics/<token>.ics URL when the bridge is enabled, else None."""
    if not (calendar.bridge_enabled and calendar.bridge_token):
        return None
    path = reverse("bridge-ics", kwargs={"token": calendar.bridge_token})
    if request is not None:
        return request.build_absolute_uri(path)
    return path


class CalendarReadSerializer(serializers.ModelSerializer):
    """What the API exposes outbound — never the URL."""

    bridge_url = serializers.SerializerMethodField()

    class Meta:
        model = Calendar
        fields = (
            "id",
            "name",
            "provider",
            "include_in_busy",
            "status",
            "last_synced_at",
            "last_error",
            "consecutive_failures",
            "created_at",
            "bridge_enabled",
            "bridge_url",
            "source_timezone",
        )
        read_only_fields = fields

    def get_bridge_url(self, obj: Calendar) -> str | None:
        return _bridge_url(obj, self.context.get("request"))


class CalendarCreateSerializer(serializers.ModelSerializer):
    url = serializers.CharField(write_only=True, max_length=2000)

    class Meta:
        model = Calendar
        fields = ("id", "name", "url", "include_in_busy")
        read_only_fields = ("id",)

    def validate_url(self, value: str) -> str:
        return _normalize_url(value)

    def validate_name(self, value: str) -> str:
        v = (value or "").strip()
        if not v:
            raise serializers.ValidationError("Name is required")
        return v[:200]

    def create(self, validated_data: dict) -> Calendar:
        owner = self.context["request"].user
        plaintext_url: str = validated_data.pop("url")
        return Calendar.objects.create(
            owner=owner,
            url_encrypted=encrypt_url(plaintext_url),
            provider=_detect_provider(plaintext_url),
            **validated_data,
        )


class CalendarUpdateSerializer(serializers.ModelSerializer):
    """
    Allow flipping include_in_busy, renaming, and toggling the bridge.
    URL changes still go through delete+create — the URL is encrypted and we
    don't want to thread a re-encrypt path through PATCH.
    """

    class Meta:
        model = Calendar
        fields = ("name", "include_in_busy", "bridge_enabled", "source_timezone")

    def validate_source_timezone(self, value: str) -> str:
        return _validate_iana_tz((value or "").strip())

    def update(self, instance: Calendar, validated_data: dict) -> Calendar:
        # Allocate a token the first time the bridge is enabled. Reuse the
        # existing token on toggles so the user's pasted URL in Google keeps
        # working after a disable/enable cycle.
        if validated_data.get("bridge_enabled") and not instance.bridge_token:
            instance.bridge_token = secrets.token_urlsafe(24)
        return super().update(instance, validated_data)
