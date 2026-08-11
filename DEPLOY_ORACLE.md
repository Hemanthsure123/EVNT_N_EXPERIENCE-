# Deploying to Oracle Cloud (Always Free)

> **Which deployment document?** `DEPLOY_EC2.md` is the authoritative runbook
> for the **AWS EC2 production** deployment (Caddy, Supabase, Upstash).
> `DEPLOYMENT.md` explains the rules that apply to every target;
> `DEPLOY_ORACLE.md` is the single-box Oracle topology and
> `DEPLOY_RENDER_VERCEL.md` the short-lived Render/Vercel test topology. Do not
> mix instructions between them — they use different databases and different
> compose files.

Everything on one Ampere VM: Postgres, Redis, the three backend processes, the
Next.js frontend, and Caddy terminating TLS.

`DEPLOYMENT.md` is the general runbook and assumes managed Supabase/Upstash.
This file is the Oracle-specific path and is self-contained — follow it top to
bottom.

---

## 0. What you are about to deploy, and what it will and will not do

Read this before starting; it decides whether the steps below are the right
ones for you.

**It runs on staging settings, not production settings.** `config.settings.prod`
runs the preflight gate with `strict=True`, which *refuses to boot* on any fake
adapter. Three of those cannot be made real today:

| Adapter | Why it cannot be real yet |
| --- | --- |
| `SMS_PROVIDER=console` | India's DLT registration takes **weeks** — entity id, sender id, and a separately approved template per message type. |
| `PAYMENTS_BACKEND=fake` | Needs a Razorpay account with **Route** enabled. |
| `EMAIL_PROVIDER=console` | Needs a domain with SPF, DKIM and DMARC aligned. |

`config.settings.staging` is the same file with `strict=False`: those become
loud warnings, while **every security check stays fatal** — `DEBUG` off, secure
cookies, and the three signing keys still rejected if short or shipped.

So what you get is the entire platform, publicly reachable, with **payments
simulated and no SMS**. The checkout says *"Demo mode — this payment is
simulated"* and still issues real tickets with real signed QR codes through the
same confirmation path a live payment takes. It never claims money moved.
§12 is the switch to real production.

**Cost:** ₹0 if you stay inside Always Free. The two things that can silently
start billing are covered in §13.

---

## 1. Pick the right shape (this is the step people get wrong)

In the OCI console: **☰ → Compute → Instances → Create instance**.

| Setting | Value | Why |
| --- | --- | --- |
| Image | **Canonical Ubuntu 22.04** | Debian-family, and every command below assumes `apt`. |
| Shape | **VM.Standard.A1.Flex** | The Ampere ARM shape. |
| OCPUs | **4** | |
| Memory | **24 GB** | |

**Do not take the default `VM.Standard.E2.1.Micro`.** It is 1 GB of RAM, and
Postgres + Redis + three Python processes + a Node server will not fit — you
will get OOM-killed containers and blame the application. The A1.Flex 4/24 is
the *whole* Always Free Ampere allowance and it is free; take all of it.

> **"Out of host capacity"** is the single most common blocker here. Ampere is
> heavily oversubscribed in popular regions. If you hit it: try a different
> availability domain in the same region, try again at a quieter hour, or
> create the instance in a different region. It is a capacity queue, not a
> problem with your account. Upgrading to Pay As You Go (still ₹0 while inside
> Always Free limits) markedly improves your odds.

Add your **SSH public key** when prompted. Under *Boot volume*, 50 GB is
plenty (Always Free gives you 200 GB total across volumes).

Create it, then note the **public IP**.

---

## 2. Open the ports — BOTH firewalls

Oracle has two, and traffic must pass both. Missing the second is the classic
"my site is up but nothing loads".

**a) The VCN security list.** ☰ → Networking → Virtual Cloud Networks → your
VCN → Security Lists → *Default Security List* → **Add Ingress Rules**:

| Source CIDR | Protocol | Dest. port |
| --- | --- | --- |
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

(Port 22 is already there.) Do **not** open 5432, 6379 or 8000 — nothing
outside the box needs them, and §5 keeps them off the host anyway.

**b) The instance's own iptables.** Ubuntu images on OCI ship with a
restrictive `iptables` that blocks 80/443 even after the security list allows
them. SSH in and fix it:

