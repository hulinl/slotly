from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers


class SearchInputSerializer(serializers.Serializer):
    team_id = serializers.IntegerField()
    member_ids = serializers.ListField(
        child=serializers.IntegerField(),
        min_length=1,
        max_length=200,
    )
    duration_min = serializers.IntegerField(min_value=15, max_value=24 * 60)
    window_start = serializers.DateTimeField(required=False)
    window_end = serializers.DateTimeField(required=False)
    buffer_min = serializers.IntegerField(min_value=0, max_value=4 * 60, default=0)

    def validate(self, attrs: dict) -> dict:
        attrs.setdefault("window_start", timezone.now())
        attrs.setdefault("window_end", attrs["window_start"] + timedelta(days=90))
        if attrs["window_start"] >= attrs["window_end"]:
            raise serializers.ValidationError(
                {"window_end": "must be later than window_start"},
            )
        if attrs["window_end"] - attrs["window_start"] > timedelta(days=180):
            raise serializers.ValidationError(
                {"window_end": "search window cannot exceed 180 days"},
            )
        # member_ids must be unique
        ids = attrs["member_ids"]
        if len(set(ids)) != len(ids):
            raise serializers.ValidationError({"member_ids": "must be unique"})
        return attrs
