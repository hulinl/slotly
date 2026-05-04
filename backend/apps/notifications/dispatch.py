"""
Single fan-out point for notifications. Every event-firing place in the app
calls `notify(user, type, payload)`; respect for the user's prefs and per-
channel rendering live here.

The two channels:
- in_app — creates a Notification row the bell+dropdown reads.
- email  — sends a plain-text mail; subject + body picked by `_EMAIL_RENDERERS`.

Defaults are "all on": a missing pref key for an event is treated as both
channels enabled (matches default_notification_prefs at signup).
"""

from __future__ import annotations

import logging
from typing import Callable

from django.conf import settings
from django.core.mail import send_mail

from .models import Notification

logger = logging.getLogger(__name__)

EmailRenderer = Callable[[dict, "User"], tuple[str, str]]  # noqa: F821


def _frontend_base() -> str:
    return getattr(settings, "FRONTEND_BASE_URL", "http://localhost:3000")


# ---------------------------------------------------------------------------
# Email renderers — keep bodies short, plain text. Subject prefix is added
# by the caller.
# ---------------------------------------------------------------------------

def _r_invitation_accepted(p: dict, user) -> tuple[str, str]:
    return (
        f"{p['accepter_email']} accepted your invitation",
        f"{p['accepter_email']} accepted your invitation to join \"{p['team_name']}\".\n\n"
        f"Open the team: {_frontend_base()}/settings/teams/{p['team_id']}",
    )


def _r_invitation_rejected(p: dict, user) -> tuple[str, str]:
    return (
        f"{p['rejecter_email']} declined your invitation",
        f"{p['rejecter_email']} declined your invitation to \"{p['team_name']}\".",
    )


def _r_member_joined(p: dict, user) -> tuple[str, str]:
    return (
        f"{p['member_email']} joined {p['team_name']}",
        f"{p['member_email']} joined the team \"{p['team_name']}\".\n\n"
        f"Roster: {_frontend_base()}/settings/teams/{p['team_id']}",
    )


def _r_member_left(p: dict, user) -> tuple[str, str]:
    return (
        f"{p['member_email']} left {p['team_name']}",
        f"{p['member_email']} left the team \"{p['team_name']}\".",
    )


def _r_member_removed(p: dict, user) -> tuple[str, str]:
    return (
        f"You were removed from {p['team_name']}",
        f"You were removed from the team \"{p['team_name']}\" by an admin.",
    )


def _r_role_promoted(p: dict, user) -> tuple[str, str]:
    return (
        f"You're now an admin of {p['team_name']}",
        f"You were promoted to admin of \"{p['team_name']}\".\n\n"
        f"Manage the team: {_frontend_base()}/settings/teams/{p['team_id']}",
    )


def _r_role_demoted(p: dict, user) -> tuple[str, str]:
    return (
        f"You're no longer an admin of {p['team_name']}",
        f"You were demoted from admin in \"{p['team_name']}\".",
    )


def _r_team_deleted(p: dict, user) -> tuple[str, str]:
    return (
        f"Team \"{p['team_name']}\" was deleted",
        f"The team \"{p['team_name']}\" was deleted. Your membership has been removed.",
    )


def _r_calendar_sync_failed(p: dict, user) -> tuple[str, str]:
    return (
        f"Calendar \"{p['calendar_name']}\" hasn't synced for 24h",
        f"Slotly hasn't been able to read \"{p['calendar_name']}\" for 24 hours.\n\n"
        f"Update the URL or remove the calendar: {_frontend_base()}/settings/calendars",
    )


# Note: TEAM_INVITATION_SENT email is *not* dispatched through here; that
# message has bespoke registered/unregistered branching and lives in
# apps.teams.email. We still create the in-app row here for a registered
# recipient so the bell shows the pending invite.
_EMAIL_RENDERERS: dict[str, EmailRenderer] = {
    Notification.Type.TEAM_INVITATION_ACCEPTED: _r_invitation_accepted,
    Notification.Type.TEAM_INVITATION_REJECTED: _r_invitation_rejected,
    Notification.Type.TEAM_MEMBER_JOINED: _r_member_joined,
    Notification.Type.TEAM_MEMBER_LEFT: _r_member_left,
    Notification.Type.TEAM_MEMBER_REMOVED: _r_member_removed,
    Notification.Type.TEAM_ROLE_PROMOTED: _r_role_promoted,
    Notification.Type.TEAM_ROLE_DEMOTED: _r_role_demoted,
    Notification.Type.TEAM_DELETED: _r_team_deleted,
    Notification.Type.CALENDAR_SYNC_FAILED: _r_calendar_sync_failed,
}


def _channel_enabled(user, event_type: str, channel: str) -> bool:
    prefs = user.notification_prefs or {}
    event_prefs = prefs.get(event_type)
    if event_prefs is None:
        return True  # missing key → default on
    return bool(event_prefs.get(channel, True))


def notify(user, event_type: str, payload: dict, *, send_email: bool = True) -> None:
    """
    Deliver `event_type` to `user` honoring their preferences. `send_email=False`
    is used by callers that already sent a bespoke email (e.g. invitation
    emails with branching unregistered/registered copy).
    """
    if user is None:
        return

    if _channel_enabled(user, event_type, "in_app"):
        Notification.objects.create(
            recipient=user,
            type=event_type,
            payload=payload,
        )

    if send_email and _channel_enabled(user, event_type, "email"):
        renderer = _EMAIL_RENDERERS.get(event_type)
        if renderer is None:
            return
        subject, body = renderer(payload, user)
        try:
            send_mail(
                subject=f"[Slotly] {subject}",
                message=body,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=False,
            )
        except Exception as exc:  # noqa: BLE001 — never block the action over email
            logger.warning("Notification email failed (%s): %s", event_type, exc)
