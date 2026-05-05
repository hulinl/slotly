from __future__ import annotations

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from .models import Calendar
from .serializers import (
    CalendarCreateSerializer,
    CalendarReadSerializer,
    CalendarUpdateSerializer,
)
from .sync import sync_calendar
from .tasks import sync_one


class CalendarViewSet(ModelViewSet):
    """
    /api/calendars  GET   — list mine
                    POST  — create (paste URL)
    /api/calendars/<id>  GET     — retrieve
                         PATCH   — rename / toggle include_in_busy
                         DELETE  — remove
    /api/calendars/<id>/sync  POST — sync immediately
    """

    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Calendar.objects.filter(owner=self.request.user)

    def get_serializer_class(self):
        if self.action == "create":
            return CalendarCreateSerializer
        if self.action in {"update", "partial_update"}:
            return CalendarUpdateSerializer
        return CalendarReadSerializer

    def create(self, request: Request, *args, **kwargs) -> Response:
        write = CalendarCreateSerializer(data=request.data, context={"request": request})
        write.is_valid(raise_exception=True)
        calendar = write.save()
        # Mark "syncing" up front so the row appears in that state in the
        # immediate response, then enqueue the actual fetch on the worker.
        # Microsoft 365 in particular routinely takes 20–40s on the first
        # request — way too long to keep an HTTP request open.
        Calendar.objects.filter(pk=calendar.pk).update(status=Calendar.Status.SYNCING)
        try:
            sync_one.delay(calendar.pk)
        except Exception:
            # Broker unreachable (no Redis in the prod plan) — fall back to
            # an inline sync so the calendar still gets populated, just
            # slower for this one request.
            sync_calendar(calendar)
        calendar.refresh_from_db()
        return Response(
            CalendarReadSerializer(calendar).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="sync")
    def sync(self, request: Request, pk: int | None = None) -> Response:
        calendar = self.get_object()
        result = sync_calendar(calendar)
        calendar.refresh_from_db()
        body = CalendarReadSerializer(calendar).data
        body["sync"] = {
            "status_code": result.status_code,
            "fetched": result.fetched,
            "written": result.written,
            "deleted": result.deleted,
            "notes": result.notes,
        }
        return Response(body)

    @action(detail=False, methods=["post"], url_path="sync-all")
    def sync_all_mine(self, request: Request) -> Response:
        """
        Force-refresh every calendar the caller owns (include_in_busy=True).
        Used by the "Refresh my calendars" button on /search so users can
        pull just-changed Google/Outlook events without waiting for the
        next Beat tick. Other team members' data is unaffected — only
        the calendar's owner can trigger their own sync.
        """
        ids = list(
            Calendar.objects.filter(owner=request.user, include_in_busy=True)
            .values_list("pk", flat=True),
        )
        Calendar.objects.filter(pk__in=ids).update(status=Calendar.Status.SYNCING)
        for cal_id in ids:
            try:
                sync_one.delay(cal_id)
            except Exception:
                # Broker unreachable — degrade to inline.
                cal = Calendar.objects.get(pk=cal_id)
                sync_calendar(cal)
        return Response({"queued": len(ids)})
