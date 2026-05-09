from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Connection

User = get_user_model()


class ConnectionPeerSerializer(serializers.ModelSerializer):
    """Tiny embedded user payload for a Connection row — just enough for
    the Connections list UI to render avatar + display name."""

    display_name = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "email", "display_name", "avatar_url")
        read_only_fields = fields

    def get_display_name(self, obj) -> str:
        full = f"{obj.first_name or ''} {obj.last_name or ''}".strip()
        return full or obj.email.split("@")[0]

    def get_avatar_url(self, obj) -> str | None:
        if not obj.avatar:
            return None
        request = self.context.get("request")
        url = obj.avatar.url
        return request.build_absolute_uri(url) if request else url


class ConnectionSerializer(serializers.ModelSerializer):
    peer = serializers.SerializerMethodField()
    direction = serializers.SerializerMethodField()

    class Meta:
        model = Connection
        fields = ("id", "status", "direction", "peer", "created_at", "accepted_at")
        read_only_fields = fields

    def _viewer_id(self) -> int | None:
        request = self.context.get("request")
        if request and request.user and request.user.is_authenticated:
            return request.user.pk
        return None

    def get_peer(self, obj):
        viewer_id = self._viewer_id()
        if viewer_id is None:
            return None
        peer_id = obj.other_user_id(viewer_id)
        peer = User.objects.filter(pk=peer_id).first()
        if peer is None:
            return None
        return ConnectionPeerSerializer(peer, context=self.context).data

    def get_direction(self, obj) -> str:
        """One of: incoming (someone asked me, I haven't acted),
        outgoing (I asked, waiting for them), accepted (already friends)."""
        if obj.status == Connection.Status.ACCEPTED:
            return "accepted"
        viewer_id = self._viewer_id()
        if viewer_id is None or obj.requested_by_id == viewer_id:
            return "outgoing"
        return "incoming"
