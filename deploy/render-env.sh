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

echo "==> fetching $SECRET_ID from Secrets Manager ($REGION)"

# ── The umask is set BEFORE the file exists ───────────────────────────────
# `mktemp` then `chmod 600` leaves a window — however short — in which the
# secret is on disk world-readable. Any process on the box scanning /tmp wins
# that race. `umask 077` means the file is 600 from the instant it is created.
umask 077
TMP=$(mktemp "$APP_DIR/.env.XXXXXX")
trap 'rm -f "$TMP"' EXIT

# ── The secret is a JSON object of KEY -> value ───────────────────────────
#
# Encoded for the DOTENV parser Compose actually uses, not for a shell. Those
# are different grammars and the difference is invisible until it is not.
#
# ── SINGLE QUOTES, AND THIS IS NOT A STYLE CHOICE ────────────────────────
#
# In a Compose env-file a DOUBLE-quoted value is expanded and unescaped, like a
# shell string. Verified empirically, not assumed:
#
#     "ab$cd"      ->  ab        ($cd expands to an undefined variable)
#     "a\\b"       ->  a<BS>     (\b is read as the backspace escape)
#
# Django's `get_random_secret_key()` draws from a charset that INCLUDES `$`, so
# a routine SECRET_KEY would be silently truncated at the first `$` — every
# session invalidated, every signed token rejected, and nothing anywhere
# reporting a parse error. That is precisely the class of failure this whole
# deployment exists to make impossible.
#
# A SINGLE-quoted value is taken literally: no expansion, no escapes, and real
# newlines are permitted inside it (so a PEM-shaped VAPID key survives). The
# one thing it cannot carry is a single quote, which has no escape inside
# single quotes — those rare values fall back to double quotes with `\`, `"`,
# `$`, newline, CR and tab escaped, backslash first so no accidental `\b`/`\t`
# sequence is formed by the escaping itself.
#
# Nothing here echoes a value: the payload is piped, never interpolated into a
# command line where `ps` would show it, and the only output is a count.
SECRET_JSON=$(aws secretsmanager get-secret-value \
    --secret-id "$SECRET_ID" \
    --region "$REGION" \
    --query SecretString \
    --output text)

SECRET_JSON="$SECRET_JSON" python3 - <<'PY' > "$TMP"
import json, os, sys

try:
    data = json.loads(os.environ.get("SECRET_JSON", ""))
except json.JSONDecodeError as exc:
    sys.exit(f"the secret is not valid JSON ({exc}). It must be an object of KEY -> value.")
if not isinstance(data, dict):
    sys.exit("the secret must be a JSON OBJECT of KEY -> value, not a %s." % type(data).__name__)

def quote(text):
    # Single quotes are literal in a Compose env-file: no expansion, no escape
    # processing, real newlines allowed. Correct for everything except a value
    # that itself contains a single quote, which has no escape inside them.
    if "'" not in text:
        return "'" + text + "'"
    return '"' + (
        text.replace("\\", "\\\\")   # backslash FIRST, or the escapes below
            .replace("\"", "\\\"")   # would themselves form \b, \t, ...
            .replace("$", "\\$")     # or Compose expands it as a variable
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
if [ "$lines" -lt 10 ]; then
  # A secret that parsed to almost nothing is a wrong secret id or a changed
  # shape, not a minimal config: this application needs ~40 variables and
  # preflight refuses to boot without them. Failing here keeps the WORKING
  # .env in place; overwriting it would take the site down with no way back
  # that does not involve AWS.
  echo "REFUSING: rendered only $lines variables — that is not a full config." >&2
  echo "The existing $TARGET has been left untouched." >&2
  exit 4
fi

# ── Sanity, without printing anything ─────────────────────────────────────
# Named because their absence is a specific, expensive failure:
#   DATABASE_URL          — no database
#   SECRET_KEY            — Django refuses to start
#   RAZORPAY_*            — checkout takes money it cannot verify
#   TICKET_QR_SIGNING_KEY — every issued ticket fails at the gate
#
# The last three are not application config — they are what Compose
# INTERPOLATES. `/opt/curatix/.env` is also the project `.env` Compose reads
# for `${VAR}` substitution, and `docker-compose.ec2.yml` uses `${SITE_DOMAIN:?}`
# and `${NEXT_PUBLIC_*:?}`. Compose evaluates those even when it is only
# pulling and never building, so a missing one fails `up` outright.
for required in DATABASE_URL DIRECT_DATABASE_URL REDIS_URL SECRET_KEY \
                JWT_SIGNING_KEY TICKET_QR_SIGNING_KEY \
                RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET \
                SITE_DOMAIN NEXT_PUBLIC_API_BASE_URL NEXT_PUBLIC_SITE_URL; do
  grep -q "^${required}=" "$TMP" || {
    echo "REFUSING: $required is missing from $SECRET_ID." >&2
    echo "The existing $TARGET has been left untouched." >&2
    exit 5
  }
done

# ── Keep one generation back ──────────────────────────────────────────────
# A bad rotation is recoverable by moving this file back, without another
# round-trip to AWS while the site is down.
[ -f "$TARGET" ] && cp -p "$TARGET" "$TARGET.prev"

# `mv` within the same filesystem is atomic: no reader ever sees a half-written
# .env, and a crash mid-render leaves the old file intact.
mv "$TMP" "$TARGET"
trap - EXIT

chmod 600 "$TARGET"
chown root:root "$TARGET" 2>/dev/null || true

echo "==> wrote $TARGET ($lines variables, mode $(stat -c '%a' "$TARGET"))"
echo "    restart to apply:  docker compose -f docker-compose.yml -f docker-compose.ec2.yml up -d"
echo
echo "    NOTE: NEXT_PUBLIC_* changes need a frontend REBUILD, not a restart —"
echo "    they are compiled into the client bundle. Re-run the release workflow."
