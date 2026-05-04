"""Celery application bootstrap. Run worker: `celery -A slotly_api worker -l info`."""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "slotly_api.settings")

app = Celery("slotly_api")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
