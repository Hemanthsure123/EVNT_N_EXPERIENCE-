#!/usr/bin/env bash
# Render /opt/curatix/.env from AWS Secrets Manager.
#
#   sudo BACKEND_SECRET_ID=curatix/prod bash deploy/render-env.sh
#
# ── WHY THE SECRET LIVES IN SECRETS MANAGER AND NOT IN GIT ────────────────
#
# `.env` on this box holds the Supabase password, the Upstash URL, the S3 keys,
# the Razorpay key secret and webhook secret, the JWT signing key, the ticket QR
# signing key and Django's SECRET_KEY. Between them they are: every booking, the
# ability to mint a valid ticket QR, and the ability to accept a forged payment
# webhook.
#
# So the file is:
#   - never committed (`.env*` is in .gitignore AND backend/.dockerignore),
#   - never baked into an image (the image reads it at runtime via `env_file`),
#   - never written into a GitHub workflow or printed to a log,
#   - fetched by the INSTANCE using its own IAM role (CuratixEC2Role) — no
#     access key exists anywhere for an attacker to steal, and revoking access
#     is a role change rather than a rotation across N places.
#
# ── WHY IT IS A SCRIPT AND NOT A DEPLOY STEP ──────────────────────────────
#
# Secrets change on a different clock from code. A rotated Razorpay secret must
# not require a deploy, and a deploy must not require re-reading secrets — so
# `deploy.sh` only CHECKS that `.env` exists and is 600, and this script is run
# on its own when the secret's contents change.
#
# ── DEPENDENCIES: aws + python3, DELIBERATELY NOT jq ──────────────────────
#
# Amazon Linux 2023 ships neither `jq` nor a package that pulls it in, but it
# does ship python3. Depending on jq would mean this script fails on a fresh
# instance with a message about a JSON tool, which is a confusing way to
# discover a packaging assumption.

set -euo pipefail

APP_DIR=${APP_DIR:-/opt/curatix}
SECRET_ID=${BACKEND_SECRET_ID:-curatix/prod}
REGION=${AWS_REGION:-ap-south-1}
TARGET="$APP_DIR/.env"

