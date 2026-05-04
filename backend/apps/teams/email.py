"""
Plain-text invitation emails. Templates live inline because we have a single
locale (English) and no marketing branding to render. If/when we add HTML or
i18n, move these to `templates/teams/`.
"""

from __future__ import annotations

from django.conf import settings
from django.core.mail import send_mail

from .models import Invitation


def _frontend_base() -> str:
    """Where to point email links. In dev = http://localhost:3000."""
    return getattr(settings, "FRONTEND_BASE_URL", "http://localhost:3000")


def _accept_url(invitation: Invitation) -> str:
    return f"{_frontend_base()}/invitations/{invitation.token}"


def _register_url(invitation: Invitation) -> str:
    # Unregistered recipient: register first, then the email_confirmed signal
    # auto-joins them on verification.
    return f"{_frontend_base()}/auth/register?email={invitation.invited_email}"


def send_invitation_email(invitation: Invitation, *, recipient_is_registered: bool) -> None:
    inviter = invitation.invited_by.email if invitation.invited_by_id else "your teammate"
    team = invitation.team.name
    if recipient_is_registered:
        link = _accept_url(invitation)
        body = (
            f"{inviter} invited you to join the team \"{team}\" on Slotly.\n\n"
            f"Accept or decline here:\n{link}\n\n"
            f"This invitation expires on {invitation.expires_at:%Y-%m-%d}."
        )
        subject = f"You're invited to {team}"
    else:
        link = _register_url(invitation)
        body = (
            f"{inviter} invited you to join the team \"{team}\" on Slotly.\n\n"
            f"Slotly is a free tool that finds time slots when everyone on the team is free.\n\n"
            f"Sign up here — once you verify your email, you'll be added to the team automatically:\n{link}\n\n"
            f"This invitation expires on {invitation.expires_at:%Y-%m-%d}."
        )
        subject = f"You're invited to {team} on Slotly"

    send_mail(
        subject=f"[Slotly] {subject}",
        message=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[invitation.invited_email],
        fail_silently=False,
    )
