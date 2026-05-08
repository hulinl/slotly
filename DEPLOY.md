# Slotly — production deploy runbook

Production lives on Azure in resource group `slotly-prod` / region `westeurope`,
under subscription **Předplatné Azure 1** (tenant `bifactory.cz`).

| Component | Resource | URL |
|---|---|---|
| Frontend | `Microsoft.Web/staticSites slotly-frontend` | https://slotly.team, https://www.slotly.team |
| Backend | `Microsoft.App/containerApps slotly-backend` | https://api.slotly.team |
| Database | `Microsoft.DBforPostgreSQL/flexibleServers slotly-pg-*` | private |
| Image registry | `Microsoft.ContainerRegistry/registries slotlyacr*` | `slotlyacr*.azurecr.io/slotly-backend` |
| Email (transactional) | `Microsoft.Communication/CommunicationServices slotly-comm` + EmailService `slotly-email` | sender `noreply@slotly.team` |
| Profile photos | `Microsoft.Storage/storageAccounts slotlymedia*` | container `media`, public-read blobs |
| DNS | `Microsoft.Network/dnsZones slotly.team` | NS at webglobe point at `ns*-08.azure-dns.*` |

All defined in `infra/main.bicep` and orchestrated by `infra/deploy.sh`.

---

## Prerequisites

- `az` CLI logged in (`az login`) on the subscription above
- `gh` CLI logged in (for SWA workflow inspection)
- Docker daemon running locally (for `buildx --platform linux/amd64`)

Repo: https://github.com/hulinl/slotly. The Static Web App is wired to push-on-`main`,
so a git push is enough to redeploy the frontend. The backend image is pushed and
released manually via `deploy.sh`.

---

## Day-to-day commands

```bash
# Redeploy backend code (build, push, swap image, force a new revision)
./infra/deploy.sh build
DIGEST=$(az acr repository show-manifests --name slotlyacrqhdspf \
  --repository slotly-backend --orderby time_desc --top 1 --query "[0].digest" -o tsv)
az containerapp update -g slotly-prod -n slotly-backend \
  --image "slotlyacrqhdspf.azurecr.io/slotly-backend@$DIGEST" \
  --query "properties.latestRevisionName" -o tsv

# Tail backend logs
./infra/deploy.sh logs

# Smoke
./infra/deploy.sh smoke      # GET /healthz
curl -I https://slotly.team/  # frontend
```

Frontend deploys automatically on push to `main`. Inspect in-flight builds with:

```bash
gh run list -R hulinl/slotly --limit 3
gh run view -R hulinl/slotly <run-id> --log-failed
```

---

## Re-provision (rare — only when Bicep changes)

```bash
./infra/deploy.sh provision
```

`provision` is idempotent. It:

- Registers required Azure providers (no-op if already registered)
- Creates / updates the resource group
- Generates `infra/.secrets/postgres_admin_password`, `django_secret_key`,
  `calendar_url_encryption_key` once and reuses them on subsequent runs
- Reads the currently-deployed Container App image and passes it back as
  `backendInitialImage`, so a re-provision doesn't roll the app back to
  the hello-world placeholder
- Re-binds the `api.slotly.team` custom hostname after the Bicep deploy
  (Bicep doesn't currently declare it; the provision script papers over
  that gotcha).

After provision finishes, sanity-check:

```bash
curl https://api.slotly.team/healthz   # → 200 {"status":"ok",...}
curl -I https://slotly.team/           # → 200
az containerapp hostname list -g slotly-prod -n slotly-backend -o table
```

---

## Migrations

Run automatically on every container start via `backend/entrypoint.sh`:

```bash
python manage.py migrate --noinput
python manage.py createcachetable django_cache
# Update Site row name/domain
# (Optional) Force-verify accounts listed in BOOTSTRAP_VERIFY_EMAILS
```

There's no separate `migrate` step needed in CI / deploy. After pushing a
backend image with new migrations, `release` will roll a new revision and the
entrypoint applies them.

---

## Bootstrap recovery — verify a stuck signup