command -v aws >/dev/null     || { echo "aws CLI is not installed" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is not installed" >&2; exit 1; }
[ -d "$APP_DIR" ]             || { echo "$APP_DIR does not exist" >&2; exit 1; }

echo "[RENDER][1] START: fetching $SECRET_ID from Secrets Manager ($REGION)"

# ── The umask is set BEFORE the file exists ───────────────────────────────
umask 077
TMP=$(mktemp "$APP_DIR/.env.XXXXXX")
trap 'rm -f "$TMP"' EXIT

SECRET_JSON=$(aws secretsmanager get-secret-value \
    --secret-id "$SECRET_ID" \
    --region "$REGION" \
    --query SecretString \
    --output text) || {
    echo "[RENDER][FAILURE] Could not retrieve secret $SECRET_ID from AWS Secrets Manager." >&2
    exit 1
}

echo "[RENDER][2] SUCCESS: Secret JSON retrieved from Secrets Manager"

SECRET_JSON="$SECRET_JSON" python3 - <<'PY' > "$TMP"
import json, os, sys

try:
    data = json.loads(os.environ.get("SECRET_JSON", ""))
except json.JSONDecodeError as exc:
    sys.exit(f"the secret is not valid JSON ({exc}). It must be an object of KEY -> value.")
if not isinstance(data, dict):
    sys.exit("the secret must be a JSON OBJECT of KEY -> value, not a %s." % type(data).__name__)

def quote(text):
    if "'" not in text:
        return "'" + text + "'"
    return '"' + (
        text.replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("$", "\\$")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
    ) + '"'

out = []
for key, value in data.items():
    if not key.replace("_", "").isalnum():
        sys.exit(f"{key!r} is not a valid environment variable name.")
    out.append(f"{key}={quote('' if value is None else str(value))}")
sys.stdout.write("\n".join(sorted(out)) + "\n")
PY

lines=$(wc -l < "$TMP")
echo "[RENDER][3] Formatted $lines environment variable definitions"
if [ "$lines" -lt 10 ]; then
  echo "[RENDER][FAILURE] REFUSING: rendered only $lines variables — that is not a full config." >&2
  echo "The existing $TARGET has been left untouched." >&2
  exit 4
fi

# ── Sanity, without printing anything ─────────────────────────────────────
required_keys=(
    DATABASE_URL DIRECT_DATABASE_URL REDIS_URL SECRET_KEY
    JWT_SIGNING_KEY TICKET_QR_SIGNING_KEY
    RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET
    SITE_DOMAIN NEXT_PUBLIC_API_BASE_URL NEXT_PUBLIC_SITE_URL
    # `config/settings/prod.py` REFUSES to boot without this
    # ("ALLOWED_HOSTS must be set explicitly in production"), so its absence is
    # not a warning — it is a container that will not start. Listed here so the
    # failure is one precise line from this script before anything is deployed,
    # rather than a crash loop discovered from `docker compose logs`.
    ALLOWED_HOSTS
)

missing_keys=()
for required in "${required_keys[@]}"; do
  if ! grep -q "^${required}=" "$TMP"; then
    missing_keys+=("$required")
  fi
done

if [ ${#missing_keys[@]} -gt 0 ]; then
  echo "[RENDER][FAILURE] REFUSING: Missing required key(s) in secret $SECRET_ID: ${missing_keys[*]}" >&2
  echo "The existing $TARGET has been left untouched." >&2
  exit 5
fi

echo "[RENDER][4] Verified all ${#required_keys[@]} required keys are present"

# ── CONDITIONAL KEYS: A GATEWAY YOU TURNED ON MUST BE USABLE ──────────────
#
# Cashfree is OPTIONAL, so its keys cannot join `required_keys` above — a
# single-gateway deployment must keep deploying with none of them set.
#
# But the moment `PAYMENTS_ENABLED_GATEWAYS` names it, production preflight
# REFUSES to boot without its credentials. That is the correct behaviour and it
# is also a crash loop discovered from `docker compose logs` — precisely what
# the ALLOWED_HOSTS comment above says this block exists to turn into one
# precise line before anything is deployed. So the same rule is enforced here,
# from the same file, at the same moment.
#
# Read from the RENDERED file rather than the shell environment: what matters
# is what the instance will actually run, not what happens to be exported in
# whatever shell invoked this script.
#
# ── EVERY VALUE IS READ THROUGH `env_value`, AND THAT IS NOT PEDANTRY ─────
#
# The renderer QUOTES every value, so an empty one is written `KEY=''` — two
# characters. The obvious presence test, `grep -q "^KEY=."`, therefore matches
# the opening QUOTE and passes for a key whose value is empty, which is exactly
# the case this block exists to catch. Strip the quotes first and test the
# value.
env_value() {
  grep "^$1=" "$TMP" | head -n1 | cut -d= -f2- | tr -d "'\"" || true
}

enabled_gateways=$(env_value PAYMENTS_ENABLED_GATEWAYS)
route_provider=$(env_value PAYMENTS_ROUTE_PROVIDER)

case ",${enabled_gateways}," in
  *,cashfree,*)
    cashfree_missing=()
    for required in CASHFREE_APP_ID CASHFREE_SECRET_KEY; do
      if [ -z "$(env_value "$required")" ]; then
        cashfree_missing+=("$required")
      fi
    done
    if [ ${#cashfree_missing[@]} -gt 0 ]; then
      echo "[RENDER][FAILURE] REFUSING: PAYMENTS_ENABLED_GATEWAYS includes 'cashfree'" >&2
      echo "  but these are missing or empty in secret $SECRET_ID: ${cashfree_missing[*]}" >&2
      echo "  Production preflight would refuse to boot, so the containers would" >&2
      echo "  crash-loop instead of failing here." >&2
      echo "The existing $TARGET has been left untouched." >&2
      exit 6
    fi
    echo "[RENDER][4a] Cashfree is enabled and its credentials are present"
    ;;
esac

# `release_payout` settles an ON-HOLD transfer against a linked account, and
# only the provider that ISSUED that account can do it. Cashfree's adapter
# raises, so naming it here means organizers are never paid — weeks later,
# silently, on money that is owed.
if [ "$route_provider" = "cashfree" ]; then
  echo "[RENDER][FAILURE] REFUSING: PAYMENTS_ROUTE_PROVIDER=cashfree cannot release payouts." >&2
  echo "  Cashfree may still TAKE payments — list it in PAYMENTS_ENABLED_GATEWAYS" >&2
  echo "  and leave PAYMENTS_ROUTE_PROVIDER unset (or 'razorpay')." >&2
  echo "The existing $TARGET has been left untouched." >&2
  exit 7
fi

[ -f "$TARGET" ] && cp -p "$TARGET" "$TARGET.prev"

mv "$TMP" "$TARGET"
trap - EXIT

chmod 600 "$TARGET"
chown root:root "$TARGET" 2>/dev/null || true

echo "[RENDER][SUCCESS] Successfully wrote $TARGET ($lines variables, mode $(stat -c '%a' "$TARGET"))"
echo "    restart to apply:  docker compose -f docker-compose.yml -f docker-compose.ec2.yml up -d"
echo
echo "    NOTE: NEXT_PUBLIC_* changes need a frontend REBUILD, not a restart —"
echo "    they are compiled into the client bundle. Re-run the release workflow."
