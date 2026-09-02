# Booking reminder job — schedule on Azure Container Apps

Slotly can mail visitors a T-24h reminder for every confirmed public
booking. The delivery is a Django management command; the schedule is
just another Azure Container Apps Job (same pattern as the existing
`slotly-poll-calendars`).

Local dry-run first (no mail, no DB writes):

```bash
cd backend
.venv/bin/python manage.py send_booking_reminders --dry-run
```

Output lists which visitors would be mailed and why. Good sanity check
before scheduling on prod.

---

## Prod schedule via Container Apps Job

Same image as `slotly-backend`, override the entrypoint to run the
command instead of gunicorn. Cron expression `*/30 * * * *` — a half-
hour cadence with the default `--slack-hours 1` guarantees every T-24h
booking gets exactly one reminder (with slack ≥ half-period).

```bash
# One-time create (mirrors slotly-poll-calendars in infra/main.bicep).
az containerapp job create \
  --name slotly-booking-reminders \
  --resource-group slotly-prod \
  --environment slotly-env \
  --trigger-type Schedule \
  --cron-expression "*/30 * * * *" \
  --parallelism 1 \
  --replica-timeout 120 \
  --image slotlyacrqhdspf.azurecr.io/slotly-backend:latest \
  --command "python" \
  --args "manage.py send_booking_reminders" \
  --registry-server slotlyacrqhdspf.azurecr.io \
  --registry-identity system \
  --env-vars \
    DJANGO_SETTINGS_MODULE=slotly_api.settings_prod \
    DJANGO_DEBUG=False \
    "DJANGO_ALLOWED_HOSTS=api.slotly.team" \
    "FRONTEND_BASE_URL=https://slotly.team" \
    DEFAULT_FROM_EMAIL=noreply@slotly.team \
  --secrets \
    django-secret=<same-as-backend> \
    pg-url=<same-as-backend> \
    cal-key=<same-as-backend> \
    acs-conn=<same-as-backend>
```

Or add the job to `infra/main.bicep` alongside `jobPollCalendars`
so it survives future infra re-deploys — copy-paste that resource, swap
name/args/schedule, done.

Verify the first run:

```bash
az containerapp job execution list \
  --name slotly-booking-reminders \
  --resource-group slotly-prod \
  --query '[0].properties'
```

Should show `Status: Succeeded`. Logs stream to the same env log analytics
workspace as the backend — grep for `send_booking_reminders`.

---

## Tuning

- `--window-hours 24` — how far ahead of `start_at` we remind. Change to
  6 for a "same day" reminder, 168 for a week-out.
- `--slack-hours 1` — half-width of the target window. Job cadence must
  be ≤ 2 × slack (otherwise you miss some rows between runs).
- Add another job (e.g. `slotly-booking-reminders-1h`) if you want both
  a 24h and 1h reminder. `reminded_at` covers only "one has been sent"
  right now; if you want two-stage reminders, replace it with a
  `reminded_kinds` JSONField later.
