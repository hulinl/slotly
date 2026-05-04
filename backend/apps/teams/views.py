from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from .email import send_invitation_email
from .models import Invitation, Membership, Team
from .permissions import IsTeamMember, is_admin, is_member
from .serializers import (
    InvitationForRecipientSerializer,
    MemberSerializer,
    TeamCreateSerializer,
    TeamDetailSerializer,
    TeamListSerializer,
    TeamUpdateSerializer,
)

User = get_user_model()


def _ensure_admin_or_403(user, team) -> Response | None:
    if not is_admin(user, team):
        return Response({"detail": "Admin role required."}, status=status.HTTP_403_FORBIDDEN)
    return None


def _delete_team_if_no_admins(team: Team) -> bool:
    if team.admin_count == 0:
        team.delete()
        return True
    return False


class TeamViewSet(ModelViewSet):
    """
    /api/teams                          GET   list mine
                                        POST  create (caller becomes admin)
    /api/teams/<id>                     GET/PATCH/DELETE
    /api/teams/<id>/leave               POST  leave the team
    /api/teams/<id>/invite              POST  body={email, role?}
    /api/teams/<id>/invitations/<inv>            DELETE  cancel pending invitation
    /api/teams/<id>/invitations/<inv>/resend     POST    re-send email
    /api/teams/<id>/members/<uid>       PATCH body={role}  promote/demote
    /api/teams/<id>/members/<uid>       DELETE             remove member
    """

    permission_classes = [IsAuthenticated, IsTeamMember]

    def get_queryset(self):
        return (
            Team.objects.filter(memberships__user=self.request.user)
            .distinct()
            .order_by("-created_at")
        )

    def get_serializer_class(self):
        if self.action == "list":
            return TeamListSerializer
        if self.action == "create":
            return TeamCreateSerializer
        if self.action in {"update", "partial_update"}:
            return TeamUpdateSerializer
        return TeamDetailSerializer

    def list(self, request: Request, *args, **kwargs) -> Response:
        from django.db.models import Count

        qs = self.get_queryset().annotate(member_count=Count("memberships"))
        return Response(self.get_serializer(qs, many=True).data)

    def retrieve(self, request: Request, *args, **kwargs) -> Response:
        team = self.get_object()
        # member_count for the detail view too
        from django.db.models import Count

        team = (
            Team.objects.filter(pk=team.pk)
            .annotate(member_count=Count("memberships"))
            .first()
        )
        # Mark expired invitations lazily on read.
        Invitation.objects.filter(
            team=team, status=Invitation.Status.PENDING, expires_at__lte=timezone.now()
        ).update(status=Invitation.Status.EXPIRED)
        return Response(self.get_serializer(team).data)

    @transaction.atomic
    def create(self, request: Request, *args, **kwargs) -> Response:
        write = TeamCreateSerializer(data=request.data)
        write.is_valid(raise_exception=True)
        team: Team = write.save(created_by=request.user)
        Membership.objects.create(team=team, user=request.user, role=Membership.Role.ADMIN)
        return Response(TeamListSerializer(team, context={"request": request}).data, status=201)

    @action(detail=True, methods=["post"], url_path="leave")
    def leave(self, request: Request, pk: int | None = None) -> Response:
        team = self.get_object()
        membership = Membership.objects.filter(team=team, user=request.user).first()
        if membership is None:
            return Response({"detail": "Not a member."}, status=400)

        with transaction.atomic():
            was_only_admin = membership.role == Membership.Role.ADMIN and team.admin_count == 1
            membership.delete()
            # If the only remaining admin just left, the team is auto-deleted
            # to keep PRD §5.3 invariant ("zero admins → team deleted").
            if was_only_admin:
                team.delete()
                return Response({"detail": "You were the last admin; team deleted."}, status=200)
        return Response({"detail": "Left team."}, status=200)

    @action(detail=True, methods=["post"], url_path="invite")
    def invite(self, request: Request, pk: int | None = None) -> Response:
        team = self.get_object()
        denied = _ensure_admin_or_403(request.user, team)
        if denied:
            return denied
        email = (request.data.get("email") or "").strip().lower()
        role = (request.data.get("role") or Membership.Role.MEMBER).strip()
        if not email:
            return Response({"email": "Required"}, status=400)
        if role not in {Membership.Role.MEMBER, Membership.Role.ADMIN}:
            return Response({"role": "Must be 'member' or 'admin'."}, status=400)

        # Already a member?
        if Membership.objects.filter(team=team, user__email__iexact=email).exists():
            return Response({"email": "User is already a member."}, status=400)

        # Already pending?
        pending = Invitation.objects.filter(
            team=team,
            invited_email__iexact=email,
            status=Invitation.Status.PENDING,
            expires_at__gt=timezone.now(),
        ).first()
        if pending is not None:
            return Response({"email": "Invitation already pending for this email."}, status=400)

        invitation = Invitation.objects.create(
            team=team,
            invited_email=email,
            invited_by=request.user,
            role_on_accept=role,
        )
        registered = User.objects.filter(email__iexact=email).exists()
        try:
            send_invitation_email(invitation, recipient_is_registered=registered)
        except Exception as exc:  # noqa: BLE001
            # Email failed; keep the row, surface to caller. They can resend later.
            return Response(
                {"detail": f"Invitation saved, but email failed to send: {exc}"},
                status=202,
            )
        return Response({"detail": "Invitation sent.", "id": invitation.id}, status=201)

    @action(
        detail=True,
        methods=["delete"],
        url_path=r"invitations/(?P<inv_id>\d+)",
    )
    def cancel_invitation(self, request: Request, pk: int | None = None, inv_id: str | None = None) -> Response:
        team = self.get_object()
        denied = _ensure_admin_or_403(request.user, team)
        if denied:
            return denied
        invitation = get_object_or_404(Invitation, pk=inv_id, team=team)
        if invitation.status != Invitation.Status.PENDING:
            return Response({"detail": f"Cannot cancel ({invitation.status})."}, status=400)
        invitation.status = Invitation.Status.CANCELLED
        invitation.save(update_fields=["status"])
        return Response(status=204)

    @action(
        detail=True,
        methods=["post"],
        url_path=r"invitations/(?P<inv_id>\d+)/resend",
    )
    def resend_invitation(self, request: Request, pk: int | None = None, inv_id: str | None = None) -> Response:
        team = self.get_object()
        denied = _ensure_admin_or_403(request.user, team)
        if denied:
            return denied
        invitation = get_object_or_404(Invitation, pk=inv_id, team=team)
        if not invitation.is_pending_active:
            return Response({"detail": f"Cannot resend ({invitation.status})."}, status=400)
        registered = User.objects.filter(email__iexact=invitation.invited_email).exists()
        send_invitation_email(invitation, recipient_is_registered=registered)
        return Response({"detail": "Resent."}, status=200)

    @action(
        detail=True,
        methods=["patch", "delete"],
        url_path=r"members/(?P<user_id>\d+)",
    )
    def member_admin(self, request: Request, pk: int | None = None, user_id: str | None = None) -> Response:
        team = self.get_object()
        denied = _ensure_admin_or_403(request.user, team)
        if denied:
            return denied
        membership = get_object_or_404(Membership, team=team, user_id=user_id)

        if request.method == "DELETE":
            with transaction.atomic():
                if membership.user_id == request.user.id and team.admin_count == 1:
                    return Response(
                        {"detail": "You are the only admin; promote someone else first."},
                        status=400,
                    )
                membership.delete()
                if _delete_team_if_no_admins(team):
                    return Response({"detail": "Team auto-deleted (no admins remained)."})
            return Response(status=204)

        # PATCH: change role
        new_role = (request.data.get("role") or "").strip()
        if new_role not in {Membership.Role.MEMBER, Membership.Role.ADMIN}:
            return Response({"role": "Must be 'member' or 'admin'."}, status=400)

        with transaction.atomic():
            # Demoting yourself when you're the only admin is blocked.
            if (
                membership.user_id == request.user.id
                and membership.role == Membership.Role.ADMIN
                and new_role == Membership.Role.MEMBER
                and team.admin_count == 1
            ):
                return Response(
                    {"detail": "You are the only admin; promote someone else first."},
                    status=400,
                )
            membership.role = new_role
            membership.save(update_fields=["role"])
            if _delete_team_if_no_admins(team):
                return Response({"detail": "Team auto-deleted (no admins remained)."})
        return Response(MemberSerializer(membership).data)


