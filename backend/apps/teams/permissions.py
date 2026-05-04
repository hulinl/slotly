from __future__ import annotations

from rest_framework.permissions import BasePermission

from .models import Membership


def is_member(user, team) -> bool:
    return user.is_authenticated and Membership.objects.filter(team=team, user=user).exists()


def is_admin(user, team) -> bool:
    return (
        user.is_authenticated
        and Membership.objects.filter(team=team, user=user, role=Membership.Role.ADMIN).exists()
    )


class IsTeamMember(BasePermission):
    """View access requires membership; mutations require admin."""

    def has_object_permission(self, request, view, obj) -> bool:
        if request.method in {"GET", "HEAD", "OPTIONS"}:
            return is_member(request.user, obj)
        return is_admin(request.user, obj)
