#!/usr/bin/env bash
# The deployment, as it runs ON the EC2 instance.
#
# Invoked by `.github/workflows/release.yml` over SSM, and safe to run by hand
# from an SSM session. It lives in the repository rather than inside a workflow
# string so that what executes on the box is reviewable in git.
#
#   BACKEND_IMAGE   full ECR ref, tagged with the 40-char commit SHA
#   FRONTEND_IMAGE  same
#   DEPLOY_SHA      the commit these images were built from (defaults to the tag)
#   SKIP_MIGRATIONS set to 1 for a rollback (see ROLLBACK below)
#
# ── ORDER, AND WHY IT IS THIS ORDER ───────────────────────────────────────
#
#   0. preconditions — .env present and private; nothing started yet
#   1. ECR login    — the instance's own IAM role, no credential is handed to it
#   2. pull         — fail before touching anything running
#   3. migrate      — schema first, while the OLD code still serves
#   4. up           — new containers, one service at a time
#   5. verify       — from inside the box; the workflow re-checks from outside
#   6. record       — what is running, and what to roll back TO
#
# Migrations run BEFORE the new containers start because the new code requires
# the new schema: 0004 adds `BookingRequest.kind` and every `kind` query 500s
# without it. The reverse order — new code first — means every request between
# `up` and `migrate` fails.
#
# This is only safe because the migrations are ADDITIVE and the old code
# ignores what it does not know about. A migration that DROPS or RENAMES
# something the running code still uses breaks the old code the moment it
# applies, and needs an expand/contract release instead: ship the additive
# half, deploy, then remove in a later release. Do not skip that for
# convenience.
#
# ── IDEMPOTENT ────────────────────────────────────────────────────────────
# Running this twice with the same images is a no-op beyond a re-pull and a
# re-`up` that Compose resolves to "already current". Migrations are idempotent
# by construction (Django's ledger), the ECR login is a fresh token each time,
# and the record files are overwritten with the same content.

set -euo pipefail

APP_DIR=${APP_DIR:-/opt/curatix}
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.ec2.yml)
cd "$APP_DIR"

: "${BACKEND_IMAGE:?BACKEND_IMAGE must be the full ECR ref, SHA-tagged}"
: "${FRONTEND_IMAGE:?FRONTEND_IMAGE must be the full ECR ref, SHA-tagged}"

log() { printf '[DEPLOY] %s\n' "$*"; }
die() {
  local code="${2:-1}"
  printf '[DEPLOY][FAILURE] %s (exit code %s)\n' "$1" "$code" >&2
  echo "--- DIAGNOSTICS ON FAILURE ---" >&2
  echo "=== Docker Compose Container Status ===" >&2
  "${COMPOSE[@]}" ps >&2 || true
  echo "=== Running Container Details ===" >&2
  docker ps --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}" >&2 || true
  echo "=== Network Port Listeners ===" >&2
  (ss -tulpn || netstat -tulpn || lsof -i) >&2 || true
  echo "=== Directory Listing ($APP_DIR) ===" >&2
  ls -la "$APP_DIR" >&2 || true
  echo "=== Recent Web Logs ===" >&2
  "${COMPOSE[@]}" logs --tail 50 web >&2 || true
  echo "=== Recent Frontend Logs ===" >&2
  "${COMPOSE[@]}" logs --tail 50 frontend >&2 || true
  echo "=== Recent Caddy Logs ===" >&2
  "${COMPOSE[@]}" logs --tail 50 caddy >&2 || true
  exit "$code"
}

