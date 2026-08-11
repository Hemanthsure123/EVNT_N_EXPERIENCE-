# Deploying Curatix to AWS EC2

**This is the authoritative runbook for the EC2 production deployment.**

There are four deployment documents in this repository and they describe four
different targets. Read the one that matches where you are deploying, and do
not mix instructions between them:

| Document | Target | Database / cache |
| --- | --- | --- |
| **`DEPLOY_EC2.md`** (this file) | **AWS EC2 + Caddy — production** | **Supabase + Upstash** |
| `DEPLOYMENT.md` | Generic container host; the reference for `migrate_safe`, the three processes, and why each rule exists | any |
| `DEPLOY_ORACLE.md` | Oracle Cloud Always Free, single box | Postgres + Redis in containers |
| `DEPLOY_RENDER_VERCEL.md` | Render + Vercel, for short-lived test deployments | Supabase + Upstash |

`DEPLOYMENT.md` remains the explanation of the *rules* — why migrations never
run on boot, why there are three processes, why `environment:` is banned from
the production compose file. This document is the *procedure* for EC2. Where a
rule appears in both, `DEPLOYMENT.md` is the reasoning and this file is the
command.

---

## 1. The topology

```
                    Internet
                        │
              80 / 443  │        ← the only ports the security group allows
                        ▼
              ┌───────────────────┐
              │  caddy            │  TLS (Let's Encrypt), single origin
              └─────────┬─────────┘
                  ┌─────┴──────┐
                  ▼            ▼
        ┌──────────────┐  ┌──────────────┐
        │ web :8000    │  │ frontend     │   Next.js standalone
        │ gunicorn     │  │ :3000        │
        └──────────────┘  └──────────────┘
        ┌──────────────┐  ┌──────────────┐
        │ worker       │  │ scheduler    │   ← no ports; both essential
        │ outbox drain │  │ ×1 replica   │
        └──────────────┘  └──────────────┘
                        │
                        ▼
   Supabase Postgres  ·  Upstash Redis  ·  S3-compatible storage  ·  Razorpay
```

**Nothing stateful runs on the instance.** The database is Supabase, the cache
is Upstash, uploads go to S3-compatible storage. The only persisted local state
is Caddy's certificate store. That is what makes the instance disposable: it can
be terminated and rebuilt without losing a booking.

Five containers, and each is load-bearing:

- **`web`** — gunicorn. Never `runserver`.
- **`worker`** — drains the outbox. Without it no email, SMS or push is ever
  delivered, and nothing errors.
- **`scheduler`** — the clock, exactly one replica. Without it held ticket
  inventory is never released and **organisers are never paid** — silently,
  because the jobs stay registered and simply never fire.
- **`frontend`** — Next.js in `output: 'standalone'` mode.
- **`caddy`** — TLS termination and the one public surface.

Files:

```
docker-compose.yml         production base — no `environment:` blocks, ever
docker-compose.ec2.yml     the EC2 overlay: caddy, frontend, no published 8000
deploy/render-env.sh       Secrets Manager  →  /opt/curatix/.env  (mode 600)
deploy/deploy.sh           runs ON the instance: ECR login → pull → migrate
                           → up → health → record the rollback target
.github/workflows/release.yml   build → scan → approve → deploy over SSM
```

The instance holds **no checkout**. `release.yml` ships the four config files
above to `/opt/curatix` inside the SSM command, built from the same commit as
the images — so there is no repository credential on the box and the config can
never drift from the release it is running.

---

## 2. Manual vs automated — read this before anything else

Everything in this runbook is one of three kinds of action. They are labelled
throughout, because the difference is what stops a "just run the next command"
mistake against production.

| | |
| --- | --- |
| 👤 **HUMAN — AWS console or CLI** | You do it once, by hand. Not scripted, not in CI. Creating an IAM role, storing a secret, editing a security group, pointing DNS. |
| 🤖 **AUTOMATED** | GitHub Actions does it on every push to `main`. You never run it manually. |
| 🖥️ **ON THE INSTANCE** | Runs on the EC2 box, over SSM Session Manager. Normally invoked by the workflow; occasionally by hand for a secret rotation. |

**Nothing in section 3 has been done for you.** No AWS resource has been
created, no secret stored, no DNS record changed, and no migration applied by
the work that produced this file.

---

## 3. One-time setup (👤 HUMAN)

Do these in order. Each is a prerequisite for the next.

