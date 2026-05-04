"""
Calendar (ICS subscription) and CalendarEvent models.

Privacy commitment (PRD §5.2): only free/busy information is stored. This
module has *no* fields for SUMMARY, DESCRIPTION, LOCATION, ORGANIZER,
ATTENDEE, URL, CATEGORIES, or any X- extensions. Adding such a column would
require a schema change and migration review — the goal is to make a privacy
regression mechanically impossible to introduce by accident (PRD R11).
"""

from __future__ import annotations

from django.conf import settings
from django.db import models


class Calendar(models.Model):
    class Provider(models.TextChoices):
        GOOGLE = "google", "Google Calendar"
        APPLE = "apple", "Apple iCloud"
        OUTLOOK = "outlook", "Microsoft 365 / Outlook"
        OTHER = "other", "Other ICS URL"

    class Status(models.TextChoices):
        OK = "ok", "OK"
        SYNCING = "syncing", "Syncing"
        SYNC_FAILING = "sync_failing", "Sync failing"
        UNREACHABLE = "unreachable", "Unreachable"

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="calendars",
    )
    name = models.CharField(max_length=200)
    provider = models.CharField(max_length=20, choices=Provider.choices, default=Provider.OTHER)

    # Fernet token. Plaintext URL is never stored.
    url_encrypted = models.TextField()

    include_in_busy = models.BooleanField(default=True)

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OK)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True)
    consecutive_failures = models.PositiveIntegerField(default=0)

    # Conditional GET caching
    last_etag = models.CharField(max_length=400, blank=True)
    last_modified = models.CharField(max_length=200, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=("owner", "include_in_busy"))]

    def __str__(self) -> str:
        return f"{self.name} ({self.owner_id})"


class CalendarEvent(models.Model):
    """
    A free/busy interval parsed from a Calendar's ICS feed.

    For recurring events, each materialised instance within the sync window
    is stored as its own row, keyed by (calendar, uid, recurrence_id) — that
    keeps slot-search queries trivially indexable on (calendar, dtstart).
    """

    class Status(models.TextChoices):
        CONFIRMED = "confirmed", "Confirmed"
        TENTATIVE = "tentative", "Tentative"
        CANCELLED = "cancelled", "Cancelled"

    class Transparency(models.TextChoices):
        OPAQUE = "opaque", "Busy"
        TRANSPARENT = "transparent", "Free"

    calendar = models.ForeignKey(Calendar, on_delete=models.CASCADE, related_name="events")
    uid = models.CharField(max_length=512)
    # Empty string = master/single instance. RECURRENCE-ID for materialised instances.
    recurrence_id = models.CharField(max_length=200, blank=True, default="")

    dtstart = models.DateTimeField()
    dtend = models.DateTimeField()
    is_all_day = models.BooleanField(default=False)

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.CONFIRMED)
    transp = models.CharField(max_length=20, choices=Transparency.choices, default=Transparency.OPAQUE)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("calendar", "uid", "recurrence_id"),
                name="calendarevent_uid_unique_per_calendar",
            ),
        ]
        indexes = [
            models.Index(fields=("calendar", "dtstart")),
            models.Index(fields=("calendar", "dtend")),
        ]

    def __str__(self) -> str:
        return f"{self.calendar_id}:{self.uid} {self.dtstart:%Y-%m-%d %H:%M}"
