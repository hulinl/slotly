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
        # First sync runs synchronously so the client gets immediate feedback
        # ("did the URL we just pasted actually work?"). Subsequent polls are
        # done by Celery Beat.
        result = sync_calendar(calendar)
        calendar.refresh_from_db()
        body = CalendarReadSerializer(calendar).data
        body["sync"] = {
            "status_code": result.status_code,
            "fetched": result.fetched,
            "written": result.written,
            "notes": result.notes,
        }
        return Response(body, status=status.HTTP_201_CREATED)

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