### 3.1 ECR repositories

```bash
aws ecr create-repository --repository-name curatix-backend  --region ap-south-1 \
  --image-scanning-configuration scanOnPush=true --image-tag-mutability IMMUTABLE
aws ecr create-repository --repository-name curatix-frontend --region ap-south-1 \
  --image-scanning-configuration scanOnPush=true --image-tag-mutability IMMUTABLE
```

`IMMUTABLE` is the point: a tag that can be overwritten means "the SHA that is
deployed" stops being a fact, and a rollback target can be replaced by the thing
you are rolling back from.

Add a lifecycle policy so the registry does not grow without limit — keep the
last 30 images, which at this deploy rate is roughly a quarter's history.

### 3.2 The GitHub OIDC role

**No long-lived AWS access key is created, and none is stored in GitHub.**
GitHub Actions assumes a role using a short-lived OIDC token. There is nothing
to leak and nothing to rotate.

1. Create the OIDC identity provider for `token.actions.githubusercontent.com`
   (once per AWS account).
2. Create a role, e.g. `curatix-github-deploy`, whose trust policy restricts
   `token.actions.githubusercontent.com:sub` to **this repository** — and, for
   the deploy step, to the `production` environment:

   ```
   "StringLike": { "token.actions.githubusercontent.com:sub":
                   "repo:<owner>/<repo>:*" }
   ```

   Scoping to the repository is not optional. A trust policy that matches `*`
   lets any GitHub repository in the world assume your deployment role.
3. Attach permissions for: ECR push/pull, `ssm:SendCommand` **restricted to the
   one instance id and the `AWS-RunShellScript` document**, and
   `ssm:GetCommandInvocation`.

Record the role ARN as the GitHub repository variable `AWS_DEPLOY_ROLE_ARN`
(a variable, not a secret — a role ARN is not confidential and is easier to
audit when visible).

### 3.3 The instance role

The instance needs its own role — separate from the GitHub one, because they do
different things and a shared role gives each the other's reach:

- `AmazonSSMManagedInstanceCore` — so SSM can run commands on it, which is
  what removes the need for SSH and for the `.pem` to exist in CI at all.
- `ecr:GetAuthorizationToken` + pull on the two repositories.
- `secretsmanager:GetSecretValue` on `curatix/prod` **only**.

### 3.4 The secret

👤 Store production configuration in AWS Secrets Manager as a **JSON object of
`KEY` → `value`**, under the id **`curatix/prod`**:

```bash
aws secretsmanager create-secret --name curatix/prod --region ap-south-1 \
  --secret-string file://prod-env.json     # delete prod-env.json afterwards
```

`deploy/render-env.sh` refuses to write an `.env` that is missing any of these,
and leaves the previous file in place rather than taking the site down:

```
DJANGO_SETTINGS_MODULE      SECRET_KEY               JWT_SIGNING_KEY
DATABASE_URL                DIRECT_DATABASE_URL      REDIS_URL
TICKET_QR_SIGNING_KEY       ALLOWED_HOSTS            CSRF_TRUSTED_ORIGINS
CORS_ALLOWED_ORIGINS        SITE_DOMAIN
RAZORPAY_KEY_ID             RAZORPAY_KEY_SECRET      RAZORPAY_WEBHOOK_SECRET
STORAGE_BACKEND=s3          S3_* (endpoint, bucket, region, key id, secret)
EMAIL_* / SMS_*             VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
GOOGLE_MAPS_API_KEY         GOOGLE_OAUTH_* (if calendar is enabled)
NEXT_PUBLIC_API_BASE_URL    NEXT_PUBLIC_SITE_URL     NEXT_PUBLIC_MEDIA_BASE_URL
NEXT_PUBLIC_RAZORPAY_KEY_ID NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
```

`ENVIRONMENT_VARIABLES.md` is the complete reference with each variable's
meaning. Two notes specific to this deployment:

- **`DATABASE_URL` is Supabase's pooled connection (port 6543) and
  `DIRECT_DATABASE_URL` is the direct one (5432).** Migrations need the direct
  one — `migrate_safe` holds a Postgres advisory lock, and a transaction pooler
  cannot hold one across statements. Getting these the wrong way round produces
  a migration that appears to hang.
- **`STORAGE_BACKEND` must be `s3`.** `core/preflight.py` refuses `local` in
  production, because uploads would go to the container filesystem and vanish on
  the next redeploy.

