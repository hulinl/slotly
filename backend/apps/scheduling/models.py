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

import uuid

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


class MeetingType(models.Model):
    """Host-defined preset a visitor picks *before* they see any slots.

    Calendly's core UX primitive: instead of "pick any free time for as
    long as you want", the visitor sees a list of options ("15-min chat",
    "30-min demo", "60-min deep dive") and each one locks the booking to
    a specific duration, kind (online/physical), and — for physical — a
    default location. Optional: hosts who don't define any types keep
    the generic flow (visitor picks duration in the dialog).
    """

    class Kind(models.TextChoices):
        ONLINE = "online", "Online"
        PHYSICAL = "physical", "In person"

    host = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="meeting_types",
    )
    name = models.CharField(max_length=80)
    slug = models.SlugField(max_length=60)
    description = models.TextField(blank=True)
    duration_min = models.PositiveSmallIntegerField(default=30)
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.ONLINE)
    # Default location for physical meetings — visitor can still override.
    location = models.CharField(max_length=300, blank=True)
    # Hex colour used to tint the type card on the public booking page.
    color = models.CharField(max_length=7, default="#4f46e5")
    is_active = models.BooleanField(default=True)
    display_order = models.PositiveSmallIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("display_order", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("host", "slug"),
                name="uniq_meeting_type_host_slug",
            ),
        ]
        indexes = [models.Index(fields=("host", "is_active"))]

    def __str__(self) -> str:
        return f"{self.name} ({self.duration_min}min)"


class Booking(models.Model):
    """Record of a calendar event that Slotly created on behalf of the host.

    Populated only for **public** bookings (visitor-facing flow) — peer /
    group bookings from /people and /search don't need this row because the
    invitees already control the event in their own calendars. Purpose here
    is to give the visitor a stable, unguessable manage URL (``/b/<uuid>``)
    they can cancel or reschedule from without needing a Slotly account.

    Kept separate from ``BookingRequest`` because that model tracks the
    *pending-approval* lifecycle; this one tracks the *confirmed* event.
    A physical BookingRequest that gets approved spawns a Booking row.
    """

    class Provider(models.TextChoices):
        GOOGLE = "google", "Google"
        MICROSOFT = "microsoft", "Microsoft"

    class Kind(models.TextChoices):
        ONLINE = "online", "Online"
        PHYSICAL = "physical", "In person"

    class Status(models.TextChoices):
        CONFIRMED = "confirmed", "Confirmed"
        CANCELLED = "cancelled", "Cancelled"

    uuid = models.UUIDField(default=uuid.uuid4, unique=True, db_index=True)
    host = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="hosted_bookings",
    )
    provider = models.CharField(max_length=16, choices=Provider.choices)
    calendar_id = models.CharField(max_length=1024, blank=True)
    event_id = models.CharField(max_length=256, blank=True, db_index=True)

    visitor_name = models.CharField(max_length=120, blank=True)
    visitor_email = models.EmailField(blank=True)

    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.ONLINE)
    title = models.CharField(max_length=200, blank=True)
    location = models.CharField(max_length=300, blank=True)
    notes = models.TextField(blank=True)

    start_at = models.DateTimeField()
    end_at = models.DateTimeField()

    status = models.CharField(max_length=16, choices=Status.choices, default=Status.CONFIRMED)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.TextField(blank=True)
    cancelled_by_visitor = models.BooleanField(default=False)

    # Populated by the send_booking_reminders command once the visitor has
    # been mailed their T-24h reminder. Null means "not sent yet"; the
    # command's window logic skips already-reminded rows.
    reminded_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=("host", "-start_at")),
            models.Index(fields=("visitor_email", "-start_at")),
        ]

    def __str__(self) -> str:
        return f"Booking(host={self.host_id}, {self.status}, {self.start_at})"


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
