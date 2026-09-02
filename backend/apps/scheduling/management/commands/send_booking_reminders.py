"""
Mail visitors a T-24h reminder for their confirmed Slotly booking.

Runs from a Container Apps Job on a cron (e.g. every 30 min). Each pass
finds Booking rows whose ``start_at`` falls in the [now+23h, now+25h]
window and that we haven't reminded yet (``reminded_at`` is NULL), mails
the visitor, and stamps ``reminded_at`` so subsequent runs skip them.

Idempotent + safe on overlap: two concurrent invocations racing on the
same row will both mail (rare) but the second's ``reminded_at`` write
just overwrites the first's — no error, no duplicate stamp.

Usage:
    python manage.py send_booking_reminders
    python manage.py send_booking_reminders --dry-run
    python manage.py send_booking_reminders --window-hours 24 --slack-hours 1
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.core.mail import EmailMultiAlternatives
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.notifications.emails import html_shell, kv_rows, paragraph
from apps.scheduling.models import Booking

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Send T-24h reminder emails for confirmed public Slotly bookings."

    def add_arguments(self, parser):
        parser.add_argument(
            "--window-hours",
            type=float,
            default=24,
            help="Send reminder this many hours before start_at (default 24).",
        )
        parser.add_argument(
            "--slack-hours",
            type=float,
            default=1,
            help="Window half-width. Job that runs every 30 min needs "
                 "slack ≥ 0.5h so late runs still catch the bucket. Default 1.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Log what would be sent without touching mail or the DB.",
        )

    def handle(self, *args, window_hours: float, slack_hours: float, dry_run: bool, **_):
        from django.conf import settings as _settings

        now = timezone.now()
        window_center = now + timedelta(hours=window_hours)
        window_start = window_center - timedelta(hours=slack_hours)
        window_end = window_center + timedelta(hours=slack_hours)

        qs = Booking.objects.filter(
            status=Booking.Status.CONFIRMED,
            reminded_at__isnull=True,
            start_at__gte=window_start,
            start_at__lte=window_end,
        ).select_related("host")

        rows = list(qs)
        self.stdout.write(
            f"Reminder window {window_start.isoformat()} → {window_end.isoformat()}: "
            f"{len(rows)} booking(s) to remind"
        )

        sent = 0
        for b in rows:
            try:
                self._send(b, dry_run=dry_run, frontend_base=_settings.FRONTEND_BASE_URL)
                if not dry_run:
                    Booking.objects.filter(pk=b.pk).update(reminded_at=timezone.now())
                sent += 1
            except Exception as exc:  # noqa: BLE001 — one bad row shouldn't kill the whole run
                logger.warning("reminder failed for booking %s: %s", b.uuid, exc)
                self.stdout.write(self.style.WARNING(f"  {b.uuid}: FAILED — {exc}"))

        self.stdout.write(
            self.style.SUCCESS(
                f"Reminded {sent}/{len(rows)} bookings"
                + (" (dry-run — no emails, no DB writes)" if dry_run else "")
            )
        )

    def _send(self, b: Booking, *, dry_run: bool, frontend_base: str) -> None:
        from django.conf import settings as _settings

        if not b.visitor_email:
            self.stdout.write(f"  {b.uuid}: skipped — no visitor email on row")
            return

        host_name = f"{b.host.first_name} {b.host.last_name}".strip() or b.host.email
        when = b.start_at.strftime("%A %d %B, %H:%M")

        subject = f"Reminder: your meeting with {host_name} tomorrow at {b.start_at.strftime('%H:%M')}"
        text_body = (
            f"Hi {b.visitor_name or 'there'},\n\n"
            f"This is a quick reminder that you have a meeting with {host_name} "
            f"{when}."
        )
        if b.location:
            text_body += f"\n\nWhere: {b.location}"
        text_body += f"\n\nNeed to cancel? {frontend_base.rstrip('/')}/b/{b.uuid}"

        html_body = html_shell(
            title=f"See you tomorrow, {b.visitor_name or 'there'}",
            intro_html=(
                paragraph(
                    f"Just a friendly reminder — you have a meeting with "
                    f"{host_name} coming up."
                )
                + kv_rows([
                    ("When", when),
                    ("Where" if b.location else "", b.location),
                ])
                + paragraph(
                    "The calendar invite is already in your inbox with any "
                    "video link.",
                    muted=True,
                )
            ),
            cta_label="Manage or cancel",
            cta_url=f"{frontend_base.rstrip('/')}/b/{b.uuid}",
        )

        self.stdout.write(f"  {b.uuid}: → {b.visitor_email} ({when})")
        if dry_run:
            return

        msg = EmailMultiAlternatives(
            subject=f"[Slotly] {subject}",
            body=text_body,
            from_email=_settings.DEFAULT_FROM_EMAIL,
            to=[b.visitor_email],
        )
        msg.attach_alternative(html_body, "text/html")
        msg.send(fail_silently=False)
