from __future__ import annotations

from django.contrib.auth import get_user_model, logout
from django.db import models, transaction
from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.calendars.models import Calendar, CalendarEvent
from apps.notifications.dispatch import notify
from apps.notifications.models import Notification
from apps.teams.models import Membership, Team

from .serializers import MeSerializer, TeammateSerializer

User = get_user_model()


class MeView(APIView):
    """GET / PATCH the authenticated user's profile + working hours."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        return Response(MeSerializer(request.user).data)

    def patch(self, request: Request) -> Response:
        serializer = MeSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class DeleteMeView(APIView):
    """
    GET  /api/me/delete  — preview: counts of what will be cascaded.
    POST /api/me/delete  — perform hard-delete. Body: {"password": "..."}.

    The user is removed immediately (PRD §5.7). Email is freed up.
    Teams where the user is the sole admin are deleted up-front (with
    team_deleted notifications to remaining members). Teams that lose their
    last admin via CASCADE on user.delete() are then also auto-deleted.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        user = request.user
        sole_admin_team_ids = _sole_admin_team_ids(user)
        affected_teammates = (
            Membership.objects.filter(team_id__in=sole_admin_team_ids)
            .exclude(user=user)
            .count()
        )
        return Response({
            "teams_member_count": Membership.objects.filter(user=user).count(),
            "teams_will_be_deleted": len(sole_admin_team_ids),
            "team_members_will_be_notified": affected_teammates,
            "calendars_count": Calendar.objects.filter(owner=user).count(),
            "cached_events_count": CalendarEvent.objects.filter(calendar__owner=user).count(),
            "notifications_count": Notification.objects.filter(recipient=user).count(),
        })

    def post(self, request: Request) -> Response:
        password = request.data.get("password", "")
        if not request.user.check_password(password):
            return Response({"password": "Incorrect password."}, status=400)

        user = request.user
        # Snapshot teams where this user is admin, before any deletion.
        sole_admin_team_ids = _sole_admin_team_ids(user)
        other_admin_team_ids = list(
            Membership.objects.filter(user=user, role=Membership.Role.ADMIN)
            .exclude(team_id__in=sole_admin_team_ids)
            .values_list("team_id", flat=True),
        )

        with transaction.atomic():
            # Step 1: delete sole-admin teams up front (notify members).
            for team in Team.objects.filter(pk__in=sole_admin_team_ids):
                _delete_team_with_notifications(team, exclude_user_id=user.pk)

            # Step 2: delete the user. CASCADE removes their other memberships,
            # calendars (and their events), notifications, EmailAddress rows, etc.
            user_pk = user.pk
            user.delete()

            # Step 3: any "co-admin" teams that lost their last admin via the
            # cascade now have zero admins → auto-delete per PRD §5.3.
            for team in Team.objects.filter(pk__in=other_admin_team_ids):
                if team.admin_count == 0:
                    _delete_team_with_notifications(team, exclude_user_id=user_pk)

        # Invalidate the session cookie. Doing this after delete is fine —
        # logout() just clears the session, not the user.
        logout(request)
        return Response(status=204)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _sole_admin_team_ids(user) -> list[int]:
    """Teams where `user` is admin and the only admin."""
    return list(
        Team.objects.filter(memberships__user=user, memberships__role=Membership.Role.ADMIN)
        .annotate(
            admin_count_calc=models.Count(
                "memberships",
                filter=models.Q(memberships__role=Membership.Role.ADMIN),
            ),
        )
        .filter(admin_count_calc=1)
        .values_list("pk", flat=True),
    )


class TeammateView(APIView):
    """
    GET /api/users/<id> — public profile of a teammate.

    Visible only when the caller and the target share at least one team
    (PRD §5.5). The caller can also fetch their own profile this way.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request: Request, pk: int) -> Response:
        target = get_object_or_404(User, pk=pk)
        shared = list(
            Team.objects.filter(memberships__user=request.user)
            .filter(memberships__user=target)
            .distinct()
            .values_list("pk", flat=True),
        )
        if not shared and target.pk != request.user.pk:
            return Response(
                {"detail": "You don't share any team with this user."},
                status=403,
            )
        return Response(
            TeammateSerializer(
                target,
                context={"shared_team_ids": shared},
            ).data,
        )


def _delete_team_with_notifications(team: Team, *, exclude_user_id: int | None = None) -> None:
    """Notify all current members (except `exclude_user_id`) and delete the team."""
    members = list(team.memberships.select_related("user"))
    team_id, team_name = team.pk, team.name
    team.delete()
    for m in members:
        if m.user_id == exclude_user_id:
            continue
        notify(
            m.user,
            Notification.Type.TEAM_DELETED,
            {"team_id": team_id, "team_name": team_name},
        )
