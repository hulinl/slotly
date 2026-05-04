"""
Team, Membership, and Invitation models per PRD §5.3.

- A user can belong to any number of teams (no limit).
- A team can have many admins. If the last admin leaves or is demoted, the
  team is auto-deleted (handled in views, not enforced at the DB layer).
- Invitations are keyed by email (not user); a pending invitation matched by
  email is auto-accepted when the recipient finishes email verification
  (signals.py).
"""

from __future__ import annotations

import secrets
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


class Team(models.Model):
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return self.name

    @property
    def admin_count(self) -> int:
        return self.memberships.filter(role=Membership.Role.ADMIN).count()


class Membership(models.Model):
    class Role(models.TextChoices):
        ADMIN = "admin", "Admin"
        MEMBER = "member", "Member"

    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.MEMBER)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=("team", "user"), name="unique_team_user"),
        ]
        indexes = [
            models.Index(fields=("user", "team")),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}@{self.team_id} ({self.role})"


def _make_invitation_token() -> str:
    return secrets.token_urlsafe(32)


def _default_invitation_expiry():
    return timezone.now() + timedelta(days=30)


class Invitation(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        REJECTED = "rejected", "Rejected"
        CANCELLED = "cancelled", "Cancelled"
        EXPIRED = "expired", "Expired"

    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="invitations")
    invited_email = models.EmailField()
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    token = models.CharField(max_length=64, unique=True, default=_make_invitation_token, editable=False)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    role_on_accept = models.CharField(
        max_length=10,
        choices=Membership.Role.choices,
        default=Membership.Role.MEMBER,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(default=_default_invitation_expiry)

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            # Only one *pending* invitation per (team, email). Already-accepted
            # or cancelled rows stay around as audit trail.
            models.UniqueConstraint(
                fields=("team", "invited_email"),
                condition=Q(status="pending"),
                name="unique_pending_invitation_per_team_email",
            ),
        ]
        indexes = [
            models.Index(fields=("invited_email", "status")),
            models.Index(fields=("token",)),
        ]

    def __str__(self) -> str:
        return f"invite({self.invited_email} → {self.team_id}, {self.status})"

    def save(self, *args, **kwargs):
        # Normalize email for case-insensitive matching with EmailAddress.
        self.invited_email = self.invited_email.strip().lower()
        super().save(*args, **kwargs)

    @property
    def is_pending_active(self) -> bool:
        return self.status == self.Status.PENDING and self.expires_at > timezone.now()
