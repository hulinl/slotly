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

# Diagnostic: validate a password-reset key end-to-end and dump the reason
# it succeeds or fails. Set DEBUG_RESET_KEY="<email>:<key>" to use.
if [[ -n "${DEBUG_RESET_KEY:-}" ]]; then
  echo "==> DEBUG_RESET_KEY validation"
  DEBUG_RESET_KEY="$DEBUG_RESET_KEY" python manage.py shell <<'PYEOF' || true
import os
from django.contrib.auth import get_user_model
from django.utils.http import base36_to_int
from allauth.account.forms import EmailAwarePasswordResetTokenGenerator
from allauth.account.models import EmailAddress
import datetime as _dt

raw = os.environ["DEBUG_RESET_KEY"]
email, _, key = raw.partition(":")
print(f"  email='{email}', key='{key}'")
User = get_user_model()
u = User.objects.filter(email__iexact=email).first()
if not u:
    print("  user not found")
else:
    print(f"  user_id={u.pk}, last_login={u.last_login}, password_hash_prefix={u.password[:20]}...")
    primaries = list(EmailAddress.objects.filter(user=u, primary=True).values_list("email", "verified"))
    print(f"  primary EmailAddresses={primaries}")
    parts = key.split("-", 1)
    if len(parts) != 2:
        print(f"  KEY FORMAT INVALID — expected '<uid>-<token>', got {parts!r}")
    else:
        uid_str, token = parts
        try:
            uid = base36_to_int(uid_str)
            print(f"  uid (base36 decoded) = {uid}")
        except Exception as e:
            print(f"  uid decode error: {e}")
            uid = None
        if uid != u.pk:
            print(f"  WARNING: uid in key ({uid}) != email's user_id ({u.pk})")
        gen = EmailAwarePasswordResetTokenGenerator()
        valid = gen.check_token(u, token)
        print(f"  check_token() returned: {valid}")
        if not valid:
            # Try the next-bigger window manually to see if it's just timeout
            ts_b36 = token.split("-")[0]
            try:
                ts = base36_to_int(ts_b36)
                age = gen._num_seconds(gen._now()) - ts
                print(f"  token timestamp seconds={ts}, age_seconds={age}, timeout=259200 (3d)")
            except Exception as e:
                print(f"  ts decode error: {e}")
PYEOF
fi

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
