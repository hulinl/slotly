from __future__ import annotations

from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ("id", "type", "payload", "read_at", "created_at")
        read_only_fields = fields


class NotificationPrefsSerializer(serializers.Serializer):
    """A flat dict event_id -> {email: bool, in_app: bool}. Validated for shape."""

    def to_representation(self, user) -> dict:
        return user.notification_prefs or {}

    def to_internal_value(self, data) -> dict:
        if not isinstance(data, dict):
            raise serializers.ValidationError("Expected an object keyed by event id")
        cleaned: dict[str, dict] = {}
        for key, value in data.items():
            if not isinstance(value, dict):
                raise serializers.ValidationError({key: "Must be an object"})
            extra = set(value.keys()) - {"email", "in_app"}
            if extra:
                raise serializers.ValidationError({key: f"Unknown channels: {sorted(extra)}"})
            cleaned[key] = {
                "email": bool(value.get("email", True)),
                "in_app": bool(value.get("in_app", True)),
            }
        return cleaned
