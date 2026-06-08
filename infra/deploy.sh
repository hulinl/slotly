#!/usr/bin/env bash
# Slotly Phase-1 deploy orchestrator.
#
# Run from repo root:
#   ./infra/deploy.sh provision   # one-time: register providers, create RG + resources
#   ./infra/deploy.sh build       # build & push backend image
#   ./infra/deploy.sh release     # roll the Container App to the new image
#   ./infra/deploy.sh migrate     # run Django migrate + createcachetable
#   ./infra/deploy.sh logs        # tail backend logs
#   ./infra/deploy.sh smoke       # curl /healthz
#
# Requires: az CLI logged in, docker running, gh CLI logged in.

set -euo pipefail

RG="${SLOTLY_RG:-slotly-prod}"
LOCATION="${SLOTLY_LOCATION:-westeurope}"
GITHUB_REPO="${SLOTLY_GITHUB_REPO:-https://github.com/hulinl/slotly}"
GITHUB_BRANCH="${SLOTLY_GITHUB_BRANCH:-main}"
SUBSCRIPTION="${SLOTLY_SUBSCRIPTION:-$(az account show --query id -o tsv)}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INFRA="$ROOT/infra"
SECRETS="$INFRA/.secrets"
mkdir -p "$SECRETS"

# ---------------------------------------------------------------------------

generate_secret() {
  python3 -c "import secrets;print(secrets.token_urlsafe(48))"
}

generate_calendar_key() {
  python3 -c "import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip('='))"
}

ensure_secret() {
  local name=$1 generator=$2
  local f="$SECRETS/$name"
  if [[ ! -f "$f" ]]; then
    "$generator" > "$f"
    chmod 600 "$f"
    # status messages go to stderr — stdout is captured by command substitution
    echo "  generated $name → $f" >&2
  fi
  cat "$f"
}

provision() {
  echo "==> Registering Azure providers (idempotent)..."
  for p in Microsoft.App Microsoft.DBforPostgreSQL Microsoft.ContainerRegistry \
           Microsoft.Web Microsoft.Communication Microsoft.OperationalInsights \
           Microsoft.Insights; do
    az provider register -n "$p" --wait >/dev/null
    echo "  $p registered"
  done

  echo "==> Creating resource group $RG in $LOCATION..."
  az group create -n "$RG" -l "$LOCATION" -o table

  local pg_password
  pg_password=$(ensure_secret postgres_admin_password generate_secret)
  local django_secret
  django_secret=$(ensure_secret django_secret_key generate_secret)
  local cal_key
  cal_key=$(ensure_secret calendar_url_encryption_key generate_calendar_key)

  # Optional: GitHub PAT for Static Web Apps wiring. Empty → SWA skipped.
  local github_token=""
  if [[ -f "$SECRETS/github_token" ]]; then
    github_token=$(cat "$SECRETS/github_token")
  fi

  # Preserve the currently-deployed image so re-provisioning doesn't revert
  # the Container App back to the hello-world placeholder.
  local current_image
  current_image=$(az containerapp show -g "$RG" -n slotly-backend \
    --query "properties.template.containers[0].image" -o tsv 2>/dev/null || echo "")
  local image_param=""
  if [[ -n "$current_image" ]]; then
    image_param="backendInitialImage=$current_image"
    echo "  preserving current image: $current_image"
  fi

  echo "==> Deploying Bicep template..."
  az deployment group create \
    --resource-group "$RG" \
    --template-file "$INFRA/main.bicep" \
    --parameters \
      postgresPassword="$pg_password" \
      djangoSecretKey="$django_secret" \
      calendarUrlEncryptionKey="$cal_key" \
      githubRepo="$GITHUB_REPO" \
      githubBranch="$GITHUB_BRANCH" \
      githubToken="$github_token" \
      $image_param \
    --query 'properties.outputs' -o json > "$SECRETS/last_outputs.json"
  echo "  outputs:"
  python3 -m json.tool < "$SECRETS/last_outputs.json"

  # Bicep doesn't currently declare the Container App custom-hostname
  # binding, so every redeploy wipes api.slotly.team. Idempotently
  # re-add + re-bind here so callers don't have to remember.
  for host in api.slotly.team; do
    if ! az containerapp hostname list -g "$RG" -n slotly-backend \
        --query "[?name=='$host'] | length(@)" -o tsv 2>/dev/null | grep -q '^1$'; then
      echo "==> Re-binding $host on slotly-backend..."
      az containerapp hostname add -g "$RG" -n slotly-backend --hostname "$host" >/dev/null 2>&1 || true
      az containerapp hostname bind -g "$RG" -n slotly-backend --hostname "$host" \
        --environment slotly-env --validation-method CNAME >/dev/null 2>&1 || true
    fi
  done

  echo
  echo "✓ Provisioning complete. Outputs saved to $SECRETS/last_outputs.json"
}

