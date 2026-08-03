# Operations

Running Eventful once it is deployed: what to watch, what to do when something
breaks, and the routine tasks nobody should have to reverse-engineer at 2am.

[DEPLOYMENT.md](DEPLOYMENT.md) covers getting it deployed and rolling a deploy
back. This covers everything after.

> **There is no separate RUNBOOK.md.** It would say the same things as this
> file under a different name, and two documents describing one system is how
> both go stale. This *is* the runbook.

---

## 1. What actually matters

Ranked by cost of missing it. This is the order to check things in an incident,
and the order to build alerts in.

| # | Failure | How you find out | Cost |
| --- | --- | --- | --- |
| 1 | **The scheduler stopped** | Nothing tells you. Ticket holds stop expiring and payouts stop releasing. | Inventory leaks permanently; **organizers are never paid**. |
| 2 | **The outbox worker stopped** | Nothing tells you. `OutboxEvent` rows accumulate undrained. | Tickets, refund notices and reminders never send. |
| 3 | **Webhooks not arriving** | Bookings stay `reserved`, then expire. Razorpay's delivery log shows failures. | Customers charged, no ticket. Auto-refund only fires for webhooks that *do* arrive. |
| 4 | Database unreachable | `/health/` 503, immediate. | Total outage — but nothing is lost; the app fails closed. |
| 5 | Storage unreachable | Uploads fail; existing images unaffected. | Organizers cannot add posters. |
| 6 | Redis unreachable | Nothing user-visible. | Caching and rate limiting degrade **open**; the app keeps serving. |

Notice the shape: **the two most expensive failures are silent.** Everything
loud is either survivable or self-announcing. Alerting effort belongs at the
top of this table, not the bottom.

### Minimum alerting

```bash
# The two silent ones. Run from cron on the host, or from any uptime checker.
docker compose -f docker-compose.yml ps --status running --format '{{.Service}}' \
  | grep -q scheduler || echo "SCHEDULER DOWN"
docker compose -f docker-compose.yml ps --status running --format '{{.Service}}' \
  | grep -q worker || echo "WORKER DOWN"
```

Both services declare a `pgrep` healthcheck, so `docker compose ps` shows
`unhealthy` for a wedged-but-alive process too.

Plus: `/health/` from an external checker (not from the host — a host-local
check cannot see a network partition), and Sentry alerting on new issues in
`environment:production`.

---

## 2. Daily and weekly

| Cadence | Task | Why |
| --- | --- | --- |
| Daily | Glance at `/admin` overview: bookings, revenue, failed payouts | The attention-first surface exists precisely so this is one look, not a query. |
| Daily | Sentry new issues | |
| Weekly | Failed `NotificationLog` rows (`status=failed`) | Dead-lettered messages. Each is a customer who did not receive something. |
| Weekly | `PayoutAttempt` rows with failures | A settlement stays owed and retries, but repeated failure means a broken linked account. |
| Weekly | Pooler connection usage in Supabase | The ceiling that `WEB_CONCURRENCY` is bounded by. |
| Weekly | Google Cloud billing | Maps bills per request with no ceiling by default. |
| Monthly | Restore a backup into a scratch project | A backup nobody has restored is a hypothesis. |
| Monthly | Growth of `AuditLog`, `ScanLog`, `NotificationLog`, `OutboxEvent` | All grow without bound. |

---

## 3. Money-path incidents

These are the ones worth being careful about. Every operation below is
idempotent by design — the risk is doing the wrong thing, not doing it twice.

### A customer was charged and has no ticket

The normal path already handles this: if the hold lapsed before the webhook
arrived, `payments` **auto-refunds**. So this state means the webhook did not
arrive at all.

1. Confirm in Razorpay's dashboard that the payment captured.
2. Check Razorpay's **webhook delivery log**. Failures there are the answer.
3. Confirm `/api/v1/payments/webhook` is reachable from outside and not blocked
   at the edge.
4. Razorpay retries failed deliveries. Once reachability is fixed, the retry
   confirms the booking normally — `ProcessedWebhook` dedupes, and confirm is
   idempotent on the booking, so a ticket is never double-issued.
5. If the hold has since expired, the retry returns `hold_expired` and the
   customer is auto-refunded. That is the correct outcome; tell them.

**Do not manually mark a booking paid.** It bypasses ticket issuance and the
outbox, producing a paid booking with no ticket and no email.

### An organizer was not paid

1. `GET /organizer/settlements/{event_id}` — or the settlement row directly.
2. `status=owed` and the event finished more than `SETTLEMENT_REFUND_WINDOW_HOURS`
   ago → the scheduler is not running, or the job is failing. Check §1.
3. `status=failed` → it dead-lettered after `SETTLEMENT_MAX_ATTEMPTS`. The
   settlement **stays owed** and is never lost. Read `PayoutAttempt` for the
   vendor error — usually a linked account that is not activated.
4. Re-trigger: `POST /admin/settlements/{id}/release`. It re-verifies the event
   finished, recomputes `net` **authoritatively from the payment records** under
   a row lock, and carries a vendor idempotency key. Safe to retry.

### A refund arrived after payout

