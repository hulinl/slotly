#!/usr/bin/env bash
# Container entrypoint. Runs migrations + cache-table bootstrap (both
# idempotent), then hands off to gunicorn.
set -euo pipefail

echo "==> Running migrations"
python manage.py migrate --noinput

echo "==> Ensuring django_cache table"
python manage.py createcachetable django_cache || true

echo "==> Configuring Django Site (used by allauth in emails)"
python manage.py shell -c "
from django.contrib.sites.models import Site
s, created = Site.objects.update_or_create(
    id=1,
    defaults={'domain': 'slotly.team', 'name': 'Slotly'},
)
print(f'Site: {s.name} ({s.domain}) — created={created}')
" || true

echo "==> Starting gunicorn"
exec gunicorn slotly_api.wsgi:application \
  --bind 0.0.0.0:8000 \
  --workers 3 \
  --threads 2 \
  --timeout 120 \
  --access-logfile - \
  --error-logfile -