**The secret is never committed, never baked into an image, never written into a
workflow file, and never printed.** `render-env.sh` sets `umask 077` before the
file exists, so `/opt/curatix/.env` is mode 600 from the instant it is created
rather than for a window after it.

### 3.5 Security group

Inbound: **80 and 443 from `0.0.0.0/0`. Nothing else.**

There is deliberately **no SSH rule**: access is SSM Session Manager, which
needs no inbound port and no key pair. Port 8000 must not be open — and the
compose overlay clears the inherited publish anyway, so it is closed twice.

### 3.6 DNS

👤 Point the domain's A record at the instance's public IP, and wait for it to
resolve **before** starting Caddy for the first time. Caddy requests a
certificate on boot; if DNS is not yet correct the request fails, and Let's
Encrypt's limit is **5 certificates per domain per week**. Five failed attempts
buys a multi-day wait with nothing wrong in the application to explain it.

Consider an Elastic IP so a stop/start does not change the address.

### 3.7 GitHub repository configuration

Repository **variables** (Settings → Secrets and variables → Actions →
Variables). None of these is a secret, and keeping them visible is deliberate:
a role ARN and an instance id are auditable, and hiding them in the secret store
makes a misconfiguration invisible to a reviewer.

| Variable | Example | Used by |
| --- | --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::…:role/curatix-github-deploy` | every AWS step |
| `EC2_INSTANCE_ID` | `i-0abc…` | the SSM deploy step |
| `NEXT_PUBLIC_API_BASE_URL` | `https://fastride.xyz/api` | the frontend build |
| `NEXT_PUBLIC_SITE_URL` | `https://fastride.xyz` | the frontend build |
| `NEXT_PUBLIC_MEDIA_BASE_URL` | the host serving uploads | the frontend build |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | `rzp_test_…` | the frontend build |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | the **browser** key | the frontend build |

The AWS region (`ap-south-1`) and the two ECR repository names are `env:` in
`release.yml` rather than variables — they are part of the deployment's shape,
so a change to them belongs in a reviewed commit rather than in a console field
nobody diffs. The registry hostname is discovered at runtime by
`amazon-ecr-login`.

**No GitHub *secret* is required by any workflow.** The only credential is the
OIDC token GitHub mints per run, and the only long-lived secret in the system
lives in AWS Secrets Manager, where the instance reads it with its own role.

`NEXT_PUBLIC_RAZORPAY_KEY_ID` and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` are
variables and not secrets because both are **published to every visitor** in the
client bundle — that is what `NEXT_PUBLIC_` means. Storing them as secrets would
imply a confidentiality the browser does not honour. The Maps key must therefore
be the referrer-restricted **browser** key, never the server key that
`GOOGLE_MAPS_API_KEY` holds.

- Environment **`production`** with **required reviewers**. This is the approval
  gate: `release.yml` cannot reach the deploy job without a human pressing
  approve, so a merge to `main` is never by itself a production change.

---

## 4. First deploy

1. 👤 Complete every step in section 3.

2. 🖥️ On the instance (SSM Session Manager → `sudo -i`), **once**:

   ```bash
   mkdir -p /opt/curatix && cd /opt/curatix
   curl -fsSL -o render-env.sh \
     https://raw.githubusercontent.com/Hemanthsure123/EVNT_N_EXPERIENCE-/main/deploy/render-env.sh
   BACKEND_SECRET_ID=curatix/prod bash render-env.sh
   ls -l .env        # expect -rw------- (600)
   ```

   **There is deliberately no `git clone`.** The compose files, the Caddyfile
   and the deploy scripts are shipped to the instance inside the SSM command as
   a ~18 KB tarball built from the same commit as the images. That removes three
   things at once: a repository credential on the box, a network path from
   production to GitHub, and the possibility of the instance running a compose
   file from a different commit than the images it is deploying.

   The application itself never arrives this way — only as a signed, scanned,
   SHA-tagged ECR image. Which is why a bind mount of `./backend` or
   `./frontend` is forbidden and asserted against: the image is the artefact, or
   a rollback changes nothing.

   (If the repository is private, `curl` the script from a clone on your laptop
   and paste it instead — this is the only step that touches GitHub from the
   instance, and only once.)

3. 🤖 Run the **release** workflow (`workflow_dispatch`) against the commit you
   want live. It builds both images, scans them, waits for approval, and then
   ships the config bundle and runs `deploy/deploy.sh` on the instance over SSM.

   The instance authenticates to ECR itself, inside `deploy.sh`, using
   `CuratixEC2Role` — the runner never hands it a credential.

4. Verify — section 6.

---

## 5. Ongoing deploys (🤖 AUTOMATED)

```
push to main
   └─ ci.yml           backend tests · mypy · both images build · compose valid
   └─ frontend.yml     typecheck · lint · unit · build · bundle · Playwright+axe
   └─ security.yml     pip-audit · npm audit · Trivy (vuln + secret)
          │  all green
          ▼
      release.yml
        resolve     refuses anything that is not a 40-char SHA
        publish     builds and pushes  <sha>  and  main-<short>  to ECR
        scan-image  Trivy on the artefact that will actually run
        deploy      ⏸ waits for a human to approve `production`
                    → SSM: config bundle + deploy/deploy.sh on the instance
                    → smoke tests from outside, over the public internet
        rollback    on failure: redeploys the LAST SUCCESSFUL release, read
                    from /opt/curatix/.deployed.prev on the instance
