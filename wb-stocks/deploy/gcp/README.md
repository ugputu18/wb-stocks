# Deploy wb-stocks to Google Cloud Platform

Single-VM deployment of the forecast UI server with WB import jobs as
`systemd` timers. Access is gated by Google Cloud IAP (Identity-Aware Proxy)
in front of an HTTPS Load Balancer.

This README is a runbook. Pick a project ID, a region, and a domain name,
substitute them into the commands below, and execute top-to-bottom. All
configuration files referenced live under this directory.

For background (why this shape, what we deferred), see
[`docs/ai-tasks/gcp-deployment.md`](../../docs/ai-tasks/gcp-deployment.md).

## Variables used below

```bash
export PROJECT_ID="wb-stocks-prod"           # your GCP project
export REGION="europe-west4"
export ZONE="europe-west4-a"
export VM_NAME="wb-stocks-1"
export DATA_DISK="wb-stocks-data"
export STATIC_IP="wb-stocks-ip"
export DOMAIN="wb-stocks.example.com"        # the domain users will visit
export SA_NAME="wb-stocks-vm"
export REPO_URL="git@github.com:ugputu18/wb-stocks.git"   # or HTTPS clone URL
export GIT_REF="main"
```

## 1. Project bootstrap

```bash
gcloud config set project "$PROJECT_ID"
gcloud config set compute/region "$REGION"
gcloud config set compute/zone "$ZONE"

gcloud services enable \
  compute.googleapis.com \
  iap.googleapis.com \
  secretmanager.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  dns.googleapis.com
```

## 2. Service account for the VM

```bash
gcloud iam service-accounts create "$SA_NAME" \
  --display-name="wb-stocks VM runtime"

SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

for role in roles/secretmanager.secretAccessor \
            roles/logging.logWriter \
            roles/monitoring.metricWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" --role="$role"
done
```

## 3. Secrets in Secret Manager

```bash
# WB seller token — required by import:stocks / update:wb-supplies.
printf 'PUT-YOUR-WB-TOKEN-HERE' | gcloud secrets create WB_TOKEN \
  --data-file=- --replication-policy=automatic

# Bearer token for the forecast UI server (defence in depth behind IAP).
openssl rand -hex 32 | gcloud secrets create FORECAST_UI_TOKEN \
  --data-file=- --replication-policy=automatic
```

To rotate later: `gcloud secrets versions add WB_TOKEN --data-file=-`.

## 4. Data disk

```bash
gcloud compute disks create "$DATA_DISK" \
  --size=20GB --type=pd-balanced --zone="$ZONE"
```

A backup schedule for this disk is added in step 11.

## 5. Static IP for the load balancer

```bash
gcloud compute addresses create "$STATIC_IP" --global
gcloud compute addresses describe "$STATIC_IP" --global --format='value(address)'
```

Create a DNS A record `${DOMAIN}` → that address. For a quick test without
DNS, you can use `<ip>.nip.io` as `$DOMAIN`.

## 6. Create the VM with cloud-init

The startup script in [`cloud-init.yaml`](./cloud-init.yaml) installs Node,
nginx, the Ops Agent, mounts the data disk, clones the repo, builds the UI,
fetches secrets, and starts the systemd units. Repo URL and git ref are
passed via instance metadata.

```bash
gcloud compute instances create "$VM_NAME" \
  --zone="$ZONE" \
  --machine-type=e2-small \
  --image-family=debian-12 --image-project=debian-cloud \
  --service-account="$SA_EMAIL" \
  --scopes=cloud-platform \
  --disk="name=${DATA_DISK},device-name=wb-stocks-data,mode=rw,boot=no" \
  --tags=iap-backend \
  --metadata=enable-oslogin=TRUE,wb-stocks-repo-url="${REPO_URL}",wb-stocks-git-ref="${GIT_REF}" \
  --metadata-from-file=user-data=deploy/gcp/cloud-init.yaml
```

Note: if `$REPO_URL` is an SSH URL, the VM cannot use your local SSH key.
Use the HTTPS clone URL for a public repo, or add a deploy key on the VM
after first boot. The default `cloud-init.yaml` assumes HTTPS clone.

First-time provisioning takes ~3–5 minutes. Tail it with:

```bash
gcloud compute ssh "$VM_NAME" --tunnel-through-iap \
  --command='sudo journalctl -u google-startup-scripts.service -f'
```

## 7. Firewall

SSH stays IAP-only (no public port 22). HTTP from the load balancer health
checks and GFEs only:

```bash
# Allow IAP to reach SSH on tagged VMs.
gcloud compute firewall-rules create wb-stocks-allow-iap-ssh \
  --direction=INGRESS --action=ALLOW --rules=tcp:22 \
  --source-ranges=35.235.240.0/20 \
  --target-tags=iap-backend

# Allow GLB health checks + GFEs to reach nginx on tcp:80.
gcloud compute firewall-rules create wb-stocks-allow-glb-http \
  --direction=INGRESS --action=ALLOW --rules=tcp:80 \
  --source-ranges=35.191.0.0/16,130.211.0.0/22 \
  --target-tags=iap-backend
```

