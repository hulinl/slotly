from __future__ import annotations

from datetime import timedelta

from rest_framework import serializers

from .models import Unavailability

MAX_RANGE = timedelta(days=365)


class UnavailabilitySerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)

    class Meta:
        model = Unavailability
        fields = (
            "id",
            "user_id",
            "label",
            "starts_at",
            "ends_at",
            "is_all_day",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "user_id", "created_at", "updated_at")

    def validate_label(self, value: str) -> str:
        v = (value or "").strip()
        if not v:
            raise serializers.ValidationError("Label is required.")
        return v[:200]

    def validate(self, attrs: dict) -> dict:
        starts = attrs.get("starts_at") or (self.instance.starts_at if self.instance else None)
        ends = attrs.get("ends_at") or (self.instance.ends_at if self.instance else None)
        if starts is None or ends is None:
            raise serializers.ValidationError("starts_at and ends_at are required.")
        if ends <= starts:
            raise serializers.ValidationError(
                {"ends_at": "Must be after starts_at."},
            )
        if (ends - starts) > MAX_RANGE:
            raise serializers.ValidationError(
                {"ends_at": "Range cannot exceed 365 days."},
            )
        return attrs
