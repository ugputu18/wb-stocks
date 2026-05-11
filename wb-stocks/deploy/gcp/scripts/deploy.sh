#!/usr/bin/env bash
# Update wb-stocks on a running VM: fetch latest code, rebuild UI bundle,
# restart the service. Timer-driven jobs pick up the new code on their next tick.
#
# Usage:
#   deploy.sh <vm-name> [zone] [git-ref]
#
# Assumes:
#   - You are authenticated with `gcloud` and have IAP TCP forwarding access.
#   - The VM was provisioned with deploy/gcp/cloud-init.yaml (paths below match it).

set -euo pipefail

VM_NAME="${1:?vm name required}"
ZONE="${2:-${ZONE:-}}"
GIT_REF="${3:-}"

if [[ -z "${ZONE}" ]]; then
  echo "Set zone via 2nd arg or ZONE env var" >&2
  exit 1
fi

REMOTE_CMD=$(cat <<'EOS'
set -euo pipefail
APP_DIR=/srv/wb-stocks/app
WB_DIR=/srv/wb-stocks/current
GIT_REF_ARG="${GIT_REF:-}"

cd "$APP_DIR"
sudo -u wbstocks git fetch --all --tags --prune
if [[ -n "$GIT_REF_ARG" ]]; then
  sudo -u wbstocks git checkout "$GIT_REF_ARG"
fi
CURRENT_REF="$(sudo -u wbstocks git rev-parse --abbrev-ref HEAD)"
sudo -u wbstocks git pull --ff-only origin "$CURRENT_REF"

cd "$WB_DIR"
sudo -u wbstocks --preserve-env=PATH bash -c 'pnpm install --frozen-lockfile'
sudo -u wbstocks --preserve-env=PATH bash -c 'pnpm build:forecast-ui-client'

# Re-install systemd units in case they changed in this deploy.
sudo install -m 0644 deploy/gcp/systemd/*.service /etc/systemd/system/
sudo install -m 0644 deploy/gcp/systemd/*.timer   /etc/systemd/system/
sudo install -m 0644 deploy/gcp/nginx/forecast-ui.conf /etc/nginx/sites-available/forecast-ui.conf
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl daemon-reload
sudo systemctl restart forecast-ui.service
sudo systemctl is-active forecast-ui.service
EOS
)

exec gcloud compute ssh "$VM_NAME" --zone="$ZONE" --tunnel-through-iap \
  --command="GIT_REF='${GIT_REF}' bash -s" <<<"$REMOTE_CMD"
