from __future__ import annotations

from django.conf import settings
from django.db import models


class Notification(models.Model):
    """
    A delivered in-app notification, queryable by `recipient`. The body of the
    message is *not* rendered server-side; the client knows how to format each
    `type` given the structured `payload` (team_name, inviter_email, …). Email
    messages are rendered by `apps.notifications.dispatch` at send time and
    are not stored.
    """

    class Type(models.TextChoices):
        # team-related
        TEAM_INVITATION_SENT = "team.invitation_sent", "You were invited to a team"
        TEAM_INVITATION_ACCEPTED = "team.invitation_accepted", "Your invitation was accepted"
        TEAM_INVITATION_REJECTED = "team.invitation_rejected", "Your invitation was rejected"
        TEAM_MEMBER_JOINED = "team.member_joined", "Someone joined the team"
        TEAM_MEMBER_LEFT = "team.member_left", "Someone left the team"
        TEAM_MEMBER_REMOVED = "team.member_removed", "You were removed from a team"
        TEAM_ROLE_PROMOTED = "team.role_promoted", "You were promoted to admin"
        TEAM_ROLE_DEMOTED = "team.role_demoted", "You were demoted from admin"
        TEAM_DELETED = "team.deleted", "A team you belong to was deleted"
        # calendar-related
        CALENDAR_SYNC_FAILED = "calendar.sync_failed", "A calendar failed to sync"
        # connection-related (M22)
        CONNECTION_REQUESTED = "connection.requested", "Someone wants to connect with you"
        CONNECTION_ACCEPTED = "connection.accepted", "Your connection request was accepted"

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    type = models.CharField(max_length=64, choices=Type.choices)
    payload = models.JSONField(default=dict, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=("recipient", "-created_at")),
            models.Index(fields=("recipient", "read_at")),
        ]

    def __str__(self) -> str:
        return f"Notification(to={self.recipient_id}, type={self.type})"


NOTIFICATION_EVENT_TYPES: tuple[str, ...] = tuple(t.value for t in Notification.Type)


def default_notification_prefs() -> dict[str, dict[str, bool]]:
    """All events on, both channels (PRD §5.6)."""
    return {event: {"email": True, "in_app": True} for event in NOTIFICATION_EVENT_TYPES}
