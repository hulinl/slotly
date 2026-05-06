#!/usr/bin/env bash
# Container entrypoint. Runs migrations + cache-table bootstrap (both
# idempotent), then hands off to gunicorn.
set -euo pipefail

echo "==> Running migrations"
python manage.py migrate --noinput

echo "==> Ensuring django_cache table"
python manage.py createcachetable django_cache || true

echo "==> Starting gunicorn"
exec gunicorn slotly_api.wsgi:application \
  --bind 0.0.0.0:8000 \
  --workers 3 \
  --threads 2 \
  --timeout 120 \
  --access-logfile - \
  --error-logfile -
