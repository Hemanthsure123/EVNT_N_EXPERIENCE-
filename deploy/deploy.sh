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

log() { printf '==> %s\n' "$*"; }
die() { printf 'DEPLOY FAILED: %s\n' "$*" >&2; exit "${2:-1}"; }

# ── The tag must be immutable ────────────────────────────────────────────
# `latest` is a moving pointer: two deploys of "latest" can ship different
# code, and a rollback to it is meaningless. Refusing here rather than only in
# the workflow means a hand-run deploy cannot bypass the rule either.
for ref in "$BACKEND_IMAGE" "$FRONTEND_IMAGE"; do
  tag="${ref##*:}"
  if [ "$tag" = "latest" ] || [ ${#tag} -ne 40 ]; then
    die "'$ref' is not tagged with a 40-char commit SHA. Immutable tags are what make a rollback possible." 2
  fi
done

# Both images must come from the SAME commit. A backend from one SHA and a
# frontend from another is a combination nothing ever tested, and the symptom
# is a UI calling an API contract that no longer exists.
if [ "${BACKEND_IMAGE##*:}" != "${FRONTEND_IMAGE##*:}" ]; then
  die "backend (${BACKEND_IMAGE##*:}) and frontend (${FRONTEND_IMAGE##*:}) are different commits" 2
fi

DEPLOY_SHA=${DEPLOY_SHA:-${BACKEND_IMAGE##*:}}
REGISTRY="${BACKEND_IMAGE%%/*}"
AWS_REGION=${AWS_REGION:-ap-south-1}

log "deploying $DEPLOY_SHA"
log "  backend:  $BACKEND_IMAGE"
log "  frontend: $FRONTEND_IMAGE"

# The compose files reference these; exported so `up` resolves them.
export BACKEND_IMAGE FRONTEND_IMAGE

# ── 0. Preconditions ──────────────────────────────────────────────────────
# `/opt/curatix/.env` is written from AWS Secrets Manager by
# `deploy/render-env.sh`, using the instance's own IAM role. It is NOT written
# here and NOT stored in git — secrets rotate on a different clock from code,
# and a deploy that re-reads them makes every deploy a rotation event.
[ -f .env ] || die "$APP_DIR/.env is missing. Run: sudo bash deploy/render-env.sh" 3
[ "$(stat -c '%a' .env)" = "600" ] || die "$APP_DIR/.env must be mode 600 (found $(stat -c '%a' .env))" 3

command -v aws >/dev/null || die "aws CLI is not installed on this instance" 3
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 plugin is not installed (\`docker compose\`, not \`docker-compose\`)" 3

# ── 1. ECR login ──────────────────────────────────────────────────────────
#
# THE INSTANCE ROLE IS NOT ENOUGH ON ITS OWN. IAM authorises the ECR *API*;
# `docker pull` speaks the *registry* protocol and needs a registry credential.
# Without this step every pull fails with `no basic auth credentials`, which
# reads like a missing IAM permission and is not one.
#
# `get-login-password` uses the instance profile (CuratixEC2Role) — no key is
# stored here and none is handed to the box by the workflow. The token lasts 12
# hours, so logging in per deploy is simpler and safer than caching it.
#
# `--password-stdin` so the token never appears in argv, where `ps` would show
# it to every user on the machine.
log "authenticating to ECR ($REGISTRY)"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null \
  || die "ECR login failed. Check that CuratixEC2Role has ecr:GetAuthorizationToken." 3

# ── 2. Pull first ─────────────────────────────────────────────────────────
# Before stopping anything. A registry outage, a missing tag or a revoked
# permission then fails while the current version is still serving.
log "pulling images"
docker pull -q "$BACKEND_IMAGE"  || die "could not pull $BACKEND_IMAGE" 4
docker pull -q "$FRONTEND_IMAGE" || die "could not pull $FRONTEND_IMAGE" 4

# ── 3. Migrations ─────────────────────────────────────────────────────────
# `migrate_safe` prints the plan, holds a Postgres advisory lock so concurrent
# runs serialise, and uses the DIRECT (session-mode) connection — the pooler
# cannot hold advisory locks across statements.
#
# A failure here STOPS the deploy. The old containers keep serving the old
# schema, which is the state they were already in — no traffic is affected.
if [ "${SKIP_MIGRATIONS:-0}" = "1" ]; then
  log "skipping migrations (rollback: the schema is forward-only)"
else
  log "migrations"
  "${COMPOSE[@]}" --profile migrate run --rm migrate \
      python manage.py migrate_safe --yes \
    || die "migrations failed — nothing was restarted, the old version is still serving" 5
fi

# ── 4. Start ──────────────────────────────────────────────────────────────
# `--no-deps` per service so the ordering is ours, not Compose's: the backend
# comes up and passes its healthcheck before Caddy is asked to route to it.
#
# Compose replaces each container BY SERVICE NAME, so the old one is stopped
# and removed as the new one starts — an old and a new container for the same
# service can never run side by side. `web` has `stop_grace_period: 40s` and
# gunicorn's graceful timeout is shorter, so in-flight requests finish rather
# than being cut off. On a single instance there is still a seconds-long gap
# while web restarts; that is inherent to one box, not a defect here.
log "starting services"
"${COMPOSE[@]}" up -d --no-deps web worker scheduler || die "could not start backend services" 6
"${COMPOSE[@]}" up -d --no-deps frontend             || die "could not start frontend" 6
"${COMPOSE[@]}" up -d --no-deps caddy                || die "could not start caddy" 6

# One reconciling pass. Everything above is already current, so this changes
# nothing — except removing ORPHANS: containers from a service that used to be
# in the compose file and no longer is. Those keep running forever otherwise,
# holding ports and memory, with nothing referencing them.
"${COMPOSE[@]}" up -d --remove-orphans >/dev/null 2>&1 || true

# ── 5. Verify from inside ─────────────────────────────────────────────────
log "waiting for the backend to become healthy"
healthy=0
for i in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T web curl -fsS http://127.0.0.1:8000/health/ >/dev/null 2>&1; then
    log "  healthy after $((i * 10))s"
    healthy=1
    break
  fi
  sleep 10
done
if [ "$healthy" != "1" ]; then
  echo "--- last 80 lines of web ---" >&2
  "${COMPOSE[@]}" logs --tail 80 web >&2 || true
  die "the backend never became healthy" 7
fi

# Every long-running service must be up. A worker or scheduler that exited is
# the silent failure this whole architecture exists to avoid: nothing errors,
# and held inventory is never released while organisers are never paid.
for svc in web worker scheduler frontend caddy; do
  state=$("${COMPOSE[@]}" ps --format '{{.State}}' "$svc" 2>/dev/null | head -1)
  printf '    %-10s %s\n' "$svc" "${state:-MISSING}"
  if [ "$state" != "running" ]; then
    echo "--- last 80 lines of $svc ---" >&2
    "${COMPOSE[@]}" logs --tail 80 "$svc" >&2 || true
    die "service $svc is '${state:-MISSING}', not running" 8
  fi
done

# A container that restarts repeatedly reports "running" between crashes, so
# the check above can pass on a stack that is not actually working.
sleep 15
for svc in web worker scheduler frontend; do
  cid=$("${COMPOSE[@]}" ps -q "$svc" 2>/dev/null || true)
  [ -n "$cid" ] || continue
  n=$(docker inspect --format '{{.RestartCount}}' "$cid" 2>/dev/null || echo 0)
  if [ "${n:-0}" -gt 3 ]; then
    echo "--- last 80 lines of $svc ---" >&2
    "${COMPOSE[@]}" logs --tail 80 "$svc" >&2 || true
    die "crash loop: $svc has restarted $n times" 9
  fi
done

# ── 6. Record what is running ─────────────────────────────────────────────
#
# THIS FILE IS THE ROLLBACK TARGET, and that is why it is written only HERE —
# after every check has passed. "The last commit on main" is not the same thing
# as "the last version that actually worked"; after two failed deploys in a row
# they are different, and rolling back to the wrong one turns an outage into a
# longer outage.
#
# The previous generation is kept so a rollback has somewhere to go.
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

# Kept for humans and for anything that already reads it.
echo "$DEPLOY_SHA" > .deployed-sha

log "deployed $DEPLOY_SHA"

# Reclaim space. The disk is 30 GB and every deploy leaves the previous image
# behind. `until=168h` keeps a week of local rollback targets; ECR keeps the
# real history, so nothing is lost by pruning here.
docker image prune -f --filter "until=168h" >/dev/null 2>&1 || true