## 8. Load balancer (HTTPS, IAP-protected)

```bash
# Unmanaged instance group containing the single VM.
gcloud compute instance-groups unmanaged create wb-stocks-ig --zone="$ZONE"
gcloud compute instance-groups unmanaged add-instances wb-stocks-ig \
  --zone="$ZONE" --instances="$VM_NAME"
gcloud compute instance-groups unmanaged set-named-ports wb-stocks-ig \
  --zone="$ZONE" --named-ports=http:80

# Health check uses the server's own readiness endpoint.
gcloud compute health-checks create http wb-stocks-hc \
  --port=80 --request-path=/api/forecast/health \
  --check-interval=15s --timeout=5s \
  --unhealthy-threshold=3 --healthy-threshold=2

# Backend service.
gcloud compute backend-services create wb-stocks-backend \
  --global --protocol=HTTP --port-name=http \
  --health-checks=wb-stocks-hc --timeout=60s

gcloud compute backend-services add-backend wb-stocks-backend \
  --global --instance-group=wb-stocks-ig --instance-group-zone="$ZONE"

# URL map → target HTTPS proxy → forwarding rule.
gcloud compute url-maps create wb-stocks-urlmap \
  --default-service=wb-stocks-backend

gcloud compute ssl-certificates create wb-stocks-cert \
  --domains="$DOMAIN" --global

gcloud compute target-https-proxies create wb-stocks-https \
  --url-map=wb-stocks-urlmap --ssl-certificates=wb-stocks-cert

gcloud compute forwarding-rules create wb-stocks-fr \
  --global --address="$STATIC_IP" --target-https-proxy=wb-stocks-https \
  --ports=443
```

The managed certificate takes a few minutes (sometimes up to an hour)
to provision after the DNS A record is in place. Check with:

```bash
gcloud compute ssl-certificates describe wb-stocks-cert --global \
  --format='value(managed.status,managed.domainStatus)'
```

## 9. Enable IAP and grant access

The OAuth consent screen must exist for your project — configure it once
in the GCP Console (`APIs & Services → OAuth consent screen`, internal).

```bash
gcloud iap web enable --resource-type=backend-services \
  --service=wb-stocks-backend

# Grant access to individual users or a Google group.
gcloud iap web add-iam-policy-binding \
  --resource-type=backend-services --service=wb-stocks-backend \
  --member=user:alice@example.com --role=roles/iap.httpsResourceAccessor
```

## 10. Verify

```bash
# 1. SSH (via IAP) and check services.
gcloud compute ssh "$VM_NAME" --tunnel-through-iap --command='
  systemctl is-active forecast-ui.service nginx
  systemctl list-timers --no-pager | grep wb-
  curl -fsS http://127.0.0.1:3847/api/forecast/health
'

# 2. From your laptop: open https://$DOMAIN in a browser, log in with Google,
# IAP lets you through, the forecast UI loads.
```

## 11. Backups

Daily snapshot of the data disk, keep 14 days:

```bash
gcloud compute resource-policies create snapshot-schedule wb-stocks-daily \
  --region="$REGION" \
  --max-retention-days=14 \
  --start-time=02:00 --daily-schedule \
  --on-source-disk-delete=apply-retention-policy

gcloud compute disks add-resource-policies "$DATA_DISK" \
  --zone="$ZONE" --resource-policies=wb-stocks-daily
```

## 12. Updating the deployed code

After pushing changes to `main`:

```bash
./deploy/gcp/scripts/deploy.sh "$VM_NAME" "$ZONE"
```

The script SSH-s in over IAP, runs `git fetch && git checkout`,
`pnpm install --frozen-lockfile`, rebuilds the UI bundle, and restarts the
service. Timer-managed jobs pick up the new code on their next tick.

## Rolling back

Restore the data disk from a snapshot:

```bash
gcloud compute instances stop "$VM_NAME" --zone="$ZONE"
gcloud compute instances detach-disk "$VM_NAME" --zone="$ZONE" --disk="$DATA_DISK"
gcloud compute disks delete "$DATA_DISK" --zone="$ZONE"
gcloud compute disks create "$DATA_DISK" \
  --source-snapshot=<snapshot-name> --zone="$ZONE"
gcloud compute instances attach-disk "$VM_NAME" --zone="$ZONE" \
  --disk="$DATA_DISK" --device-name=wb-stocks-data
gcloud compute instances start "$VM_NAME" --zone="$ZONE"
```

Code rollback is `git checkout <previous-ref>` on the VM (or rerun
`deploy.sh` with a different `GIT_REF`).
