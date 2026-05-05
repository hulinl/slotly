"""
User-controlled unavailability (vacation, sick, OOO).

A simpler sibling of CalendarEvent: the user adds an explicit time range,
labeled with a free-form string. The search engine treats every
Unavailability as OPAQUE busy time (M12). One-off only — no recurrence in MVP.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models


class Unavailability(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="unavailabilities",
    )
    label = models.CharField(max_length=200)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    # Hint for the UI; the engine still uses datetimes.
    is_all_day = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("starts_at",)
        indexes = [
            models.Index(fields=("user", "starts_at")),
            models.Index(fields=("user", "ends_at")),
        ]

    def __str__(self) -> str:
        return f"Unavailability({self.user_id}, {self.label}, {self.starts_at:%Y-%m-%d}–{self.ends_at:%Y-%m-%d})"
