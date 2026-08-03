#!/usr/bin/env bash
# Generates a throwaway self-signed CA + leaf certs so the local Redis and
# PgBouncer containers can simulate Upstash's TLS (rediss://) and Supabase's
# SSL-required pooled Postgres endpoint. Certs are written to
# docker/dev-tls/certs/, which is gitignored — regenerate any time by
# deleting that directory and re-running this script. Never used against a
# real service; production points REDIS_URL/DATABASE_URL at Upstash/Supabase's
# own properly CA-signed certs, no code changes needed.
set -euo pipefail

# Prevents Git Bash on Windows from mangling "/CN=..." into a filesystem path.
# Harmless no-op on Linux/macOS.
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")"
mkdir -p certs
cd certs

if [ -f ca.crt ]; then
  echo "Certs already exist in $(pwd) — delete this directory to regenerate."
  exit 0
fi

openssl genrsa -out ca.key 2048
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
  -subj "/CN=local-dev-ca" -out ca.crt

for name in redis pgbouncer; do
  openssl genrsa -out "${name}.key" 2048
  openssl req -new -key "${name}.key" -subj "/CN=${name}" -out "${name}.csr"
  openssl x509 -req -in "${name}.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
    -days 3650 -sha256 -out "${name}.crt"
  rm -f "${name}.csr"
done

rm -f ca.srl
echo "Generated ca.crt + redis.{crt,key} + pgbouncer.{crt,key} in $(pwd)"