```

**Images are tagged with the full 40-character commit SHA.** `main-<short>` is a
human-readable alias for finding an image in the console; nothing deploys from
it. `deploy/deploy.sh` **refuses** any tag that is `latest` or not 40 characters,
so a hand-run deploy cannot bypass the rule either.

What `deploy/deploy.sh` does on the box, in this order and for these reasons:

1. **Check `.env`** exists and is mode 600. Stop if not.
2. **Log in to ECR** with the instance's own role. IAM authorises the ECR
   *API*; `docker pull` speaks the *registry* protocol and needs a registry
   credential — without this every pull fails with `no basic auth credentials`,
   which reads like a missing IAM permission and is not one.
3. **Pull both images** — before stopping anything. A registry outage or a bad
   tag then fails while the current version is still serving.
4. **Migrate** (`migrate_safe --yes`), while the **old** code is still up.
5. **Start** web, worker, scheduler → frontend → caddy, `--no-deps` so the
   ordering is ours, then one reconciling pass with `--remove-orphans`.
   Compose replaces each container by service name, so an old and a new
   container for the same service can never run side by side.
6. **Verify**: health endpoint, every service `running`, and a restart-count
   check — a crash-looping container reports "running" between crashes.
7. **Record** `/opt/curatix/.deployed` — **only now**, after every check has
   passed, because this file is what a rollback reads. The previous generation
   moves to `.deployed.prev`. Then prune images older than a week.

### Migrations run before the new code starts, and that is only safe here

The new code needs the new schema — `0004` adds `BookingRequest.kind`, and every
`kind` query 500s without it. Running `up` first would fail every request in the
window between the two steps.

This ordering is safe **because these migrations are additive** and the old code
ignores what it does not know about. A migration that **drops or renames**
something the running code still uses breaks the old code the moment it applies,
and needs an expand/contract release instead: ship the additive half, deploy,
remove in a later release. Do not skip that for convenience.

**Migrations are forward-only.** There is no automatic downgrade, and a rollback
therefore runs with `SKIP_MIGRATIONS=1` — the old code against the new schema,
which works precisely because the change was additive.

### ⚠️ Pending migrations for the next deploy

```
performers.0004_bookingrequest_kind_alter_bookingrequest_status
performers.0005_bookingrequest_request_open_match_idx
```

Both additive: an `AddField` with a default, an `AlterField` widening a choice
set, and an `AddIndex`. Existing `BookingRequest` rows become `kind=ENQUIRY`,
which is what they are. **They have not been applied to production**, and
`deploy.sh` applies them as step 3 of the next deploy.

---

## 6. Verifying a deploy

```bash
# 🖥️ on the instance
cat /opt/curatix/.deployed-sha
docker compose -f docker-compose.yml -f docker-compose.ec2.yml ps
docker compose -f docker-compose.yml -f docker-compose.ec2.yml logs --tail 50 scheduler
```

```bash
# from anywhere
curl -fsS https://<domain>/health/            # backend
curl -fsSI https://<domain>/ | head -1        # frontend through Caddy
```

Then check the things that fail silently, because nothing will tell you:

- **The scheduler is running and logging job runs.** If it is not, inventory
  leaks and payouts stop.
- **A booking's confirmation email arrives** — that proves the worker is
  draining the outbox.
- **The Razorpay webhook reaches `/payments/webhook`** and returns 200.
  Configure the endpoint in the Razorpay dashboard against this domain; the
  signature is the credential, so a mismatched `RAZORPAY_WEBHOOK_SECRET`
  presents as every payment failing verification.
- **A poster uploads and renders.** If it uploads but does not render,
  `NEXT_PUBLIC_MEDIA_BASE_URL` does not match the host actually serving the
  bytes, and `next/image` refuses each one silently.

---

## 7. Rollback

🤖 The release workflow rolls back automatically when the deploy job fails. It
reads `/opt/curatix/.deployed.prev` **from the instance** — the last release
that actually passed its health checks. It is deliberately not "the parent
commit": after two failed deploys in a row those are different, and rolling back
to a version that was never in production turns an outage into a longer one.

The rollback also requires an approval (it declares `environment: production`),
and it ships the config bundle from that older commit, so images and topology
move together.

🖥️ To roll back by hand:

```bash
cd /opt/curatix
BACKEND_IMAGE=<registry>/curatix-backend:<previous-40-char-sha> \
FRONTEND_IMAGE=<registry>/curatix-frontend:<previous-40-char-sha> \
SKIP_MIGRATIONS=1 \
  bash deploy/deploy.sh
