# Production go-live checklist

A sign-off sheet, not a tutorial. Every line is a yes/no an operator can answer
in under a minute. [DEPLOYMENT.md](DEPLOYMENT.md) explains how to do each one
and why it matters.

Work top to bottom. The order is by lead time — the first section takes weeks,
the last takes minutes.

---

## Weeks ahead

- [ ] **DLT registration started** (India, SMS) — entity, sender id, and a
      separately approved template per message type. Weeks. Until it completes,
      `SMS_PROVIDER=console` and no SMS is sent, which is honest rather than
      broken.
- [ ] **Google OAuth consent screen submitted** for verification, if more than
      100 users need to connect a calendar.
- [ ] **Domain registered**, DNS delegated, TLS terminating in front of the app.
- [ ] **Razorpay account activated** and **Route enabled** — without Route the
      organizer share cannot be held, and the platform ends up holding
      organizer funds.

## Cloud resources

- [ ] Supabase project created in the users' region.
- [ ] `DATABASE_URL` on port **6543** (transaction) and `DIRECT_DATABASE_URL` on
      **5432** (session), username `postgres.<project-ref>`, both `sslmode=require`.
- [ ] **Point-in-time recovery confirmed enabled**, retention window noted.
- [ ] Upstash Redis created; `rediss://` **without** `?ssl_cert_reqs=none`.
- [ ] Storage bucket created; S3 access key issued (not the anon or service-role key).
- [ ] Google Cloud project with the six APIs enabled, including Calendar.
- [ ] **Maps server key restricted by IP**; **browser key restricted by referrer**
      and to Maps JavaScript only.
- [ ] **Budget alert set on the Google project.** Maps bills per request with no
      ceiling by default.
- [ ] SMTP sender verified with **SPF, DKIM and DMARC** aligned to your domain.
- [ ] Sentry projects created — one backend, one frontend. Two, not one: a
      shared DSN merges server and browser errors into a stream where you cannot
      tell which side broke.

## Configuration

- [ ] `docker-compose.override.yml` is **absent from the deploy host**. It
      auto-loads and would point production at container databases while holding
      real credentials.
- [ ] `.env` created from `.env.production.example`; **every `<PLACEHOLDER>` filled**.
- [ ] `SECRET_KEY`, `JWT_SIGNING_KEY`, `TICKET_QR_SIGNING_KEY` are three
      **distinct** values, each ≥ 32 bytes, none from any example file.
- [ ] `DJANGO_SETTINGS_MODULE=config.settings.prod`, `DEBUG=false`,
      `ENVIRONMENT=production`.
- [ ] `ALLOWED_HOSTS`, `PUBLIC_SITE_URL`, `CORS_ALLOWED_ORIGINS`,
      `CSRF_TRUSTED_ORIGINS`, `GOOGLE_OAUTH_REDIRECT_URI` all on the real
      domain, all `https`.
- [ ] `GOOGLE_OAUTH_REDIRECT_URI` registered **verbatim** in the Google console.
- [ ] Razorpay webhook registered for `payment.captured` and `payment.failed`;
      `RAZORPAY_WEBHOOK_SECRET` matches.
- [ ] `NUM_PROXIES` set to the real hop count. At 0, every IP rate limit is one
      global bucket.
- [ ] `NEXT_PUBLIC_MEDIA_BASE_URL` matches `S3_PUBLIC_BASE_URL`. Mismatched,
      every poster fails silently.
- [ ] `ALLOW_REMOTE_TEST_DATABASE` is blank.
- [ ] **Business values reviewed, not accepted**: `PLATFORM_FEE_PER_TICKET`,
      `SETTLEMENT_REFUND_WINDOW_HOURS`, `BOOKING_HOLD_MINUTES`,
      `CHECKIN_WINDOW_OPENS_BEFORE_MINUTES`, `CHECKIN_WINDOW_GRACE_AFTER_MINUTES`.

## Deploy

- [ ] `docker compose -f docker-compose.yml build` succeeds.
- [ ] `manage.py check --deploy` is **clean** — this runs the whole gate without
      starting anything or touching the database.
- [ ] Migration plan reviewed (`showmigrations --plan`) before applying.
- [ ] Migrations applied via the **`migrate` profile**, never on boot.
- [ ] Superuser created.
- [ ] **All three processes running**: `web`, `scheduler`, `worker`. Without the
      scheduler, held inventory is never released and **organizers are never
      paid** — silently, because the tasks are registered and simply never fire.
- [ ] Frontend built with production `NEXT_PUBLIC_*`. These are baked in at
      build time; a restart does not change them.

## Verify against the running system

- [ ] `GET /health/` returns 200.
- [ ] The database host is Supabase, not a container.
- [ ] `razorpay`, `cryptography`, `pywebpush`, `boto3` all importable in the image.
- [ ] A public event page renders its **poster** (storage + `remotePatterns`).
- [ ] Sign-in works (CORS, `ALLOWED_HOSTS`, JWT).
- [ ] **A real ticket bought through live Checkout issues a ticket.** The only
      way to prove the webhook reaches you.
- [ ] The ticket **email arrives** (SMTP, DKIM, outbox worker).
- [ ] The QR **scans** at check-in.
- [ ] That test booking is **refunded**, so no test money sits in a settlement.
- [ ] Scheduler logs show a tick.

## Operational readiness

- [ ] Sentry receiving events, tagged `production`.
- [ ] Someone is on call and knows where [OPERATIONS.md](OPERATIONS.md) is.
- [ ] A backup has been **restored into a scratch project at least once**. A
      backup nobody has restored is a hypothesis.
- [ ] Secret rotation procedure read — in particular that rotating
      `TICKET_QR_SIGNING_KEY` invalidates every unscanned ticket, and
      `JWT_SIGNING_KEY` signs out every user.
- [ ] Terms, privacy policy and refund policy published — the booking funnel
      links to them.
- [ ] GST / invoicing arrangements confirmed.
- [ ] Data-retention decision made for `AuditLog`, `ScanLog`, `NotificationLog`
      and `OutboxEvent`. All grow without bound.

---

## Known limits at launch

Not blockers — things to have decided rather than discovered.

| Limit | Consequence |
| --- | --- |
| Gmail as the relay | ~500 recipients/day, and Gmail rewrites `From` so SPF/DKIM cannot align to your domain. Preflight warns. Fine for launch, not for volume. |
| SMS off (`console`) | No OTP or booking SMS until DLT completes. Nothing pretends otherwise. |
| Google sign-in not built | The button explains itself rather than failing silently. |
| Frontend Sentry not wired | The DSN has a home; `@sentry/nextjs` is not installed. Browser errors surface only in the user's console. |
| `QUEUE_BACKEND=local` | Complete and supported — the `worker` process executes tasks. The cloud queue is for cross-service dispatch you do not have. |