# ---------------------------------------------------------------------------
# Invitation acceptance / rejection (recipient-side)
# ---------------------------------------------------------------------------


class MyInvitationsView(APIView):
    """GET /api/invitations — pending invitations addressed to my email."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        qs = Invitation.objects.filter(
            invited_email__iexact=request.user.email,
            status=Invitation.Status.PENDING,
            expires_at__gt=timezone.now(),
        ).order_by("-created_at")
        return Response(InvitationForRecipientSerializer(qs, many=True).data)


class InvitationActionView(APIView):
    """POST /api/invitations/<token>/<accept|reject>"""

    permission_classes = [IsAuthenticated]

    def post(self, request: Request, token: str, action: str) -> Response:
        invitation = get_object_or_404(Invitation, token=token)
        if invitation.invited_email.lower() != request.user.email.lower():
            return Response({"detail": "This invitation is not for your email."}, status=403)
        if not invitation.is_pending_active:
            return Response({"detail": f"Invitation is {invitation.status}."}, status=400)

        if action == "accept":
            with transaction.atomic():
                Membership.objects.get_or_create(
                    team=invitation.team,
                    user=request.user,
                    defaults={"role": invitation.role_on_accept},
                )
                invitation.status = Invitation.Status.ACCEPTED
                invitation.save(update_fields=["status"])
            return Response({"team_id": invitation.team_id, "status": "accepted"})

        if action == "reject":
            invitation.status = Invitation.Status.REJECTED
            invitation.save(update_fields=["status"])
            return Response({"status": "rejected"})

        return Response({"detail": "Unknown action."}, status=400)
