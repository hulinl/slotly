from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.teams.models import Team

# How many recent searches to keep per user. Older entries are pruned each
# time a new search runs.
RECENT_SEARCH_LIMIT = 10


class SavedSearch(models.Model):
    """
    A user-named, reusable search preset (PRD §5.4).

    `member_ids` stores user IDs as a JSON list. Members may leave the team
    after the search is saved; the loader is expected to intersect with the
    current team roster before submitting the form.
    """

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="saved_searches",
    )
    name = models.CharField(max_length=200)
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="+")
    member_ids = models.JSONField(default=list)
    duration_min = models.PositiveSmallIntegerField()
    buffer_min = models.PositiveSmallIntegerField(default=0)
    window_days = models.PositiveSmallIntegerField(default=90)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-last_used_at",)
        constraints = [
            models.UniqueConstraint(
                fields=("owner", "name"),
                name="unique_saved_search_name_per_user",
            ),
        ]

    def __str__(self) -> str:
        return f"SavedSearch({self.name} for user={self.owner_id})"


class RecentSearch(models.Model):
    """
    Auto-recorded search history. Pruned to the latest `RECENT_SEARCH_LIMIT`
    entries per user on every insert.
    """

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="recent_searches",
    )
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="+")
    member_ids = models.JSONField(default=list)
    duration_min = models.PositiveSmallIntegerField()
    buffer_min = models.PositiveSmallIntegerField(default=0)
    window_start = models.DateTimeField()
    window_end = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=("owner", "-created_at"))]

    def __str__(self) -> str:
        return f"RecentSearch(team={self.team_id}, user={self.owner_id}, at={self.created_at:%Y-%m-%d %H:%M})"
