from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from apps.teams.models import Membership

from .models import RecentSearch, SavedSearch


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
    # Profile widgets visualize multiple weeks at once and need more headroom
    # than the default search-results card. Hard ceiling 5000 keeps the JSON
    # payload bounded.
    limit = serializers.IntegerField(min_value=1, max_value=5000, default=100)

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


# ---------------------------------------------------------------------------
# Saved + recent searches
# ---------------------------------------------------------------------------


class SavedSearchSerializer(serializers.ModelSerializer):
    class Meta:
        model = SavedSearch
        fields = (
            "id",
            "name",
            "team",
            "member_ids",
            "duration_min",
            "buffer_min",
            "window_days",
            "created_at",
            "last_used_at",
        )
        read_only_fields = ("id", "created_at", "last_used_at")

    def validate_name(self, value: str) -> str:
        v = (value or "").strip()
        if not v:
            raise serializers.ValidationError("Name is required")
        return v[:200]

    def validate_duration_min(self, value: int) -> int:
        if value < 15 or value > 24 * 60:
            raise serializers.ValidationError("Must be between 15 and 1440 minutes")
        return value

    def validate_buffer_min(self, value: int) -> int:
        if value < 0 or value > 4 * 60:
            raise serializers.ValidationError("Must be between 0 and 240 minutes")
        return value

    def validate_window_days(self, value: int) -> int:
        if value < 1 or value > 180:
            raise serializers.ValidationError("Must be between 1 and 180 days")
        return value

    def validate(self, attrs: dict) -> dict:
        request = self.context["request"]
        team = attrs.get("team") or (self.instance.team if self.instance else None)
        member_ids = attrs.get("member_ids")
        if member_ids is None and self.instance is not None:
            member_ids = self.instance.member_ids
        if not member_ids:
            raise serializers.ValidationError({"member_ids": "Pick at least one teammate"})
        if team is None:
            raise serializers.ValidationError({"team": "required"})
        # Caller must be a member of the chosen team.
        if not Membership.objects.filter(team=team, user=request.user).exists():
            raise serializers.ValidationError({"team": "You are not a member of this team."})
        # Members must all belong to the team.
        valid = set(
            Membership.objects.filter(team=team, user_id__in=member_ids)
            .values_list("user_id", flat=True),
        )
        bad = set(member_ids) - valid
        if bad:
            raise serializers.ValidationError(
                {"member_ids": f"Some users are not members of this team: {sorted(bad)}"},
            )
        # Uniqueness check (owner, name) — DRF doesn't auto-handle composite unique with owner
        # set in perform_create, so we check explicitly.
        name = attrs.get("name", "").strip() or (self.instance.name if self.instance else "")
        qs = SavedSearch.objects.filter(owner=request.user, name=name)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(
                {"name": "You already have a saved search with this name."},
            )
        return attrs


class RecentSearchSerializer(serializers.ModelSerializer):
    class Meta:
        model = RecentSearch
        fields = (
            "id",
            "team",
            "member_ids",
            "duration_min",
            "buffer_min",
            "window_start",
            "window_end",
            "created_at",
        )
        read_only_fields = fields
