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

# Bootstrap fix: force-verify the founder account and clean up duplicate
# unverified users. Safe to leave running — idempotent.
if [[ -n "${BOOTSTRAP_VERIFY_EMAIL:-}" ]]; then
  echo "==> Force-verifying $BOOTSTRAP_VERIFY_EMAIL (bootstrap)"
  BOOTSTRAP_VERIFY_EMAIL="$BOOTSTRAP_VERIFY_EMAIL" python manage.py shell <<'PYEOF' || true
import os
from django.contrib.auth import get_user_model
from allauth.account.models import EmailAddress

User = get_user_model()
target = os.environ["BOOTSTRAP_VERIFY_EMAIL"]
qs = User.objects.filter(email__iexact=target).order_by("-id")
if not qs.exists():
    print(f"No user with email {target} — nothing to do")
else:
    keep = qs.first()
    extras = qs.exclude(pk=keep.pk)
    if extras.exists():
        print(f"Deleting {extras.count()} duplicate user(s) for {target}")
        extras.delete()
    ea, _ = EmailAddress.objects.update_or_create(
        user=keep, email=target,
        defaults={"verified": True, "primary": True},
    )
    print(f"Verified {target} (user_id={keep.pk})")
PYEOF
fi

echo "==> Starting gunicorn"
exec gunicorn slotly_api.wsgi:application \
  --bind 0.0.0.0:8000 \
  --workers 3 \
  --threads 2 \
  --timeout 120 \
  --access-logfile - \
  --error-logfile -