```

`SKIP_MIGRATIONS=1` is required, not optional: the schema is forward-only, and
attempting to migrate backwards during an incident is how a recoverable outage
becomes a data-loss one.

---

## 8. Rotating a secret (🖥️ ON THE INSTANCE)

Secrets change on a different clock from code, so this is not a deploy:

```bash
# 👤 update the secret in AWS first, then:
cd /opt/curatix
BACKEND_SECRET_ID=curatix/prod bash deploy/render-env.sh
docker compose -f docker-compose.yml -f docker-compose.ec2.yml up -d
```

The previous file is kept as `.env.prev` in case the rotation was wrong.

**Exception — `NEXT_PUBLIC_*` needs a rebuild, not a restart.** Those values are
compiled into the client bundle by Next.js, so changing one in `.env` and
restarting does nothing at all. Re-run the release workflow.

---

## 9. What protects this configuration

These are tests, not documentation, and they fail CI:

- `backend/core/tests/test_deployment_topology.py::TestEc2Topology` — fails if
  port 8000 becomes public, if `!reset` is downgraded to `ports: []` (which
  *merges* and silently leaves 8000 published), if a Postgres or Redis service
  appears, if any of the five services is removed, if log rotation is removed,
  if Caddy's certificate volumes are removed, if an image is pinned to `latest`,
  or if source is bind-mounted over an image. Each of the twelve was verified by
  making the change and watching the test fail.
- `::TestDeployScripts` — fails if `deploy.sh` accepts a mutable tag, tolerates
  a world-readable `.env`, migrates in the wrong order, or if `render-env.sh`
  ever gains a line that could print a secret.
- `ci.yml::compose` — resolves the merged configuration with
  `docker compose config` and asserts that only Caddy publishes host ports.
  PyYAML cannot see this: the merge is what creates the risk.
- `ci.yml::frontend-image` — builds the frontend image and checks the standalone
  output is complete and the user is not root.

---

## 10. When something is wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| No HTTPS; Caddy logs an ACME failure | DNS not resolving to this instance, or the weekly certificate limit was hit | Fix DNS, then wait. Do not restart Caddy repeatedly — each attempt spends quota |
| Site up, but nothing is emailed | `worker` is not running | `logs worker`; it is a separate container by design |
| Holds never expire; organisers unpaid | `scheduler` is not running | `logs scheduler`; must be exactly one replica |
| `migrate_safe` appears to hang | `DIRECT_DATABASE_URL` points at the pooler | It must be Supabase port 5432, not 6543 |
| Every payment fails verification | `RAZORPAY_WEBHOOK_SECRET` mismatch | Re-check against the Razorpay dashboard; rotate via section 8 |
| Frontend calls the wrong API URL | `NEXT_PUBLIC_API_BASE_URL` changed without a rebuild | Re-run the release workflow — restarting cannot fix it |
| Posters upload but never render | `NEXT_PUBLIC_MEDIA_BASE_URL` ≠ the host serving the bytes | Correct it, then rebuild |
| Everything dies at once for no reason | Disk full | Log rotation is configured; check `df -h` and `docker system df` |
| Container OOM-killed | 3.7 GiB is not much for five containers | Confirm the 2 GB swap is active (`free -h`); reduce `WEB_CONCURRENCY` |
