"""
Per-user Google account linkage for booking-into-Google flows.

Stores the OAuth tokens needed to call `events.insert` on the user's primary
Google Calendar. Both access and refresh tokens are Fernet-encrypted at rest
— anyone reading the raw row gets ciphertext, not credentials. The encryption
key is the same `CALENDAR_URL_ENCRYPTION_KEY` used by apps.calendars (a
single key keeps the deploy surface small; can be split later if the threat
model demands it).
"""

from __future__ import annotations

from django.conf import settings
from django.db import models


class GoogleAccount(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="google_account",
    )
    # Email of the linked Google identity. May differ from the user's Slotly
    # email — we display this so the user can see *which* Google account is
    # currently authorised.
    google_email = models.EmailField()

    access_token_encrypted = models.TextField()
    refresh_token_encrypted = models.TextField()
    # UTC instant after which the access token is considered stale. Refreshed
    # opportunistically via `google_client.get_credentials`.
    expires_at = models.DateTimeField()
    # OAuth scope actually granted (Google may grant less than requested).
    scope = models.CharField(max_length=500, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=("user",))]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.google_email}"