Not silently applied. It is flagged as an `ADJUSTMENT` attempt for manual
reconciliation, because the money has already left the platform. Settle it with
the organizer out of band.

### Overselling

Should be impossible: a `CheckConstraint` (`sold + reserved <= quantity`) makes
it so at the database level, independent of application logic. If you see it,
that is a genuine bug — capture the tier row and the `ScanLog`/booking rows
before changing anything.

---

## 4. Check-in incidents

**During an event, latency matters and mistakes are visible to a queue of
people.**

| Symptom | Cause | Action |
| --- | --- | --- |
| Every scan `denied_invalid` | `TICKET_QR_SIGNING_KEY` changed | **Do not rotate this key while events are live.** Every issued QR was signed with the old one. Restore the previous value. |
| A valid ticket `denied_already_used` | Genuinely scanned before, or a screenshot | `ScanLog` has the first scan's time and gate. This is the system working. |
| `denied_out_of_window` | Gate opened early or ran late | Widen `CHECKIN_WINDOW_*` and redeploy, or admit manually. |
| `denied_not_active` | The booking was refunded | Refunds void still-active tickets in the same transaction. Correct behaviour. |
| Attendance count looks wrong | The Redis counter drifted | The DB is the source of truth and reconciles on a short TTL. It self-heals; do not "fix" the counter. |

---

## 5. Routine tasks

```bash
# Shell into the running web container.
docker compose -f docker-compose.yml exec web bash

# Django shell against production. Read-only unless you mean otherwise.
docker compose -f docker-compose.yml exec web python manage.py shell

# Run one scheduled job immediately, rather than waiting for the tick.
docker compose -f docker-compose.yml exec web python manage.py run_scheduled_jobs --once

# Create another operator.
docker compose -f docker-compose.yml exec web python manage.py createsuperuser

# Rotate VAPID keys. NOTE: this invalidates every existing push subscription;
# browsers key a subscription to the application server key.
docker compose -f docker-compose.yml exec web python manage.py generate_vapid_keys
```

### Applying a configuration change

```bash
${EDITOR:-vi} .env
docker compose -f docker-compose.yml up -d --force-recreate
```

**`docker compose restart` does not re-read `env_file`.** The container keeps
its old values while `.env` looks correct — which is indistinguishable from the
change not working.

For any `NEXT_PUBLIC_*` change, **rebuild the frontend**. Those are compiled
into the bundle as string literals; no restart can change them.

### Suspending a user

`POST /admin/users/{id}/suspension`. It sets `is_active=False`, which
`AuthService.authenticate` already refuses — an access decision, not a label.

Two refusals, both to stop an operator locking everyone out: no self-suspension
(they would 401 on the next request) and no suspending staff. Suspending twice
is a `409` rather than a silent success, so a double-click cannot write a second
audit row claiming a second suspension.

---

## 6. Scaling

Scale in this order; each step is cheaper than the next.

1. **Cache hit rate.** The public read path (`/events`, `/events/{id}`) is
   0–1 queries warm. If it is not, invalidation is firing too often.
2. **`WEB_CONCURRENCY`.** **Bounded by the connection pooler, not the CPU** —
   each worker holds its own connections, and the scheduler and worker draw
   from the same Supabase client limit. Exhausting it presents as a database
   outage rather than as too many workers. The computed default caps at 9; an
   explicit value is honoured with a warning naming the risk.
3. **A CDN in front of storage** (`S3_PUBLIC_BASE_URL`). Posters are the
   heaviest bytes on the platform and are immutable — the key changes when the
   image does.
4. **A second `web` host.** The app is stateless; sessions are JWTs. Keep
   **exactly one** scheduler across the fleet.
5. **Supabase compute tier**, if reads are genuinely database-bound.

Do not add a second scheduler. Two double-fire every job; the tasks are
idempotent so it is survivable rather than correct.

---

## 7. Escalation

| Vendor | Status page | Blast radius when down |
| --- | --- | --- |
| Supabase | status.supabase.com | Total. `/health/` 503s. Nothing is lost. |
| Upstash | status.upstash.com | Degraded but serving — caching and rate limiting fail **open**. |
| Razorpay | status.razorpay.com | No new bookings complete. Existing tickets are unaffected. |
| Google Maps | status.cloud.google.com | Maps features degrade; the event page falls back to an address and a directions link. |
| Sentry | status.sentry.io | You lose visibility, not service. |

**A vendor outage is not a data emergency.** Every external call is behind a
port with bounded timeouts, every write is transactional, and the money path's
correctness rests on database locks and constraints rather than on any vendor
being reachable.

---

## 8. The invariants worth knowing before you touch anything

If an intervention would break one of these, it is the wrong intervention.

- **The signed webhook is the only proof of payment.** Not the browser redirect.
- **Every reserved ticket ends up either paid or released.** Never stuck.
- **A ticket is never double-issued**; a refund never double-runs. Three
  independent idempotency layers.
- **One scan admits one person**, decided under a per-ticket row lock.
- **Overselling is prevented by a database constraint**, not only by app logic.
- **Payout is recomputed from payment records at release time**, under a lock.
  The running totals are for display.
- **No card data is stored, ever.** Only Razorpay reference ids and amounts.