# ── 1. Prepare Host ───────────────────────────────────────────────────────
log "[1] Prepare host: checking tags and parameters"
for ref in "$BACKEND_IMAGE" "$FRONTEND_IMAGE"; do
  tag="${ref##*:}"
  if [ "$tag" = "latest" ] || [ ${#tag} -ne 40 ]; then
    die "'$ref' is not tagged with a 40-char commit SHA. Immutable tags are required." 2
  fi
done

if [ "${BACKEND_IMAGE##*:}" != "${FRONTEND_IMAGE##*:}" ]; then
  die "backend (${BACKEND_IMAGE##*:}) and frontend (${FRONTEND_IMAGE##*:}) are different commits" 2
fi

DEPLOY_SHA=${DEPLOY_SHA:-${BACKEND_IMAGE##*:}}
REGISTRY="${BACKEND_IMAGE%%/*}"
AWS_REGION=${AWS_REGION:-ap-south-1}

log "Deploying SHA: $DEPLOY_SHA"
log "Backend Image:  $BACKEND_IMAGE"
log "Frontend Image: $FRONTEND_IMAGE"

export BACKEND_IMAGE FRONTEND_IMAGE

# ── 2. Render Environment ─────────────────────────────────────────────────
log "[2] Render environment: checking .env file readiness"
if [ ! -f .env ]; then
  log "  .env file missing. Attempting auto-rendering via deploy/render-env.sh..."
  bash deploy/render-env.sh || die "Automatic env rendering failed." 3
fi

[ -f .env ] || die "$APP_DIR/.env is missing." 3
[ "$(stat -c '%a' .env)" = "600" ] || die "$APP_DIR/.env must be mode 600 (found $(stat -c '%a' .env))" 3

command -v aws >/dev/null || die "aws CLI is not installed on this instance" 3
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 plugin is not installed (\`docker compose\`, not \`docker-compose\`)" 3

# ── 3. Authenticate to ECR ────────────────────────────────────────────────
log "[3] Authenticate to ECR ($REGISTRY)"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null \
  || die "ECR login failed. Check that CuratixEC2Role has ecr:GetAuthorizationToken." 3

# ── 4. Pull backend image ─────────────────────────────────────────────────
log "[4] Pull backend image: $BACKEND_IMAGE"
docker pull -q "$BACKEND_IMAGE" || die "could not pull $BACKEND_IMAGE" 4

# ── 5. Pull frontend image ────────────────────────────────────────────────
log "[5] Pull frontend image: $FRONTEND_IMAGE"
docker pull -q "$FRONTEND_IMAGE" || die "could not pull $FRONTEND_IMAGE" 4

# ── 6. Run migrations ─────────────────────────────────────────────────────
log "[6] Run migrations"
if [ "${SKIP_MIGRATIONS:-0}" = "1" ]; then
  log "  Skipping migrations (SKIP_MIGRATIONS=1)"
else
  "${COMPOSE[@]}" --profile migrate run --rm migrate \
      python manage.py migrate_safe --yes \
    || die "migrations failed — nothing was restarted, the old version is still serving" 5
fi

# ── 7. Start containers ───────────────────────────────────────────────────
log "[7] Start containers"
"${COMPOSE[@]}" up -d --no-deps web worker scheduler || die "could not start backend services" 6
"${COMPOSE[@]}" up -d --no-deps frontend             || die "could not start frontend" 6
"${COMPOSE[@]}" up -d --no-deps caddy                || die "could not start caddy" 6
"${COMPOSE[@]}" up -d --remove-orphans >/dev/null 2>&1 || true

# ── 8. Health checks ──────────────────────────────────────────────────────
#
# ── THE HOST HEADER IS NOT OPTIONAL ─────────────────────────────────────
#
# This probes the container on 127.0.0.1, but Django validates the Host header
# against ALLOWED_HOSTS and answers 400 to anything not listed. A production
# ALLOWED_HOSTS of `fastride.xyz` alone — the obvious way to write it — makes
# every probe below fail, and the deploy then dies after 300 seconds with
# "never became healthy" about an application that is running perfectly.
#
# So the probe presents the site's own domain, read from the .env that was
# just rendered. `grep` rather than sourcing the file: it holds the database
# password, the Razorpay secret and the signing keys, and none of that belongs
# in this shell's environment just to learn a hostname.
SITE_DOMAIN_VALUE=$(grep -m1 '^SITE_DOMAIN=' .env 2>/dev/null | cut -d= -f2- | tr -d "\"'" || true)
if [ -n "$SITE_DOMAIN_VALUE" ]; then
  HEALTH_HOST_ARGS=(-H "Host: $SITE_DOMAIN_VALUE")
  log "  Probing as Host: $SITE_DOMAIN_VALUE"
else
  HEALTH_HOST_ARGS=()
  log "  SITE_DOMAIN not readable from .env — probing without a Host header"
fi

log "[8] Health checks"
healthy=0
for i in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T web curl -fsS "${HEALTH_HOST_ARGS[@]}" http://127.0.0.1:8000/health/ >/dev/null 2>&1; then
    log "  Backend health check passed after $((i * 10))s"
    healthy=1
    break
  fi
  sleep 10
done
if [ "$healthy" != "1" ]; then
  die "http://127.0.0.1:8000/health/ never became healthy after 300s" 7
fi

for svc in web worker scheduler frontend caddy; do
  state=$("${COMPOSE[@]}" ps --format '{{.State}}' "$svc" 2>/dev/null | head -1)
  log "  Service $svc status: ${state:-MISSING}"
  if [ "$state" != "running" ]; then
    die "Service $svc is '${state:-MISSING}', not running" 8
  fi
done

sleep 15
for svc in web worker scheduler frontend; do
  cid=$("${COMPOSE[@]}" ps -q "$svc" 2>/dev/null || true)
  [ -n "$cid" ] || continue
  n=$(docker inspect --format '{{.RestartCount}}' "$cid" 2>/dev/null || echo 0)
  if [ "${n:-0}" -gt 3 ]; then
    die "crash loop: $svc has restarted $n times in 15s" 9
  fi
done

# ── 9. Record deployment ──────────────────────────────────────────────────
log "[9] Record deployment"
if [ -f .deployed ]; then
  cp -p .deployed .deployed.prev
fi
umask 077
cat > .deployed <<RECORD
DEPLOYED_SHA=$DEPLOY_SHA
BACKEND_IMAGE=$BACKEND_IMAGE
FRONTEND_IMAGE=$FRONTEND_IMAGE
DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
RECORD

echo "$DEPLOY_SHA" > .deployed-sha
log "[SUCCESS] Deployment completed successfully for $DEPLOY_SHA"

docker image prune -f --filter "until=168h" >/dev/null 2>&1 || true
