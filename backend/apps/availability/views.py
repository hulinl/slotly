from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from apps.teams.models import Membership

from .models import Unavailability
from .serializers import UnavailabilitySerializer
from .tasks import RETENTION_DAYS

User = get_user_model()


def _purge_stale_blocks(user) -> None:
    """Best-effort cleanup of >RETENTION_DAYS-old blocks for `user`.
    Triggered lazily from the list endpoint so we don't depend on a
    background scheduler in production. Cheap — one DELETE keyed on an
    indexed datetime column."""
    cutoff = timezone.now() - timedelta(days=RETENTION_DAYS)
    Unavailability.objects.filter(user=user, ends_at__lt=cutoff).delete()


class UnavailabilityViewSet(ModelViewSet):
    """
    /api/unavailabilities          GET  list (mine, or ?user_id=<id> for a teammate)
                                   POST create (always for the authenticated user)
    /api/unavailabilities/<id>     GET / PATCH / DELETE — only the owner can mutate.
    """

    serializer_class = UnavailabilitySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        target_id = self.request.query_params.get("user_id")
        if target_id is None or str(user.pk) == str(target_id):
            # Only purge on listing (not on retrieve / update / delete) so
            # we don't pay the DELETE cost on every CRUD mutation.
            if self.action == "list":
                _purge_stale_blocks(user)
            return Unavailability.objects.filter(user=user)
        try:
            target_id_int = int(target_id)
        except (TypeError, ValueError):
            return Unavailability.objects.none()
        # Reading a teammate's blocks: must share at least one team.
        if not Membership.objects.filter(
            user=user, team__memberships__user_id=target_id_int,
        ).exists():
            return Unavailability.objects.none()
        return Unavailability.objects.filter(user_id=target_id_int)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def get_object(self):
        obj = super().get_object()
        if self.action in {"update", "partial_update", "destroy"} and obj.user_id != self.request.user.pk:
            raise PermissionDenied("You can only edit your own unavailability.")
        return obj
