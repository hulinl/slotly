from __future__ import annotations

import uuid
from datetime import timedelta

from django.contrib.auth import get_user_model, logout
from django.db import models, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.availability.models import Unavailability
from apps.calendars.models import Calendar, CalendarEvent
from apps.notifications.dispatch import notify
from apps.notifications.models import Notification
from apps.teams.models import Membership, Team

from .serializers import MeSerializer, PublicProfileSerializer, TeammateSerializer

User = get_user_model()


class MeView(APIView):
    """GET / PATCH the authenticated user's profile + working hours."""

    permission_classes = [IsAuthenticated]
    parser_classes = (JSONParser, FormParser, MultiPartParser)

    def get(self, request: Request) -> Response:
        return Response(MeSerializer(request.user, context={"request": request}).data)

    def patch(self, request: Request) -> Response:
        serializer = MeSerializer(
            request.user,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        # Avatar comes through request.FILES, not in MeSerializer fields.
        if "avatar" in request.FILES:
            request.user.avatar = request.FILES["avatar"]
            request.user.save(update_fields=["avatar"])
        return Response(MeSerializer(request.user, context={"request": request}).data)


class RegenerateShareTokenView(APIView):
    """POST /api/me/share/regenerate — invalidate old public link, mint a new one."""

    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        request.user.share_token = uuid.uuid4()
        request.user.save(update_fields=["share_token"])
        return Response(
            MeSerializer(request.user, context={"request": request}).data,
        )


class PublicProfileView(APIView):
    """
    GET /api/public/profile/<token>?from=YYYY-MM-DD&to=YYYY-MM-DD

    Anonymous read of the user's busy windows + name + avatar + working hours.
    Returns 404 when share_enabled is False or the token doesn't match —
    deliberately no signal that "the user exists but is private".

    Window defaults to today through today+56 days when from/to omitted.
    Cap range to 84 days to keep payload bounded.
    """

    permission_classes = [AllowAny]
    authentication_classes: list = []  # never authenticate, never set session

    def get(self, request: Request, token: uuid.UUID) -> Response:
        user = User.objects.filter(share_token=token, share_enabled=True).first()
        if user is None:
            return Response(status=404)

        from_param = request.query_params.get("from")
        to_param = request.query_params.get("to")
        now = timezone.now()
        try:
            window_start = (
                _parse_iso_date(from_param) if from_param else now.replace(
                    hour=0, minute=0, second=0, microsecond=0,
                )
            )
            window_end = (
                _parse_iso_date(to_param) if to_param else window_start + timedelta(days=56)
            )
        except ValueError:
            return Response({"detail": "Invalid date format; expected YYYY-MM-DD."}, status=400)

        if window_end <= window_start:
            return Response({"detail": "to must be after from."}, status=400)
        if (window_end - window_start) > timedelta(days=84):
            window_end = window_start + timedelta(days=84)

        # Aggregate busy intervals from calendars + manual unavailability blocks.
        busy: list[tuple] = []
        for ev in CalendarEvent.objects.filter(
            calendar__owner_id=user.pk,
            calendar__include_in_busy=True,
            transp=CalendarEvent.Transparency.OPAQUE,
            dtstart__lt=window_end,
            dtend__gt=window_start,
        ).exclude(status=CalendarEvent.Status.CANCELLED).values("dtstart", "dtend"):
            busy.append((ev["dtstart"], ev["dtend"]))
        for u in Unavailability.objects.filter(
            user_id=user.pk,
            starts_at__lt=window_end,
            ends_at__gt=window_start,
        ).values("starts_at", "ends_at"):
            busy.append((u["starts_at"], u["ends_at"]))

        profile = PublicProfileSerializer(user, context={"request": request}).data
        return Response({
            "profile": profile,
            "window": {
                "start": window_start.isoformat(),
                "end": window_end.isoformat(),
            },
            "busy": [
                {"start": s.isoformat(), "end": e.isoformat()}
                for s, e in busy
            ],
            "holidays": _holidays_in_range(user.country, window_start.date(), window_end.date()),
        })


def _holidays_in_range(country: str, from_date, to_date) -> list[dict]:
    """Return public holidays for `country` falling within [from_date, to_date)."""
    import holidays as holidays_lib
    years = list(range(from_date.year, to_date.year + 1))
    try:
        entries = holidays_lib.country_holidays(country, years=years, language="en_US")
    except Exception:  # noqa: BLE001 — some countries lack en_US
        try:
            entries = holidays_lib.country_holidays(country, years=years)
        except Exception:  # noqa: BLE001 — unsupported country code
            return []
    return [
        {"date": d.isoformat(), "name": name}
        for d, name in sorted(entries.items())
        if from_date <= d < to_date
    ]


def _parse_iso_date(value: str):
    """Parse YYYY-MM-DD into a tz-aware datetime at midnight in the app TZ."""
    from datetime import datetime
    from django.conf import settings as dj_settings
    from zoneinfo import ZoneInfo
    naive = datetime.strptime(value, "%Y-%m-%d")
    return naive.replace(tzinfo=ZoneInfo(dj_settings.TIME_ZONE))


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


class TeammatesIndexView(APIView):
    """
    GET /api/users — list of users the caller can see (anyone in any
    team they're a member of). Used by the People index page.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        my_teams = Team.objects.filter(memberships__user=request.user).values_list("pk", flat=True)
        rows = (
            Membership.objects.filter(team_id__in=my_teams)
            .exclude(user=request.user)
            .select_related("user", "team")
            .values("user__id", "user__email", "user__first_name", "user__last_name", "team__name")
        )
        # Group rows per user with team list.
        bucket: dict[int, dict] = {}
        for r in rows:
            uid = r["user__id"]
            entry = bucket.setdefault(
                uid,
                {
                    "id": uid,
                    "email": r["user__email"],
                    "first_name": r["user__first_name"],
                    "last_name": r["user__last_name"],
                    "shared_team_names": [],
                },
            )
            entry["shared_team_names"].append(r["team__name"])
        # Stable sort: name first, email fallback.
        out = sorted(
            bucket.values(),
            key=lambda x: (
                (x["first_name"] + " " + x["last_name"]).strip().lower() or x["email"].lower(),
            ),
        )
        return Response(out)


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
