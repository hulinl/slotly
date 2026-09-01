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

    # ID of the Google Calendar new events go into (both /people booking and
    # public /u/<token> booking write here). Defaults to "primary" — the
    # user's main calendar — so meetings work the moment they connect Google.
    # Configurable in /settings/integrations from the list of calendars the
    # user has writer/owner access to.
    write_calendar_id = models.CharField(max_length=1024, default="primary")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=("user",))]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.google_email}"


class BookingRequest(models.Model):
    """A visitor-submitted "please meet me" that needs host approval before
    it becomes a calendar event. Only used for the `physical` kind — online
    bookings go straight into the calendar (host has already committed to
    being bookable via their public link).

    ``requester_user`` is populated when the requester is a signed-in Slotly
    user (peer booking from /people/<id>); otherwise ``visitor_email`` and
    ``visitor_name`` identify them. ``event_id`` is filled once the host
    approves and we successfully create the calendar event, so we can link
    from the request row to the underlying event."""

    class Kind(models.TextChoices):
        PHYSICAL = "physical", "In person"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        CANCELLED = "cancelled", "Cancelled"

    host = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="booking_requests",
    )
    requester_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    visitor_name = models.CharField(max_length=120, blank=True)
    visitor_email = models.EmailField(blank=True)

    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.PHYSICAL)
    start_at = models.DateTimeField()
    end_at = models.DateTimeField()

    title = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)
    location = models.CharField(max_length=300, blank=True)

    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    decision_note = models.CharField(max_length=500, blank=True)
    event_id = models.CharField(max_length=256, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=("host", "status", "-created_at")),
        ]

    def __str__(self) -> str:
        return f"BookingRequest(host={self.host_id}, {self.status}, {self.start_at})"


class MicrosoftAccount(models.Model):
    """Per-user Microsoft (Graph) account linkage — mirror of GoogleAccount
    for Outlook/Microsoft 365 users. Same encryption scheme (same key), same
    field shape, so the surrounding code (public flag, booking dispatch,
    settings UI) can treat both providers with one abstraction.

    ``write_calendar_id`` empty string means "primary calendar" (Graph's
    ``/me/calendar/events`` endpoint); a non-empty value picks a specific
    calendar via ``/me/calendars/<id>/events``.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="microsoft_account",
    )
    microsoft_email = models.EmailField()

    access_token_encrypted = models.TextField()
    refresh_token_encrypted = models.TextField()
    expires_at = models.DateTimeField()
    scope = models.CharField(max_length=500, blank=True)

    write_calendar_id = models.CharField(max_length=1024, blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=("user",))]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.microsoft_email}"
