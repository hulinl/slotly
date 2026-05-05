from __future__ import annotations

from datetime import timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from apps.calendars.models import CalendarEvent
from apps.teams.models import Membership, Team
from apps.teams.permissions import is_member

from .engine import compute_slots
from .models import RECENT_SEARCH_LIMIT, RecentSearch, SavedSearch
from .serializers import (
    RecentSearchSerializer,
    SavedSearchSerializer,
    SearchInputSerializer,
)

User = get_user_model()


class SearchView(APIView):
    """
    POST /api/search
        body: {
            team_id, member_ids[], duration_min,
            window_start?, window_end?, buffer_min?
        }
        response: { slots: [{start, end}], count, truncated }

    Side-effect: a RecentSearch row is recorded for the caller and the
    list is trimmed to the latest RECENT_SEARCH_LIMIT entries.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        s = SearchInputSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = s.validated_data

        team = get_object_or_404(Team, pk=data["team_id"])
        if not is_member(request.user, team):
            return Response({"detail": "You are not a member of this team."}, status=403)

        team_member_ids = set(
            Membership.objects.filter(team=team, user_id__in=data["member_ids"])
            .values_list("user_id", flat=True),
        )
        bad = set(data["member_ids"]) - team_member_ids
        if bad:
            return Response(
                {"detail": f"Some users are not members of this team: {sorted(bad)}"},
                status=400,
            )

        users = User.objects.filter(pk__in=team_member_ids)
        working_hours_per_user = {u.pk: u.working_hours for u in users}

        events = CalendarEvent.objects.filter(
            calendar__owner_id__in=team_member_ids,
            calendar__include_in_busy=True,
            transp=CalendarEvent.Transparency.OPAQUE,
            dtstart__lt=data["window_end"],
            dtend__gt=data["window_start"],
        ).exclude(
            status=CalendarEvent.Status.CANCELLED,
        ).values("calendar__owner_id", "dtstart", "dtend")

        busy_per_user: dict[int, list[tuple]] = {uid: [] for uid in team_member_ids}
        for ev in events:
            busy_per_user[ev["calendar__owner_id"]].append((ev["dtstart"], ev["dtend"]))

        slots, truncated = compute_slots(
            working_hours_per_user=working_hours_per_user,
            busy_per_user=busy_per_user,
            user_ids=list(team_member_ids),
            window_start=data["window_start"],
            window_end=data["window_end"],
            duration=timedelta(minutes=data["duration_min"]),
            buffer=timedelta(minutes=data["buffer_min"]),
            tz=ZoneInfo(settings.TIME_ZONE),
            max_results=100,
        )

        # Record to history (best-effort; never block the search response).
        try:
            _record_recent_search(request.user, team, data)
        except Exception:  # noqa: BLE001
            pass

        return Response({
            "slots": [
                {"start": slot.start.isoformat(), "end": slot.end.isoformat()}
                for slot in slots
            ],
            "count": len(slots),
            "truncated": truncated,
        })


def _record_recent_search(user, team: Team, data: dict) -> None:
    RecentSearch.objects.create(
        owner=user,
        team=team,
        member_ids=data["member_ids"],
        duration_min=data["duration_min"],
        buffer_min=data["buffer_min"],
        window_start=data["window_start"],
        window_end=data["window_end"],
    )
    keep_ids = list(
        RecentSearch.objects.filter(owner=user)
        .order_by("-created_at")
        .values_list("pk", flat=True)[:RECENT_SEARCH_LIMIT],
    )
    RecentSearch.objects.filter(owner=user).exclude(pk__in=keep_ids).delete()


# ---------------------------------------------------------------------------
# Saved searches CRUD
# ---------------------------------------------------------------------------


class SavedSearchViewSet(ModelViewSet):
    serializer_class = SavedSearchSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return SavedSearch.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def perform_update(self, serializer):
        serializer.save(owner=self.request.user)


# ---------------------------------------------------------------------------
# Recent searches (read-only list + delete-one)
# ---------------------------------------------------------------------------


class RecentSearchListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        qs = RecentSearch.objects.filter(owner=request.user).order_by("-created_at")[:RECENT_SEARCH_LIMIT]
        return Response(RecentSearchSerializer(qs, many=True).data)


class RecentSearchDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request: Request, pk: int) -> Response:
        deleted, _ = RecentSearch.objects.filter(owner=request.user, pk=pk).delete()
        if deleted == 0:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)