_outputs() {
  cat "$SECRETS/last_outputs.json"
}

build() {
  local acr_login_server
  acr_login_server=$(_outputs | jq -r '.acrLoginServer.value')
  local acr_name
  acr_name=$(_outputs | jq -r '.acrName.value')
  local tag="${SLOTLY_TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo latest)}"

  echo "==> Logging into ACR ($acr_name)..."
  az acr login --name "$acr_name"

  echo "==> Building backend image (linux/amd64) → $acr_login_server/slotly-backend:$tag"
  docker buildx build \
    --platform linux/amd64 \
    -f "$ROOT/backend/Dockerfile.prod" \
    -t "$acr_login_server/slotly-backend:$tag" \
    -t "$acr_login_server/slotly-backend:latest" \
    --push \
    "$ROOT/backend"

  echo "$tag" > "$SECRETS/last_tag"
  echo "✓ Image pushed: $acr_login_server/slotly-backend:$tag"
}

release() {
  local backend_name
  backend_name=$(_outputs | jq -r '.backendName.value')
  local acr_login_server
  acr_login_server=$(_outputs | jq -r '.acrLoginServer.value')
  local tag
  tag=$(cat "$SECRETS/last_tag")
  local image="$acr_login_server/slotly-backend:$tag"

  echo "==> Updating Container App $backend_name → $image"
  az containerapp update \
    --resource-group "$RG" \
    --name "$backend_name" \
    --image "$image" \
    --query 'properties.latestRevisionName' -o tsv

  # Keep the periodic poll-calendars Job on the same image so the cron uses
  # the latest code. Skip silently if the Job hasn't been provisioned yet
  # (first-time release before `provision` ran with the new Bicep).
  local job_name
  job_name=$(_outputs | jq -r '.pollCalendarsJobName.value // empty')
  if [[ -n "$job_name" ]] && az containerapp job show -g "$RG" -n "$job_name" >/dev/null 2>&1; then
    echo "==> Updating Container Apps Job $job_name → $image"
    az containerapp job update \
      --resource-group "$RG" \
      --name "$job_name" \
      --image "$image" \
      --query 'properties.template.containers[0].image' -o tsv
  fi
}

migrate() {
  local backend_name
  backend_name=$(_outputs | jq -r '.backendName.value')
  echo "==> Running migrate + createcachetable..."
  az containerapp exec \
    --resource-group "$RG" \
    --name "$backend_name" \
    --command "python manage.py migrate --noinput && python manage.py createcachetable django_cache || true"
}

logs() {
  local backend_name
  backend_name=$(_outputs | jq -r '.backendName.value')
  az containerapp logs show \
    --resource-group "$RG" \
    --name "$backend_name" \
    --follow
}

smoke() {
  local backend_fqdn
  backend_fqdn=$(_outputs | jq -r '.backendFqdn.value')
  echo "==> GET https://$backend_fqdn/healthz"
  curl -sS "https://$backend_fqdn/healthz"
  echo
}

usage() {
  cat <<USAGE
Slotly deploy orchestrator. Subcommands:

  provision   one-time: register providers, create RG, deploy Bicep
  build       docker buildx + push to ACR
  release     update Container App revision to the latest pushed image
  migrate     run manage.py migrate + createcachetable in the live container
  logs        tail backend logs
  smoke       hit /healthz on the live URL

Environment overrides:
  SLOTLY_RG, SLOTLY_LOCATION, SLOTLY_GITHUB_REPO, SLOTLY_GITHUB_BRANCH,
  SLOTLY_SUBSCRIPTION, SLOTLY_TAG.

USAGE
}

cmd="${1:-}"
case "$cmd" in
  provision) provision ;;
  build) build ;;
  release) release ;;
  migrate) migrate ;;
  logs) logs ;;
  smoke) smoke ;;
  *) usage; exit 1 ;;
esac
