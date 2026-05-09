from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.notifications.dispatch import notify
from apps.notifications.models import Notification

from .models import Connection
from .serializers import ConnectionSerializer

User = get_user_model()


def _to_canonical_pair(a_id: int, b_id: int) -> tuple[int, int]:
    return (a_id, b_id) if a_id < b_id else (b_id, a_id)


class ConnectionListView(APIView):
    """GET /api/connections — every connection involving the caller, in any
    state (pending in either direction, accepted). The serializer attaches
    a `direction` field so the UI can split them into 'incoming' (Accept /
    Reject), 'outgoing' (Cancel) and 'accepted' (your peers)."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        qs = Connection.objects.filter(
            Q(user_low=request.user) | Q(user_high=request.user),
        ).order_by("-accepted_at", "-created_at")
        return Response(
            ConnectionSerializer(qs, many=True, context={"request": request}).data,
        )


class ConnectionRequestView(APIView):
    """POST /api/connections/request {email} — send a connection request."""

    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        email = (request.data.get("email") or "").strip().lower()
        if not email:
            return Response({"detail": "Email is required."}, status=400)
        target = User.objects.filter(email__iexact=email).first()
        if target is None:
            return Response(
                {
                    "detail": (
                        "No Slotly account with that email yet. Invite them via "
                        "Groups → Invite, or share your public link."
                    ),
                },
                status=404,
            )
        if target.pk == request.user.pk:
            return Response({"detail": "You can't connect with yourself."}, status=400)

        low, high = _to_canonical_pair(request.user.pk, target.pk)
        try:
            with transaction.atomic():
                conn, created = Connection.objects.get_or_create(
                    user_low_id=low,
                    user_high_id=high,
                    defaults={
                        "requested_by": request.user,
                        "status": Connection.Status.PENDING,
                    },
                )
        except IntegrityError:
            return Response({"detail": "Connection already exists."}, status=409)

        if not created:
            # Already exists. If the other party had already requested, the
            # caller's POST acts as an Accept — convert to accepted.
            if (
                conn.status == Connection.Status.PENDING
                and conn.requested_by_id != request.user.pk
            ):
                conn.status = Connection.Status.ACCEPTED
                conn.accepted_at = timezone.now()
                conn.save(update_fields=["status", "accepted_at"])
                notify(
                    conn.requested_by,
                    Notification.Type.CONNECTION_ACCEPTED,
                    {"by_email": request.user.email},
                )
                return Response(
                    ConnectionSerializer(conn, context={"request": request}).data,
                    status=200,
                )
            # Otherwise it's the same caller re-requesting, or already accepted.
            return Response(
                ConnectionSerializer(conn, context={"request": request}).data,
                status=200,
            )

        # Brand-new pending row — notify the receiving user.
        notify(
            target,
            Notification.Type.CONNECTION_REQUESTED,
            {"from_email": request.user.email},
        )
        return Response(
            ConnectionSerializer(conn, context={"request": request}).data,
            status=201,
        )


class ConnectionDetailView(APIView):
    """POST /api/connections/<id>/accept, /reject — actions only the
    receiving user can take. DELETE /api/connections/<id> — un-connect
    (either user, accepted or pending)."""

    permission_classes = [IsAuthenticated]

    def _get_my_connection(self, request: Request, pk: int) -> Connection:
        return get_object_or_404(
            Connection.objects.filter(Q(user_low=request.user) | Q(user_high=request.user)),
            pk=pk,
        )

    def delete(self, request: Request, pk: int) -> Response:
        conn = self._get_my_connection(request, pk)
        conn.delete()
        return Response(status=204)


class ConnectionAcceptView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        conn = get_object_or_404(
            Connection.objects.filter(Q(user_low=request.user) | Q(user_high=request.user)),
            pk=pk,
        )
        if conn.status != Connection.Status.PENDING:
            return Response({"detail": "Not a pending request."}, status=400)
        if conn.requested_by_id == request.user.pk:
            return Response(
                {"detail": "You can't accept your own request."},
                status=400,
            )
        conn.status = Connection.Status.ACCEPTED
        conn.accepted_at = timezone.now()
        conn.save(update_fields=["status", "accepted_at"])
        notify(
            conn.requested_by,
            Notification.Type.CONNECTION_ACCEPTED,
            {"by_email": request.user.email},
        )
        return Response(
            ConnectionSerializer(conn, context={"request": request}).data,
        )


class ConnectionRejectView(APIView):
    """Reject == delete the pending row (we don't keep a 'rejected' state —
    they can re-request later if circumstances change)."""

    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        conn = get_object_or_404(
            Connection.objects.filter(Q(user_low=request.user) | Q(user_high=request.user)),
            pk=pk,
        )
        if conn.status != Connection.Status.PENDING:
            return Response({"detail": "Not a pending request."}, status=400)
        if conn.requested_by_id == request.user.pk:
            return Response(
                {"detail": "Use DELETE to cancel your own request."},
                status=400,
            )
        conn.delete()
        return Response(status=204)
