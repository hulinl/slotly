"""
Management command: poll every enabled calendar synchronously.

In Phase-1 production this replaces the Celery worker + Beat duo. The
intended deployment is an Azure Container Apps Job triggered by a 5-minute
cron. Each invocation:

    docker run ... python manage.py poll_calendars

is short-lived, hits the DB once, parses the ICS feeds, exits — keeping us
under the Container Apps free grant. No broker required.
"""

from __future__ import annotations

import logging
import time

from django.core.management.base import BaseCommand

from apps.calendars.models import Calendar
from apps.calendars.sync import sync_calendar

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Synchronously poll every Calendar that's marked include_in_busy."

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help="Stop after this many calendars (default: 0 = all).",
        )
        parser.add_argument(
            "--user",
            type=str,
            default=None,
            help="Only sync calendars owned by this email (debug helper).",
        )

    def handle(self, *args, limit: int, user: str | None, **kwargs):
        qs = Calendar.objects.filter(include_in_busy=True).select_related("owner")
        if user:
            qs = qs.filter(owner__email__iexact=user)
        if limit > 0:
            qs = qs[:limit]

        started = time.monotonic()
        synced = 0
        failed = 0
        for cal in qs:
            try:
                result = sync_calendar(cal)
                synced += 1
                self.stdout.write(
                    f"  ✓ {cal.pk:>4}  {cal.owner.email}  {cal.name!r}  "
                    f"status={result.status_code}  written={result.written}",
                )
            except Exception as exc:  # noqa: BLE001 — never crash the whole poll
                failed += 1
                logger.exception("Calendar %s sync raised", cal.pk)
                self.stdout.write(self.style.ERROR(
                    f"  ✗ {cal.pk:>4}  {cal.owner.email}  {cal.name!r}  raised {exc!r}",
                ))

        elapsed = time.monotonic() - started
        self.stdout.write(
            self.style.SUCCESS(
                f"\nPolled {synced + failed} calendars in {elapsed:.1f}s "
                f"({synced} ok, {failed} failed).",
            ),
        )
