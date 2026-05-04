"""
When a user verifies their email, auto-accept any pending invitations that
were sent to that email. Covers the "invite an unregistered email" flow:
the recipient signs up, verifies, and lands in their teams without ever
clicking an /invitations/<token>/accept URL.
"""

from __future__ import annotations

import logging

from allauth.account.signals import email_confirmed
from django.db import transaction
from django.dispatch import receiver
from django.utils import timezone

from .models import Invitation, Membership

logger = logging.getLogger(__name__)


@receiver(email_confirmed)
def auto_accept_pending_invitations(sender, request, email_address, **kwargs):  # noqa: ARG001
    """
    `email_address` is the allauth EmailAddress just marked verified=True.
    """
    user = email_address.user
    if user is None:
        return

    pending = Invitation.objects.select_related("team").filter(
        invited_email__iexact=email_address.email,
        status=Invitation.Status.PENDING,
        expires_at__gt=timezone.now(),
    )

    with transaction.atomic():
        for invitation in pending:
            Membership.objects.get_or_create(
                team=invitation.team,
                user=user,
                defaults={"role": invitation.role_on_accept},
            )
            invitation.status = Invitation.Status.ACCEPTED
            invitation.save(update_fields=["status"])
            logger.info(
                "Auto-accepted invitation %s for %s into team %s",
                invitation.pk,
                email_address.email,
                invitation.team_id,
            )
