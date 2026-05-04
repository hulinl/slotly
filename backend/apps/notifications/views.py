from __future__ import annotations

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Notification, default_notification_prefs
from .serializers import NotificationPrefsSerializer, NotificationSerializer


class NotificationListView(APIView):
    """
    GET /api/notifications
    GET /api/notifications?unread=1
        Returns up to 50 most-recent notifications with an `unread_count` summary.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        qs = Notification.objects.filter(recipient=request.user)
        unread_only = request.query_params.get("unread") in {"1", "true"}
        items = qs.filter(read_at__isnull=True) if unread_only else qs
        items = list(items[:50])
        unread_count = qs.filter(read_at__isnull=True).count()
        return Response({
            "results": NotificationSerializer(items, many=True).data,
            "unread_count": unread_count,
        })


class NotificationReadView(APIView):
    """POST /api/notifications/<id>/read — marks a single notification read."""

    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        n = get_object_or_404(Notification, pk=pk, recipient=request.user)
        if n.read_at is None:
            n.read_at = timezone.now()
            n.save(update_fields=["read_at"])
        return Response(NotificationSerializer(n).data)


class NotificationReadAllView(APIView):
    """POST /api/notifications/read-all — marks all my notifications read."""

    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        now = timezone.now()
        updated = Notification.objects.filter(
            recipient=request.user, read_at__isnull=True,
        ).update(read_at=now)
        return Response({"updated": updated})


class NotificationPrefsView(APIView):
    """
    GET  /api/me/notification-prefs   — current matrix
    PATCH /api/me/notification-prefs  — update (full replace; sparse keys allowed)
    """

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        # Backfill any new event types added since the user signed up.
        prefs = request.user.notification_prefs or {}
        defaults = default_notification_prefs()
        for k, v in defaults.items():
            prefs.setdefault(k, v)
        return Response(prefs)

    def patch(self, request: Request) -> Response:
        s = NotificationPrefsSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        merged = (request.user.notification_prefs or {}) | s.validated_data
        request.user.notification_prefs = merged
        request.user.save(update_fields=["notification_prefs"])
        return Response(merged)