```bash
ssh ubuntu@<YOUR-PUBLIC-IP>

sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

---

## 3. Point your domain at the box

You need a domain for TLS — Let's Encrypt will not issue for a bare IP.

Create an **A record** for your domain (and `www` if you want it) pointing at
the instance's public IP. Verify before continuing, because Caddy will fail its
certificate challenge otherwise:

```bash
dig +short <YOUR-DOMAIN>     # must print your instance IP
```

> **No domain?** A free one from Cloudflare/DuckDNS works. If you genuinely
> want IP-only for a first look, set `SITE_DOMAIN=:80` in `.env` — Caddy then
> serves plain HTTP with no certificate. Do not stay there: the app sets
> `SESSION_COOKIE_SECURE`, so **sign-in will not work over plain HTTP**.

---

## 4. Install Docker

```bash
sudo apt-get update && sudo apt-get upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit                       # log out and back in for the group to apply
```

Back in:

```bash
docker --version && docker compose version    # Compose must be v2
```

---

## 5. Get the code

```bash
sudo apt-get install -y git
git clone <YOUR-REPO-URL> eventful && cd eventful
```

**Delete the development override if it is present.** It auto-loads, and it
would point this deployment at empty containers while holding real credentials:

```bash
rm -f docker-compose.override.yml
```

The application also guards this itself — preflight refuses to boot production
when the database host is `postgres`, `pgbouncer`, `redis` or `db` — but a
guard is not a reason to leave the file there.

---

## 6. Object storage (OCI Object Storage, S3-compatible)

`STORAGE_BACKEND=local` writes uploads to the container filesystem, where they
vanish on the next deploy and take every event poster with them. Oracle's
object storage is in Always Free and speaks S3.

1. ☰ → Storage → **Buckets** → *Create Bucket*. Name it `eventful-media`.
2. Open it → **Edit Visibility → Public**. (Posters are public images; the API
   still controls what gets written.)
3. Note your **namespace**: shown on the bucket page as *Namespace*.
4. Create an S3 signing key: click your **avatar → My profile → Customer
   secret keys → Generate secret key**. Copy both halves **now** — the secret
   is shown once.

Your endpoint is:

```
https://<NAMESPACE>.compat.objectstorage.<REGION>.oraclecloud.com
```

`<REGION>` is your region key, e.g. `ap-hyderabad-1` for India South
(Hyderabad).

---

## 7. Configure

```bash
cp .env.oci.example .env
```

Generate three **distinct** secrets:

```bash
for i in 1 2 3; do python3 -c "import secrets; print(secrets.token_urlsafe(48))"; done
```

Now edit `.env` and replace every `<PLACEHOLDER>`:

- `SECRET_KEY`, `JWT_SIGNING_KEY`, `TICKET_QR_SIGNING_KEY` — one each, never
  the same value three times.
- `SITE_DOMAIN`, `ACME_EMAIL`, `ALLOWED_HOSTS`, `PUBLIC_SITE_URL`,
  `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`.
- `POSTGRES_PASSWORD`, and the **same** password inside both `DATABASE_URL`
  and `DIRECT_DATABASE_URL`.
- The `S3_*` block and `S3_PUBLIC_BASE_URL` from §6.
- `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_SITE_URL` — both
  `https://<YOUR-DOMAIN>`, no trailing slash, no `/api` suffix (the client
  appends `/api/v1` itself).
- `NEXT_PUBLIC_MEDIA_BASE_URL` — must equal `S3_PUBLIC_BASE_URL`, or
  `next/image` refuses every poster, silently, one image at a time.

Lock it down:

```bash
chmod 600 .env
```

---

## 8. Build

```bash
docker compose -f docker-compose.yml -f docker-compose.oci.yml build
```

Both images build natively for ARM; nothing pins a platform. The frontend build
takes a few minutes on 4 OCPUs — it compiles the whole Next.js app.

> `NEXT_PUBLIC_*` values are **compiled into the browser bundle**. Changing one
> later needs `... build frontend`, not a restart.

---

## 9. Start the database, then migrate

Migrations never run on boot — they are a compose profile, so an unreviewed
schema change cannot ride in on a deploy and two replicas cannot race.

```bash
# The database only, so migrations have something to talk to.
docker compose -f docker-compose.yml -f docker-compose.oci.yml up -d eventful-db eventful-cache

# Watch for "database system is ready to accept connections".
docker compose -f docker-compose.yml -f docker-compose.oci.yml logs -f eventful-db
```

Then apply the schema. It prints the plan and asks before touching anything:

```bash
docker compose -f docker-compose.yml -f docker-compose.oci.yml \
  --profile migrate run --rm migrate python manage.py migrate_safe
```

---

## 10. Start everything

```bash
docker compose -f docker-compose.yml -f docker-compose.oci.yml up -d

docker compose -f docker-compose.yml -f docker-compose.oci.yml ps
```

You should see **five** services healthy: `eventful-db`, `eventful-cache`,
`web`, `frontend`, `caddy` — plus `scheduler` and `worker` running.

> **All three backend processes matter.** Without `scheduler`, held ticket
> inventory is never released and organizers are never paid — silently, because
> the jobs are registered and simply never fire.

