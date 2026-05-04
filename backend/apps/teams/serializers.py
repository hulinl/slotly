from __future__ import annotations

from django.utils import timezone
from rest_framework import serializers

from .models import Invitation, Membership, Team


class MemberSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    first_name = serializers.CharField(source="user.first_name", read_only=True)
    last_name = serializers.CharField(source="user.last_name", read_only=True)

    class Meta:
        model = Membership
        fields = ("user_id", "email", "first_name", "last_name", "role", "joined_at")
        read_only_fields = fields


class InvitationSerializer(serializers.ModelSerializer):
    """Outbound shape; the token is intentionally never exposed via list/detail."""

    invited_by_email = serializers.EmailField(source="invited_by.email", read_only=True)
    is_active = serializers.SerializerMethodField()

    class Meta:
        model = Invitation
        fields = (
            "id",
            "invited_email",
            "invited_by_email",
            "status",
            "role_on_accept",
            "created_at",
            "expires_at",
            "is_active",
        )
        read_only_fields = fields

    def get_is_active(self, obj: Invitation) -> bool:
        return obj.is_pending_active


class InvitationForRecipientSerializer(serializers.ModelSerializer):
    """Sent to /api/invitations — what *I* see for invites addressed to me."""

    team_id = serializers.IntegerField(source="team.id", read_only=True)
    team_name = serializers.CharField(source="team.name", read_only=True)
    invited_by_email = serializers.EmailField(source="invited_by.email", read_only=True)
    token = serializers.CharField(read_only=True)

    class Meta:
        model = Invitation
        fields = (
            "id",
            "team_id",
            "team_name",
            "invited_by_email",
            "role_on_accept",
            "created_at",
            "expires_at",
            "token",
        )
        read_only_fields = fields


class TeamListSerializer(serializers.ModelSerializer):
    member_count = serializers.IntegerField(read_only=True)
    my_role = serializers.SerializerMethodField()

    class Meta:
        model = Team
        fields = ("id", "name", "description", "member_count", "my_role", "created_at")
        read_only_fields = fields

    def get_my_role(self, obj: Team) -> str | None:
        user = self.context["request"].user
        m = Membership.objects.filter(team=obj, user=user).first()
        return m.role if m else None


class TeamDetailSerializer(TeamListSerializer):
    members = MemberSerializer(source="memberships", many=True, read_only=True)
    invitations = serializers.SerializerMethodField()

    class Meta(TeamListSerializer.Meta):
        fields = TeamListSerializer.Meta.fields + ("members", "invitations")
        read_only_fields = fields

    def get_invitations(self, obj: Team):
        # Show only pending+active invitations; expired ones are pruned in the
        # view before returning.
        qs = obj.invitations.filter(status=Invitation.Status.PENDING, expires_at__gt=timezone.now())
        return InvitationSerializer(qs, many=True).data


class TeamCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Team
        fields = ("id", "name", "description")
        read_only_fields = ("id",)

    def validate_name(self, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise serializers.ValidationError("Team name is required")
        return v[:200]


class TeamUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Team
        fields = ("name", "description")