When a user signs up while email-config is misbehaving and ends up with an
unverified `EmailAddress`, override at the next deploy:

```bash
az containerapp update -g slotly-prod -n slotly-backend \
  --set-env-vars BOOTSTRAP_VERIFY_EMAILS="alice@example.com,bob@example.com"
# wait for the new revision; check logs to confirm "verified, user_id=…"
# then unset so it doesn't keep running:
az containerapp update -g slotly-prod -n slotly-backend \
  --remove-env-vars BOOTSTRAP_VERIFY_EMAILS
```

Don't leave `BOOTSTRAP_VERIFY_EMAILS` set in steady state — every container
restart re-saves the EmailAddress, which can invalidate any outstanding
allauth password-reset tokens.

---

## Email — sender domain

`noreply@slotly.team` is verified at the ACS Email Domain resource. SPF, DKIM,
DKIM2 records live in our Azure DNS zone for `slotly.team`. After any DNS-zone
re-provision, sanity-check verification states with:

```bash
az rest --method get --url "https://management.azure.com/subscriptions/$(az account show --query id -o tsv)/resourceGroups/slotly-prod/providers/Microsoft.Communication/emailServices/slotly-email/domains/slotly.team?api-version=2023-04-01" \
  --query 'properties.verificationStates'
```

All four (Domain, SPF, DKIM, DKIM2) should be `Verified`.

---

## Rollback

Container Apps keeps the previous revisions around. To shift traffic back to a
known-good revision:

```bash
az containerapp revision list -g slotly-prod -n slotly-backend \
  --query "[].{name:name,active:properties.active,traffic:properties.trafficWeight,createdTime:properties.createdTime}" -o table

# example: pin 100% to a specific older revision
az containerapp ingress traffic set -g slotly-prod -n slotly-backend \
  --revision-weight slotly-backend--0000018=100
```

Frontend rollback: `gh workflow run` previous SWA workflow on a known-good
commit, or revert the bad commit on `main` and let the workflow rebuild.

---

## DNS

Owned by `Microsoft.Network/dnsZones slotly.team`. NS records at the
webglobe registrar point at the four `ns*-08.azure-dns.*` servers Azure
assigned (only two of them are stored at the registrar — webglobe limits to 2;
DNS resolvers discover the rest automatically).

Editing records is done in Bicep (`infra/main.bicep`). Direct `az network dns`
edits work but get clobbered on next provision — prefer Bicep when the change
is permanent.

---

## Costs (steady state)

| | Approx €/month |
|---|---|
| Postgres B1ms + storage | ~12 |
| Container Registry Basic | ~4 |
| Container Apps Consumption (1 idle replica) | ~2 |
| Static Web App | 0 (Free tier) |
| Communication Services Email (low volume) | ~0 |
| Storage Account (Standard_LRS, profile photos) | ~0.5 |
| Azure DNS zone | ~0.5 |
| **Total at idle** | **~19** |

Heaviest cost growth comes from Postgres (scale up B-series tier when
busy) and Container Apps replicas (scale-out billed by vCPU-second).

---

## Known gotchas

1. `containerapp update --image <tag>` is a no-op if the image tag string
   hasn't changed. Use `--image <repo>@sha256:<digest>` to force a new
   revision when re-pushing the same tag.
2. `az containerapp exec` requires a TTY and fails in non-interactive
   shells; everything runtime-y belongs in `entrypoint.sh`.
3. ACS rejects `"Display Name <addr>"` formatted senders. Keep
   `DEFAULT_FROM_EMAIL=noreply@slotly.team` (bare); display name lives on
   the SenderUsername resource.
4. Allauth's password-reset / email-verify endpoints return HTTP 401 with
   `{flows:[{id:"login"}]}` on success when the user isn't auto-logged-in.
   The frontend treats anything without an `errors` array as success.
5. Google's *public* ICS feed strips events marked `Free` — they never
   reach Slotly. To debug "all-day event isn't blocking", check the feed
   first; if the event isn't there, the user needs the secret/private
   ICS URL of that specific calendar.