Caddy gets a certificate on first request; give it ~30 seconds, then:

```bash
curl -I https://<YOUR-DOMAIN>/health/     # 200 from Django
curl -I https://<YOUR-DOMAIN>/            # 200 from Next.js
```

---

## 11. First operator account

```bash
docker compose -f docker-compose.yml -f docker-compose.oci.yml \
  exec web python manage.py createsuperuser
```

That account can reach the operator console at `https://<YOUR-DOMAIN>/admin`
(the Next.js console — gated on `is_staff`).

**Django's own admin is deliberately not published.** It lives at the same
`/admin` path as the console, and a session-cookie admin with model-level
delete on a public origin is a large surface for an optional tool. Reach it
over SSH when you genuinely need it:

```bash
ssh -L 8000:localhost:8000 ubuntu@<YOUR-PUBLIC-IP>
# then on the server:
docker compose -f docker-compose.yml -f docker-compose.oci.yml \
  exec web python manage.py runserver 0.0.0.0:8000
# browse http://localhost:8000/admin/ on your own machine
```

---

## 12. Going from simulated to real

When Razorpay, SMTP and DLT are ready, change only `.env`:

```diff
-ENVIRONMENT=staging
-DJANGO_SETTINGS_MODULE=config.settings.staging
+ENVIRONMENT=production
+DJANGO_SETTINGS_MODULE=config.settings.prod

-PAYMENTS_BACKEND=fake
+PAYMENTS_BACKEND=razorpay
+RAZORPAY_KEY_ID=rzp_live_...
+RAZORPAY_KEY_SECRET=...
+RAZORPAY_WEBHOOK_SECRET=...

-EMAIL_PROVIDER=console
+EMAIL_PROVIDER=smtp
+SMTP_HOST=...
+SMTP_FROM_EMAIL=...
```

Then rebuild the frontend (the Razorpay public key is baked in) and restart:

```bash
docker compose -f docker-compose.yml -f docker-compose.oci.yml build frontend
docker compose -f docker-compose.yml -f docker-compose.oci.yml up -d
```

Register the Razorpay webhook at `https://<YOUR-DOMAIN>/api/v1/payments/webhook`
for `payment.captured` and `payment.failed`, and work
[PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) before taking real money.

If preflight refuses to boot, **read the error** — it lists every problem at
once and each line names the variable. That refusal is the feature: a fake
adapter in production means checkouts succeed and no money moves.

---

## 13. Staying at ₹0

Two things bill silently:

- **Google Maps.** Billed per request with no ceiling by default. Set a budget
  alert on the Google project. Leaving `GOOGLE_MAPS_API_KEY` blank disables the
  venue picker cleanly rather than half-working.
- **Egress above 10 TB/month.** Not reachable by a normal launch, but worth
  knowing it exists.

Also set an OCI budget alert: ☰ → Billing → **Budgets** → create one at a
small amount. Always Free resources do not consume it; anything that does is
something you did not intend.

---

## 14. Day to day

```bash
# Logs (a specific service, or all)
docker compose -f docker-compose.yml -f docker-compose.oci.yml logs -f web

# Deploy a change
git pull
docker compose -f docker-compose.yml -f docker-compose.oci.yml build
docker compose -f docker-compose.yml -f docker-compose.oci.yml \
  --profile migrate run --rm migrate python manage.py migrate_safe
docker compose -f docker-compose.yml -f docker-compose.oci.yml up -d

# Back up the database — do this before every migration
docker compose -f docker-compose.yml -f docker-compose.oci.yml \
  exec eventful-db pg_dump -U eventful eventful | gzip > backup-$(date +%F).sql.gz
```

A backup nobody has restored is a hypothesis. Restore one into a scratch
database at least once.

[OPERATIONS.md](OPERATIONS.md) covers running it beyond this.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `curl` to port 80/443 times out | The instance `iptables` (§2b), not the security list. Check `sudo iptables -L INPUT -n --line-numbers`. |
| Caddy logs a certificate failure | DNS is not pointing at the box yet, or 80 is closed. Let's Encrypt validates over port 80. |
| `web` restarts repeatedly | Preflight refused. `docker compose ... logs web` names every failing variable. |
| Sign-in fails, nothing else broken | You are on plain HTTP. `SESSION_COOKIE_SECURE` requires TLS. |
| Posters do not render | `NEXT_PUBLIC_MEDIA_BASE_URL` ≠ `S3_PUBLIC_BASE_URL`, or the bucket is not public. Rebuild after changing it. |
| Everything 502s | `web`/`frontend` unhealthy. `docker compose ... ps` shows which. |
| "Out of host capacity" | Ampere availability, not you. See §1. |
