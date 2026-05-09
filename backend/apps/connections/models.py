"""
Bilateral peer connection between two Slotly users.

Visibility rule (M22): seeing another user's busy/free or profile detail
requires either an accepted Connection, a shared Group (Team) membership,
or that the target user has share_enabled=True (public profile link).

Each pair is stored on a single row with a canonical ordering
(user_low.pk < user_high.pk) plus a `requested_by` pointer so the UI can
tell incoming-vs-outgoing pending requests apart.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q


class Connection(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"

    # Canonical ordering — user_low.pk < user_high.pk. Enforced in clean()
    # and at the manager level so we never have two rows for the same pair.
    user_low = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="connections_as_low",
    )
    user_high = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="connections_as_high",
    )
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
    )
    # Who actually clicked "Connect" — needed so we can show the receiving
    # user the Accept/Reject affordance (and not show it to the requester).
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="connection_requests_sent",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("user_low", "user_high"),
                name="connection_unique_pair",
            ),
            models.CheckConstraint(
                check=Q(user_low__lt=models.F("user_high")),
                name="connection_canonical_order",
            ),
        ]
        indexes = [
            models.Index(fields=("user_low", "status")),
            models.Index(fields=("user_high", "status")),
        ]

    def __str__(self) -> str:
        return f"Connection({self.user_low_id}↔{self.user_high_id} {self.status})"

    @classmethod
    def for_pair(cls, a_id: int, b_id: int):
        """Return the row (or None) representing the connection between
        two users, regardless of which order the caller passes them."""
        if a_id == b_id:
            return None
        low, high = (a_id, b_id) if a_id < b_id else (b_id, a_id)
        return cls.objects.filter(user_low_id=low, user_high_id=high).first()

    @classmethod
    def are_connected(cls, a_id: int, b_id: int) -> bool:
        """True iff there's an accepted connection between the two users."""
        if a_id == b_id:
            return False
        row = cls.for_pair(a_id, b_id)
        return row is not None and row.status == cls.Status.ACCEPTED

    @classmethod
    def accepted_peer_ids(cls, user_id: int) -> list[int]:
        """All other-user pks the given user is accepted-connected to."""
        as_low = cls.objects.filter(
            user_low_id=user_id, status=cls.Status.ACCEPTED,
        ).values_list("user_high_id", flat=True)
        as_high = cls.objects.filter(
            user_high_id=user_id, status=cls.Status.ACCEPTED,
        ).values_list("user_low_id", flat=True)
        return list(as_low) + list(as_high)

    def other_user_id(self, viewer_id: int) -> int:
        return self.user_high_id if viewer_id == self.user_low_id else self.user_low_id

    def is_incoming_for(self, viewer_id: int) -> bool:
        """True when the viewer is the *receiver* of a pending request
        (not the sender) — drives Accept/Reject vs Cancel UI."""
        return (
            self.status == self.Status.PENDING
            and self.requested_by_id != viewer_id
        )
