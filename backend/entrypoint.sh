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

# Bootstrap fix: force-verify accounts whose verification email confused
# them or never arrived. Set BOOTSTRAP_VERIFY_EMAILS to a comma-separated
# list and the next container start will mark each EmailAddress verified.
# Idempotent — safe to leave the env var set across deploys.
if [[ -n "${BOOTSTRAP_VERIFY_EMAILS:-${BOOTSTRAP_VERIFY_EMAIL:-}}" ]]; then
  EMAILS="${BOOTSTRAP_VERIFY_EMAILS:-$BOOTSTRAP_VERIFY_EMAIL}"
  echo "==> Force-verifying: $EMAILS"
  BOOTSTRAP_VERIFY_EMAILS="$EMAILS" python manage.py shell <<'PYEOF' || true
import os
from django.contrib.auth import get_user_model
from allauth.account.models import EmailAddress

User = get_user_model()
raw = os.environ["BOOTSTRAP_VERIFY_EMAILS"]
targets = [e.strip() for e in raw.split(",") if e.strip()]
for target in targets:
    qs = User.objects.filter(email__iexact=target).order_by("-id")
    if not qs.exists():
        print(f"  [skip] {target}: no user")
        continue
    keep = qs.first()
    extras = qs.exclude(pk=keep.pk)
    if extras.exists():
        print(f"  [{target}] deleting {extras.count()} duplicate(s)")
        extras.delete()
    EmailAddress.objects.update_or_create(
        user=keep, email=target,
        defaults={"verified": True, "primary": True},
    )
    print(f"  [{target}] verified, user_id={keep.pk}")
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
