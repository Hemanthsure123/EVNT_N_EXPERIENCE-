# PENDING_TASKS.md — everything left to be a real BookMyShow / District

Compiled 2026-08-07 from a read of the actual tree, not from the docs.
Cross-references `frontend/BACKLOG.md` items as **[B-n]**. Items marked **NEW**
are not in that backlog and were found in this pass.

**Where the build actually is:** 18 backend modules, 136 registered endpoints,
59 frontend pages, a real payments/checkin/settlements money path, real Google
OAuth + Maps + Calendar, real Web Push, real S3-shaped storage, a real deploy
gate. The gaps below are almost all *product surface* and *category parity*, not
foundation.

Priority key: **P0** blocks go-live · **P1** blocks "feels like a real product"
· **P2** competitive parity · **P3** nice to have.

---

## THE FIVE PHASES

Seat maps (S-1) are excluded by decision; everything else on this list is
assigned to a phase.

| Phase | Theme                       | Lands                                                                                                                                 | External deps      | Status         |
| ----- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------- |
| **1** | **The site is whole**       | The ten dead footer routes, brand + share assets, four new illustrations, the real bugs in §2                                          | none               | ✅ **DONE**    |
| **2** | **Trustworthy to operate**  | Ticket/booking lookup, deep health probes, the refund-request lifecycle, profile editing + phone                                       | none               | ✅ **DONE** (2 items carried) |
| **3** | **Content & merchandising** | `Event.category`, `policies` JSONB, scheduled publish + CANCELLED, media/FAQ `PATCH` + reorder, renditions, coupons, GST invoices, reviews | Razorpay live keys | —              |
| **4** | **Measurement**             | The telemetry pipeline (§8), then organizer conversion/funnel, admin latency + error rates, performer analytics                        | none               | —              |
| **5** | **Parity & scale**          | `venues` (address/coords/venue pages), showtimes/series, support desk, teams, loyalty, i18n, PWA install                                | Maps billing       | —              |

### Phase 1 — what shipped (2026-08-07)

All ten previously-404ing footer routes now exist, are in the sitemap, and are
covered by a test that fails if a footer link ever outruns a route again.

- **Routes:** `/terms`, `/privacy`, `/refunds`, `/cookies`, `/help`,
  `/contact`, `/about`, `/careers`, `/organizer`, `/pricing`. Each written from
  the actual schema and code paths — the refund policy describes the three
  refunds the system really performs, the cookie notice is an enumerated
  inventory of the real storage keys, and `/pricing` imports
  `PLATFORM_FEE_BPS` rather than restating it.
- **Share and install assets:** dynamic OG cards (site-wide + per event),
  generated app icon and apple-icon from the real `BrandMark` vector, and a PWA
  manifest — the app had been shipping a service worker with no manifest, so it
  had the cost of installability and none of the payoff.
- **Illustrations:** `SpotSupport`, `SpotPolicy`, `SpotListing`, `SpotPayout`,
  all passing the set's existing invariants (per-instance ids, token-only paint,
  reduced-motion, decorative).
- **Bugs fixed:** 2.1 (ten dead links), 2.2 (social links to platform login
  walls — now env-driven and absent when unset), 2.3/2.4 (no icons/manifest),
  2.5 (the duplicated `AGENTS.md`), 2.6 (`/style-guide` was not just routable
  but **in the sitemap**), plus two found on the way: `lib/seo/metadata.ts`
  hard-coded `'Event & Experience Platform'` so **every page title on the site
  named a product that exists nowhere else**, and `playwright.config.ts`
  hard-coded port 3000 so a clash became a five-minute timeout naming neither.
- **Gate:** typecheck, lint, stylelint all clean; **528 unit tests pass** (up
  from 507); production build clean; e2e 88 passed / 3 pre-existing failures
  (two stale assertions on the homepage h1 and the funnel's step heading, one
  1px rounding flake in the island-drag test — all in files this slice does not
  touch).

### Phase 2 — what shipped (2026-08-07)

**Backend — 5 capabilities, 112 new tests, 1829 passing.**

- **`POST /checkin/lookup`** (§3.3.2). `verify_and_mark_used` was the ONLY way
  to read a ticket, and it *marks the ticket used* as its entire purpose — so
  answering "has this person already gone in?" meant **burning their ticket**,
  and they would then be refused at the real door by the agent trying to help.
  Read-only twin: same signature check, same authorization, same reason
  vocabulary, **zero writes** (no `ScanLog` either — a lookup is not a scan and
  would break the count that must reconcile with used tickets). `LookupResult`
  deliberately has no `allowed` field so it cannot be rendered as an admission.
- **`GET /admin/bookings` + detail** (§3.3.3, 6.1.1). One `q` across email,
  booking-id PREFIX, payment reference and event title. Finds the **abandoned
  checkout the payment search structurally cannot** — no `Payment` row exists
  for it. `tickets_issued` is on the row, and the QR token is never sent.
- **The refund-request lifecycle** (§4.2.9, 5.2.8, 6.1.11). `RefundRequest`
  with a partial unique index (one OPEN per booking), decision under a row lock,
  approval enqueuing `execute_refund` **on commit**, and three notification
  types. `approved` never says "refunded" — approval enqueues, money moving is a
  separate fact.
- **Deep health probes** (§3.3.15, 6.2.10). `?deep=1` contacts the payment
  provider and storage and inspects the outbox, cached 60s. `deep` is on the
  wire so the UI can distinguish "we did not check" from "we checked".
- **`PATCH /auth/me` + `phone`** (§3.2.12). `notifications` had been sending SMS
  to a column **nothing could populate** — the delivery half was built and the
  destination unreachable.

**Frontend.**

- **35 `loading.tsx` routes.** The three consoles had **none** — every screen
  went from the previous page to a blank region, on the slowest pages in the
  product. New `components/organizer/skeletons.tsx` with six page shapes.
- **`/admin/bookings`** — the support desk, with a two-state empty (resting vs
  no-results) and a drawer that leads with the verdict.
- **Refund queue**, one component for both the organizer and the console.
- **`SpotLookup` + `SpotRefund`** illustrations (12 total, 77 invariant tests).
- **Health**: deep toggle, and `PROBED` — a hard-coded `['database','cache']` —
  replaced with a status-derived check. It would have captioned payments and
  storage "not contacted" **after contacting them**.
- **Gate:** typecheck, lint, stylelint, prettier clean; **536 unit tests**;
  production build clean (74 pages).

**Carried to Phase 3** (both genuinely belong with content work): the staff
preview of an unapproved event (§3.3.12) and `/dashboard/settings` (§5.1.1).

### Phase 3 — what shipped (2026-08-08)

Content depth and the lifecycle holes. Eight pieces, each with the same test:
does a control on screen correspond to a column the backend maintains?

- **Sessions / showtimes** (`EventSlot`, the S-2 gap). An event that runs more
  than once, the way BMS models a showtime. **The design's load-bearing
  observation is that inventory ALREADY lives per ticket-tier row** — guarded
  by a per-row lock and the `ticket_type_no_oversell` CHECK — so a
  slot-scoped tier is just another row, and per-session inventory falls out of
  the money path with **zero changes to reserve/confirm/release**. The
  check-in window follows the ticket's SESSION rather than the event (the
  21:00 door no longer opens at 17:00), and the gate screen names it, because
  two tiers on one event are usually both called "GA". Buyer-side date/time
  picker, organiser-side editor, 35 backend tests + 17 pure-module ones.
- **Filters on both dashboards** — date ranges everywhere and a substring
  search on the All-events queue (title, venue, city, organiser). Server-side,
  because every list is cursor-paginated: a client-side window means paging the
  whole platform, and is simply wrong wherever a page boundary falls inside the
  range. One date parser in `core/query_params.py`, shared with the organizer
  lists that had them first.
- **Suspension tells the truth.** It used to fail as `invalid_credentials`, so
  a suspended person reset a password that was never wrong, was refused again,
  signed up afresh, was told the address was taken, and went round once more.
  Now named — **after** the password verifies, so the enumeration oracle stays
  shut — with a "contact an administrator" screen. Plus operator **revocation
  of a proven address**, which suspends in the same statement: clearing the
  flag alone would have let them request a fresh code and be back in a minute.
- **`Event.policies`** — the organiser's own rules, a JSON list rather than
  columns (the set is open) and a column rather than a table (written whole,
  read whole; a join would land on the hottest public query). Rendered above
  the platform's standing guarantees, edited in the wizard.
- **`EventStatus.CANCELLED`.** Neither archive (which refuses `live`) nor an
  operator delete: the ordinary, awful case of a live event with real bookings
  that is not happening. Refunds everyone, releases every hold, emails every
  ticket holder — through the **same** `make_good_on_an_event` the operator's
  delete uses, because two implementations of "return everybody's money" is how
  one ends up missing the hold release. The page still RESOLVES and says so:
  hundreds hold a link in an email and a 404 there reads as a lost booking.
- **Ticket tier content** — `description`, `perks` (ticks, not prose) and
  `position` (a festival's weekend pass belongs above the day tickets whatever
  it costs). A ticket here is not exchangeable, so buying the wrong tier is the
  most expensive mistake a buyer can make and the panel had only a name and a
  price to tell two apart.
- **`MediaKind.VIDEO` is reachable** — it was a choice in the API that could
  only ever 422, because the one route to it ran the image validator. It is a
  LINK now: `core/video_embeds.py` normalises a YouTube/Vimeo URL into an
  embed URL **the server builds from an extracted id**, so a crafted query
  string cannot reach an iframe on our own origin. Same posture as the SVG
  exclusion — allow-list plus normalisation, never escaping.
- **Performer scenes.** The nine act tiles were glyphs on squircles — the iOS
  app-icon idiom the category tiles were rebuilt to stop being. Nine composed
  scenes in the same language (`depth.tsx`, one light, filled bodies, contact
  shadows), each reacting INSIDE the drawing on hover. A test asserts no two
  acts share a silhouette, because three of them would each naturally have been
  a microphone.
- **Gate:** backend **2060 tests**, mypy clean on 460 files, ruff clean;
  frontend **625 tests**, typecheck/eslint/stylelint clean, production build
  clean.

**Still carried:** the staff preview of an unapproved event (§3.3.12),
`/dashboard/settings` (§5.1.1), image renditions (2.8), and the two whole
modules — coupons (3.1.3) and reviews (3.1.4).

---

## 0. THE HONEST HEADLINE

Three structural gaps separate this from District/BookMyShow, and everything
else on this list is smaller than them:

| #    | Gap                       | Why it is structural                                                                                                                                                                     |
| ---- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1  | **No seat selection**     | BMS/District are built around a seat map. Here every ticket is general admission (`TicketType` = a price bucket with a counter). No `venues` module, no layout, no seat, no hold-by-seat. |
| S-2  | **One event = one datetime** | BMS is "a title, with many shows, at many venues, on many days". `Event` has a single `starts_at` and no series/recurrence/showtime model, so a 3-day run is 3 unrelated events.        |
| S-3  | **Nothing is measured**   | No page views, no funnel, no referrer, no device, no session. Every analytics surface (consumer recs, organizer conversion, admin telemetry) is capped by this one missing pipeline.     |

---

## 1. P0 — GO-LIVE BLOCKERS (infrastructure & credentials)

Nothing here is code you are missing; it is state only you can set.

| ID  | Task                                                                                                                                                       | Owner |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1.1 | **Run the 11 outstanding migrations against Supabase.** 58 of 69 applied; `accounts.0005_user_avatar_url` and 10 others are not. Until then the demo runs off local Postgres. | you   |
| 1.2 | **Add the tunnel/production redirect URI to the Google OAuth client.** Backend is correct; `redirect_uri_mismatch` is a console setting.                    | you   |
| 1.3 | **Enable billing on the Google Cloud project.** Maps returns `429 maps_quota_exceeded` honestly today — every map, autocomplete and directions call is dead. | you   |
| 1.4 | **Generate `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`** in Supabase → Storage → S3 Connection. Everything else for the `curatix` bucket is pre-filled.      | you   |
| 1.5 | **A stable hostname.** Cloudflare quick tunnels rotate on restart, which re-breaks 1.2 every time. Needs a named tunnel + a domain.                          | you   |
| 1.6 | **Razorpay live keys + webhook secret**, and register the webhook URL. Preflight refuses to boot prod on `PAYMENTS_BACKEND=fake`, correctly.                | you   |
| 1.7 | **Real SMTP + SMS provider** and India DLT template registration per notification type (the per-type map already exists, the ids do not).                    | you   |
| 1.8 | **Delete `ops@eventful.test` / `opsadmin12345`** before production.                                                                                        | code  |
| 1.9 | Commit or discard the in-flight working tree (`seed_demo_data`, both compose files, `admin/moderation.tsx`, `admin/attention.ts`, untracked `lib/admin/query-keys.ts`). | code |

---

## 2. P0/P1 — BUGS AND BROKEN THINGS IN WHAT IS ALREADY BUILT

| ID   | Issue                                                                                                                                                                                                                                     | Fix size |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ~~2.1~~ | ✅ **FIXED (Phase 1).** Ten dead links in the site footer, on every page. All ten routes now exist, are in the sitemap, and `app/static-routes.test.ts` fails if a footer link ever outruns a route again.                              | done     |
| ~~2.2~~ | ✅ **FIXED (Phase 1).** Social links pointed at bare `instagram.com` / `x.com` / `facebook.com` / `youtube.com` — platform login walls, not accounts. Now env-driven (`SOCIAL_HANDLES`); an unset handle renders nothing and an all-unset set removes the row. | done |
| ~~2.3~~ | ✅ **FIXED (Phase 1).** `app/icon.tsx` + `app/apple-icon.tsx` generate from the real `BrandMark` vector; `app/opengraph-image.tsx` and a per-event card give every share a real image.                                                  | done     |
| ~~2.4~~ | ✅ **FIXED (Phase 1).** `app/manifest.ts` added, with shortcuts to My tickets and Browse. The service worker now has the manifest it needed to be installable.                                                                          | done     |
| ~~2.5~~ | ✅ **FIXED (Phase 1).** `AGENTS.md` is a pointer to `CLAUDE.md` plus a where-to-start table.                                                                                                                                            | done     |
| ~~2.6~~ | ✅ **FIXED (Phase 1).** `/style-guide` was not merely routable — it was **in `app/sitemap.ts`**, so the design system was being submitted to Google. Now `noindex` on the page, out of the sitemap, and disallowed in robots.txt.       | done     |
| ~~2.6a~~ | ✅ **FIXED (Phase 1) · was NOT on the original list.** `lib/seo/metadata.ts` hard-coded `SITE_NAME = 'Event & Experience Platform'`, so the `<title>` template on **every page**, the OpenGraph `site_name` on every share and the PWA `applicationName` all named a product that exists nowhere else in the codebase. `lib/brand.ts` was created to prevent exactly this and its own docstring says a rename "always misses one" — this was the one. | done |
| ~~2.6b~~ | ✅ **FIXED (Phase 1) · was NOT on the original list.** `playwright.config.ts` hard-coded port 3000 in three places, so a port clash made Next silently bind 3001 while Playwright waited the full 300s for 3000 — an error naming neither the port nor the conflict. `E2E_PORT` now overrides it and the port is passed explicitly so a clash fails fast. | done |
| 2.7  | **P1 · No `PATCH` on event media / FAQ / timeline rows.** Consequence: no drag-to-reorder anywhere, no alt-text fix without delete-and-re-upload, no in-place FAQ edit. One endpoint shape serves the event studio *and* the performer studio. **[B-14, B-16, B-71, B-72]** | M |
| 2.8  | **P1 · No image renditions.** The API stores exactly the bytes given — no thumbnail, no WebP/AVIF, no `srcset`. `events.process_poster` is registered and does nothing. Posters are the heaviest thing on every page. **[B-14]**            | M        |
| 2.9  | **P1 · `Event.status` is not PATCHable and there is no archive in the wizard's bulk bar.** Archive exists as its own endpoint now; the bulk bar and studio still cannot use it consistently. **[B-34, B-35]**                              | S        |
| 2.10 | **P2 · Client-side sorting/filtering on cursor-paginated lists** (browse price/organiser, organizer events by revenue). Honest labelling is in place, but an organizer with 300 events sorting by revenue sees the top of page one. **[B-3, B-5, B-10, B-26, B-42]** | M |
| 2.11 | **P2 · `MediaKind.VIDEO` exists but `validate_image` is image-only** — a kind that always 422s. **[B-14]**                                                                                                                                | S        |
| 2.12 | **P2 · No `PerformerMedia` cover/portrait kind** — "whichever you uploaded first" is the marketplace card. **[B-70]**                                                                                                                     | S        |

---

## 3. BACKEND — MISSING MODULES AND ENDPOINTS

### 3.1 New Django modules that do not exist at all

| ID    | Module            | What it owns                                                                                                                          | Priority | Size |
| ----- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- |
| 3.1.1 | **`venues`**      | Venue entity, address, coordinates, capacity, **seat maps / sections / rows / seats**, accessibility attributes, venue landing pages. Unblocks S-1, geo ranking [B-9], distance filter [B-12], structured venue in the wizard [B-28]. | **P1** | XL |
| 3.1.2 | **`catalog` / showtimes** | A `Series`/`Show` parent so one title has many datetimes and venues (S-2), plus recurrence and `publish_at` scheduled publishing [B-43]. | **P1** | L |
| 3.1.3 | **`marketing`**   | Coupons, promo codes, offers, bank/card offers, campaigns, referral. `POST /bookings/preview` to validate a code *before* inventory is reserved. **[B-20]** | **P1** | L |
| 3.1.4 | **`reviews`**     | Event reviews + performer reviews, anchored to a completed booking so only attendees can write one. Moderation gate. Denormalised `rating_average`/`rating_count`. **[B-61]** | **P1** | M |
| 3.1.5 | **`support`**     | `SupportTicket` + `SupportMessage`, customer + operator surfaces, inbound email-to-ticket, notification per reply. **[B-49]**           | **P1**   | L    |
| 3.1.6 | **`teams`**       | Organizer sub-users, roles, per-event gate staff. Every module's `permissions.py` already has the seam.                                 | P2       | M    |
| 3.1.7 | **`analytics`**   | The view/telemetry pipeline — see §8. Unblocks S-3 and about fifteen items below.                                                       | **P1**   | L    |
| 3.1.8 | **`loyalty`**     | Wallet, credits, gift cards, referral rewards, points. District's retention engine.                                                     | P2       | L    |
| 3.1.9 | **`disputes`**    | `Chargeback` model + the dispute webhook branch (only `payment.captured` is handled today), `PaymentReview`/hold state. **[B-52, B-53]** | P2       | M    |

### 3.2 Columns and fields missing on existing models

| ID     | Field                                                                                             | Unblocks                                              | Pri |
| ------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --- |
| 3.2.1  | **`Event.category`** (+ tags)                                                                     | Exact browse filters instead of keyword-inferred chips. **[B-2]** | **P1** |
| 3.2.2  | **`Event.policies` JSONB** (refund, age, parking, food, photography, terms, dress code, contact, emergency) | The whole missing Policies wizard step — nine fields for one column. **[B-28]** | **P1** |
| 3.2.3  | **`Event.publish_at`** + scheduled-publish task                                                   | Scheduled publishing. **[B-35, B-43]**                | P1  |
| 3.2.4  | **`EventStatus.CANCELLED`** + a refund sweep                                                      | Cancelling an event with issued tickets. **[B-43]**   | **P1** |
| 3.2.5  | **`Event.featured`** editorial flag                                                               | Home spotlight is "the five soonest" today. **[B-8]** | P2  |
| 3.2.6  | **`Event.revenue_minor`** denormal (maintained like `from_price_minor`)                           | Server-side `sort=revenue`. **[B-26, B-42]**          | P2  |
| 3.2.7  | **`Booking.paid_at` / `cancelled_at`**                                                            | A real lifecycle timeline instead of a derived one. **[B-46]** | P2 |
| 3.2.8  | **`Payment.method`** (Razorpay returns it on the webhook)                                         | Payment-method analytics — one column, one line. **[B-29]** | P2 |
| 3.2.9  | **`TicketType`**: description, perks, visibility, refundable, `position`, `archived`              | Per-tier merchandising; tier ordering; safe retirement. **[B-28]** | P1 |
| 3.2.10 | **`Settlement.releasable_at` on the organizer serializer**                                        | Turns "after the event + refund window" into a date. **[B-31]** | trivial |
| 3.2.11 | **`payment_id` on `OrganizerBookingSerializer`**                                                  | Enables the row-level refund action. **[B-25]**       | trivial |
| 3.2.12 | **`phone` on the user-readable serializers** + `PATCH /auth/me`                                   | SMS delivery target, name typo fix before ticket issue. **[B-18]** | P1 |
| 3.2.13 | **`organization: {verified, logo_url, events_count}` on `GET /events/{id}`**                       | The trust badge the event page cannot draw. **[B-15]** | P1 |
| 3.2.14 | **`created_at` and `ends_at` on the event card payload**                                          | "New" badge, duration filter. **[B-12]**              | P2  |
| 3.2.15 | **`read_at` on `NotificationLog`**                                                                | Any notification centre at all. **[B-38]**            | P1  |
| 3.2.16 | **`OutboxEvent.owner_id`** (or an `OrganizerActivity` table)                                      | Owner-scoped activity beyond the five merged sources. **[B-37]** | P2 |
| 3.2.17 | **Schedule**: timezone, separate doors-open time, recurrence                                       | **[B-28]**                                            | P2  |

### 3.3 Missing endpoints on modules that exist

| ID     | Endpoint                                                                                    | Pri | Notes                                                       |
| ------ | --------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------- |
| 3.3.1  | `GET /events/suggest?q=` — prefix autocomplete                                              | P1  | Today derived from a full `GET /events` call. **[B-1]**     |
| 3.3.2  | `POST /checkin/lookup` — read-only ticket resolution                                        | **P1** | Today the only reader (`/checkin/verify`) **marks it used**. Support cannot look a ticket up without admitting someone. **[B-44, B-56]** |
| 3.3.3  | `GET /admin/bookings?q=` (email / booking id / payment ref)                                 | **P1** | "I paid but have no ticket" is the #1 support call and is answerable only from Django admin today. **[B-21, B-56]** |
| 3.3.4  | `POST /events/{id}/duplicate` (one `UnitOfWork`)                                            | P1  | Client-side duplication leaves half-built events. **[B-40]** |
| 3.3.5  | `GET /organizer/bookings.csv` streamed export                                                | P1  | Browser-side CSV silently truncates to loaded pages. **[B-27]** |
| 3.3.6  | `POST /auth/otp/request` + `/verify` — the phone challenge store                             | P1  | UI is built and fails honestly today. SMS delivery exists. **[B-19]** |
| 3.3.7  | `min_price` / `max_price` / `organizer_id` / `sort` on `GET /events`                        | P1  | **[B-3, B-5, B-10]**                                        |
| 3.3.8  | `starts_after` / `starts_before` on `/organizer/event-rows`                                 | P1  | Gives "Today" and date views immediately. **[B-33]**        |
| 3.3.9  | `meta.count` (estimate, not `COUNT(*)`) on `GET /events`                                    | P2  | Every browse number is a floor today. **[B-11]**            |
| 3.3.10 | `GET /events/cities` aggregate                                                               | P2  | Ten hard-coded cities today. **[B-4]**                      |
| 3.3.11 | `GET /events/sitemap`                                                                        | P2  | Event pages are absent from `sitemap.ts` — the pages carrying JSON-LD. **[B-7]** |
| 3.3.12 | Staff preview of a non-live event (`?preview=<token>`, `private, no-store`)                  | P1  | Moderators cannot see the page they are approving. **[B-51]** |
| 3.3.13 | Draft-render mode for the CMS studio preview                                                 | P2  | **[B-57]**                                                  |
| 3.3.14 | `PATCH /admin/<resource>/bulk` inside one `UnitOfWork`                                       | P2  | Every write endpoint is single-resource. **[B-60]**         |
| 3.3.15 | Deep health probes (`?deep=1`, cached 60s)                                                   | P1  | Six of eight tiles are permanently grey. **[B-22]**         |
| 3.3.16 | `POST /subscriptions` — email reminders                                                      | P2  | Push exists; email does not. **[B-13]**                     |
| 3.3.17 | Resend ticket · download invoice · organizer-side cancel                                     | **P1** | Three of four bookings-table row actions. **[B-25]**     |
| 3.3.18 | `POST /events/{id}/view` + `EventViewDaily`                                                  | **P1** | See §8. **[B-39]**                                        |

---

## 4. CONSUMER FRONTEND — parity with District / BookMyShow

### 4.1 Pages that must exist — ✅ **ALL DONE (Phase 1)**

| ID    | Page                                     | Status                                                                                        |
| ----- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 4.1.1 | `/about`                                 | ✅ Four promises, each traceable to a real mechanism. No invented team, stats or founding date. |
| 4.1.2 | `/contact`                               | ✅ Five channels, env-driven. **No contact form** — there is no `SupportTicket` model, and a form that drops the message is the worst thing here to fake. |
| 4.1.3 | `/terms`                                 | ✅ Nine sections, written from `booking`/`payments`/`checkin`/`events`. Needs a lawyer's review. |
| 4.1.4 | `/privacy`                               | ✅ Written from the schema. The "what we do NOT collect" section is the useful half. Honest that data export / account deletion are email-only today. |
| 4.1.5 | `/refunds`                               | ✅ Describes the three refunds the system really performs, including the automatic one. Honest that there is no self-service request flow. |
| 4.1.6 | `/cookies`                               | ✅ An enumerated table of the eleven real storage keys, grepped from source. States there are no tracking cookies at all. |
| 4.1.7 | `/help`                                  | ✅ Six topics, ~25 answers, all facts about the backend. `FAQPage` JSON-LD. Native `<details>`, so find-in-page opens a closed answer. |
| 4.1.8 | `/organizer`                             | ✅ The supply front door. Argues from real engineering properties (money held by the provider, oversell impossible at the DB, auto-refund) and **names the gaps** (no seating, no promo codes, no team accounts). |
| 4.1.9 | `/pricing`                               | ✅ Imports `PLATFORM_FEE_BPS` rather than restating it, with computed worked example and the payout timeline. Names Razorpay's separate charges. |
| 4.1.10| `/careers`                               | ✅ Honest empty state using the set's own `SceneNothingYet`, plus what working here is actually like. No invented roles, no form to nowhere. |

### 4.2 Booking & ticket experience

| ID     | Task                                                                                                            | Pri |
| ------ | ----------------------------------------------------------------------------------------------------------------- | --- |
| 4.2.1  | **Seat selection UI** — interactive map, zoom/pan, section pricing, per-seat hold. Depends on 3.1.1. (S-1)      | P1  |
| 4.2.2  | **Coupon / promo input** in the funnel, against `POST /bookings/preview`. Depends on 3.1.3. **[B-20]**           | P1  |
| 4.2.3  | **Invoice / GST receipt download** — a PDF per booking. Indian buyers expect it; businesses require it.          | P1  |
| 4.2.4  | **Ticket transfer / send to a friend** — the single most-used BMS social feature.                                | P2  |
| 4.2.5  | **Waitlist / "notify me" on sold out** — today a sold-out event is a dead end. Push already exists as the channel. | P1 |
| 4.2.6  | **Add-ons** (merch, parking, F&B) at checkout — District's margin engine.                                        | P3  |
| 4.2.7  | **Group / bulk booking** request flow.                                                                          | P3  |
| 4.2.8  | **Booking cancellation UX** — `POST /bookings/{id}/cancel` exists; there is no customer-facing control for it.   | P1  |
| 4.2.9  | **Customer refund request flow** — `RefundRequest` model + attendee surface. Today refunds are organizer-initiated only. **[B-36]** | **P1** |
| 4.2.10 | **Apple/Google Wallet pass** for the ticket.                                                                    | P3  |
| 4.2.11 | **Guest checkout** — currently impossible (`Booking.user` is not nullable). A real conversion decision, not an oversight. | P2 |

### 4.3 Discovery & content

| ID    | Task                                                                                                     | Pri |
| ----- | ---------------------------------------------------------------------------------------------------------- | --- |
| 4.3.1 | **Venue pages** (`/venues/[slug]`) — "what's on at Phoenix Marketcity". Depends on 3.1.1.                | P1  |
| 4.3.2 | **Artist / performer pages linked to events.** `performers` exists as a *marketplace*; no event lists an artist. | P1 |
| 4.3.3 | **Personalised recommendations** — "because you booked X". Depends on 3.1.7.                            | P2  |
| 4.3.4 | **Editorial collections / curated lists** — the CMS has `CollectionKey`; `trending` computes nothing. **[B-58]** | P2 |
| 4.3.5 | **Real category taxonomy on the browse page** once 3.2.1 lands.                                          | P1  |
| 4.3.6 | **Rating / "interested" / "trending" badges** — deliberately absent; unlocked by 3.1.4 and 3.1.7. **[B-12]** | P2 |
| 4.3.7 | **Share sheet + referral link** with per-user attribution.                                              | P2  |
| 4.3.8 | **Recently viewed** rail (needs client storage only — cheap).                                            | P3  |
| 4.3.9 | **Banners / scheduled promo strips** as CMS content. **[B-58]**                                          | P2  |
| 4.3.10| **`City` model** with slug, hero image, display order — the served-cities list is a frontend constant. **[B-58]** | P2 |

### 4.4 Account

| ID    | Task                                                                                | Pri |
| ----- | ------------------------------------------------------------------------------------- | --- |
| 4.4.1 | **Notification preferences / opt-out** — the channel abstraction is the seam.       | P1  |
| 4.4.2 | **Wallet, credits, gift cards.** Depends on 3.1.8.                                  | P2  |
| 4.4.3 | **Order history with invoices** (distinct from `/account/tickets`).                 | P1  |
| 4.4.4 | **Address book** (for merch/delivery add-ons).                                      | P3  |
| 4.4.5 | **Account deletion / data export** — DPDP Act obligation.                           | P1  |

---

## 5. EVENT ORGANIZER SIDE

### 5.1 Sections with a backend, not yet built

| ID    | Section                                                                      | Pri |
| ----- | ------------------------------------------------------------------------------ | --- |
| 5.1.1 | **`/dashboard/settings`** — org name, logo, verification, payout account all have endpoints; no page. **[B-34]** | P1 |
| 5.1.2 | **Bulk bar completion** on the events table (publish + archive are real, delete is not and should not be). **[B-34, B-41]** | P1 |
| 5.1.3 | **Refund action wired** on the bookings table once 3.2.11 lands. **[B-25]**  | P1  |

### 5.2 Sections with no backend at all

| ID    | Section                | Depends on | Pri |
| ----- | ------------------------ | ------------ | --- |
| 5.2.1 | Coupons & promotions   | 3.1.3      | P1  |
| 5.2.2 | Team members / roles   | 3.1.6      | P2  |
| 5.2.3 | Messages to attendees  | 3.1.5      | P2  |
| 5.2.4 | Reviews & replies      | 3.1.4      | P1  |
| 5.2.5 | Notification centre    | 3.2.15     | P1  |
| 5.2.6 | Support                | 3.1.5      | P1  |
| 5.2.7 | Customer tags & notes  | `CustomerTag` / `CustomerNote`, org-scoped. **[B-47, B-30]** | P1 |
| 5.2.8 | Refund request queue (Pending/Approved/Rejected) | 4.2.9 | **P1** |
| 5.2.9 | Payout statement download + exact release date | 3.2.10. **[B-31]** | P1 |

### 5.3 Organizer analytics — what is missing

Built and real: revenue/bookings/tickets trends, revenue by event, revenue by
city, bookings by status, repeat-customer rate, per-event conversion,
abandonment, sell-through, attendance.

| ID    | Metric                                       | Blocked by | Pri |
| ----- | ---------------------------------------------- | ------------ | --- |
| 5.3.1 | **Page views + view→booking conversion**     | 3.1.7 / 3.3.18. **[B-39]** | **P1** |
| 5.3.2 | **Traffic source / referrer**                | 3.1.7. **[B-48]** | P1 |
| 5.3.3 | **Device & browser breakdown**               | 3.1.7. **[B-48]** | P2 |
| 5.3.4 | **Checkout funnel** (view → select → sign-in → pay → confirm), with drop-off per step | 3.1.7 | **P1** |
| 5.3.5 | **Payment-method split**                     | 3.2.8. **[B-29]** | P2 |
| 5.3.6 | **Sales velocity / pace-to-sellout forecast** | existing data — pure compute | P1 |
| 5.3.7 | **Cohort & repeat-purchase curves**          | existing data | P2 |
| 5.3.8 | **Real-time on-sale dashboard** (live sales ticker during a drop) | existing data + polling | P2 |
| 5.3.9 | **Comparison vs the organizer's own past events** | existing data | P1 |
| 5.3.10| **Geographic heat map of buyers**            | `Event.city` today; real coords with 3.1.1 | P2 |
| 5.3.11| **Exportable / scheduled email reports**     | 3.3.5 + notifications | P2 |

### 5.4 Organizer UI/UX

| ID    | Task                                                                                  | Pri |
| ----- | --------------------------------------------------------------------------------------- | --- |
| 5.4.1 | **Server-side sort on every table** — remove the "sorted within N rows loaded" caveat. **[B-42]** | P1 |
| 5.4.2 | **Saved views persisted server-side and shareable** (localStorage today). **[B-59]**  | P2  |
| 5.4.3 | **"Needs attention" / "Low inventory" / "Today" filters** on the events list. **[B-33]** | P1 |
| 5.4.4 | **Camera QR decode fallback** for Safari/Firefox (dynamic ~40KB decoder). **[B-32, B-45]** | P1 |
| 5.4.5 | **Offline-first check-in** — queue exists; needs a real sync indicator and conflict report. | P1 |
| 5.4.6 | **Mobile check-in layout** — gate staff work one-handed on a phone.                    | **P1** |
| 5.4.7 | **Version history / rollback** on events (`EventRevision`). **[B-35]**                 | P2  |
| 5.4.8 | **Onboarding / empty-state tour** for a brand-new organizer with zero events.          | P1  |

---

## 6. ADMIN / OPERATOR SIDE

### 6.1 Missing surfaces

| ID    | Surface                                        | Depends on | Pri |
| ----- | ------------------------------------------------ | ------------ | --- |
| 6.1.1 | **Booking & ticket lookup** (the support desk's core tool) | 3.3.3 + 3.3.2 | **P0** |
| 6.1.2 | **Support desk**                               | 3.1.5. **[B-49]** | P1 |
| 6.1.3 | **Chargebacks / disputes**                     | 3.1.9. **[B-52]** | P1 |
| 6.1.4 | **Manual payment review / fraud hold**         | 3.1.9 + a hold *rule*. **[B-53]** | P2 |
| 6.1.5 | **Organizer applications + document upload** (`VerificationDocument`, PDF-capable) | **[B-54]** | P1 |
| 6.1.6 | **Warnings / strikes on organizers**           | new model. **[B-54]** | P2 |
| 6.1.7 | **Incidents + deployment log**                 | **[B-55]** | P2 |
| 6.1.8 | **Per-act performer suspension** (operator-imposed, distinct from owner `paused`) | **[B-65]** | P2 |
| 6.1.9 | **Reported performers / reported events queue** | **[B-64]** | P1 |
| 6.1.10| **Coupon & campaign administration**           | 3.1.3 | P1 |
| 6.1.11| **Refund-request adjudication** (platform-level override) | 4.2.9 | P1 |
| 6.1.12| **Preview an unapproved event as an attendee** | 3.3.12. **[B-51]** | **P1** |

### 6.2 Admin analytics & telemetry

| ID    | Metric                                                          | Blocked by | Pri |
| ----- | ----------------------------------------------------------------- | ------------ | --- |
| 6.2.1 | **Latency / p95 response time per route**                       | production-safe timing middleware (the existing one is `DEBUG`-gated). **[B-50]** | **P1** |
| 6.2.2 | **Error rate** — errors are logged, never counted              | `MetricSample` or an external TSDB. **[B-50]** | **P1** |
| 6.2.3 | **Health history** — every probe answers only for "right now"   | persistence. **[B-50]** | P1 |
| 6.2.4 | **Background job depth / dead-letter queue view**               | `QUEUE_BACKEND=local` makes it structurally zero. **[B-50]** | P1 |
| 6.2.5 | **GMV / take-rate / net-revenue dashboard** with period compare | existing data | P1 |
| 6.2.6 | **Cohort retention, LTV, funnel** platform-wide                 | 3.1.7 | P2 |
| 6.2.7 | **Payout liability & float** — money owed but not yet released  | existing data | P1 |
| 6.2.8 | **Refund-rate and chargeback-rate alerting** (a threshold that pages) | 3.1.9 | P1 |
| 6.2.9 | **Anomaly alerts** — sudden refund spike, failed-payout burst   | 6.2.2 | P2  |
| 6.2.10| **Deep vendor probes** so tiles can be green truthfully         | 3.3.15. **[B-22]** | P1 |

### 6.3 Admin UI/UX

| ID    | Task                                                                | Pri |
| ----- | --------------------------------------------------------------------- | --- |
| 6.3.1 | **Bulk editing across resources** in one transaction. **[B-60]**    | P2  |
| 6.3.2 | **Shared saved views** (localStorage today). **[B-59]**             | P2  |
| 6.3.3 | **Audit trail UI** covering *operator* actions, not just the outbox. | P1  |
| 6.3.4 | **Role-based admin** (super-admin vs support vs finance) — `is_staff` is one bit today. | P1 |
| 6.3.5 | **Impersonate-as-user** (audited) for support.                      | P2  |

---

## 7. PERFORMER STUDIO / HIRE-A-BAND

All from **[B-61 … B-77]**; the studio itself is built.

| ID   | Task                                                              | Pri |
| ---- | ------------------------------------------------------------------- | --- |
| 7.1  | Reviews & ratings anchored to a completed `BookingRequest` **[B-61]** | P1 |
| 7.2  | Photo reorder + edit alt/caption (`PATCH`) **[B-71, B-72]**       | P1  |
| 7.3  | Cover vs card photo as distinct kinds **[B-70]**                  | P1  |
| 7.4  | Quote revisions + line items + counter-offer **[B-73]**           | P1  |
| 7.5  | `PerformerBlackout` availability + `available_on=` filter **[B-63, B-74]** | P1 |
| 7.6  | Dismiss a lead + `respond_by` deadline **[B-76]**                 | P1  |
| 7.7  | Performer FAQ, contact preferences, tiered rate card **[B-77]**   | P2  |
| 7.8  | Messaging thread between customer and performer **[B-67]**        | P1  |
| 7.9  | Profile views / impressions / conversion **[B-75]** — needs 3.1.7 | P2  |
| 7.10 | Video via a provider (Mux/Cloudflare Stream), not raw upload **[B-62]** | P2 |
| 7.11 | Payment through the platform — deposit/balance escrow **[B-66]**  | P3  |
| 7.12 | Geocoded travel-radius matching (needs 3.1.1) **[B-63]**          | P2  |
| 7.13 | Performer report flow **[B-64]**                                  | P1  |
| 7.14 | Relevance ranking on performer search **[B-68]**                  | P3  |

---

## 8. THE TELEMETRY PIPELINE (S-3) — one project, ~15 items depend on it

Nothing on this platform records a page view, a referrer, a user agent or a
session. That single absence caps consumer recommendations, organizer
conversion, performer analytics and admin telemetry all at once. Build it once.

| ID  | Piece                                                                                             |
| --- | --------------------------------------------------------------------------------------------------- |
| 8.1 | A first-party collector: `POST /events/{id}/view` behind a session guard, fire-and-forget.        |
| 8.2 | A session cookie + anonymous id that survives sign-in and stitches to a user.                     |
| 8.3 | Daily rollups: `EventViewDaily`, `PerformerDailyStat`, `FunnelStepDaily`.                         |
| 8.4 | Referrer + UTM capture on landing, attributed through to the booking.                             |
| 8.5 | Device/UA parsing at collect time, never stored raw.                                              |
| 8.6 | A production-safe timing middleware writing `MetricSample(name, value, at)` — feeds 6.2.1–6.2.4.  |
| 8.7 | Consent gating — `lib/consent` exists on the frontend and must govern this.                       |
| 8.8 | Edge-cache awareness: `GET /events/{id}` is `s-maxage=60`, so a server-side counter misses most traffic. The beacon is the design, not a shortcut. |

---

## 9. DESIGN · UI/UX · ILLUSTRATIONS · CONTENT

**What already exists:** a token-driven design system with lint enforcement, 8
clay category icons, 6 full scenes (`NoResults`, `NotFound`, `Error`, `Offline`,
`NothingYet`, `AllClear`), 5 spot illustrations, a living style guide, dark mode,
route transitions, reduced-motion handling.

| ID    | Task                                                                                                        | Pri |
| ----- | ------------------------------------------------------------------------------------------------------------- | --- |
| ~~9.1~~ | ✅ **DONE (Phase 1).** Dynamic OG cards site-wide and per event, generated app + apple icons, PWA manifest. Two Satori traps documented in code: the Node build of `@vercel/og` throws `Invalid URL` on Windows (fixed with `runtime = 'edge'`), and its **gradient** parser rejects the modern `rgb(r g b / a)` slash-alpha form while a flat `background` accepts it — so the icons rendered while the OG card 500'd for every crawler. | done |
| 9.2   | **NEW · City hero art** for the ten (then N) city landing pages — currently type-only.                     | P1  |
| 9.3   | **NEW · Category hero art** — the clay icons are card-scale, not banner-scale.                             | P1  |
| 9.4   | **NEW · Empty-state audit across admin / organizer / studio.** The scenes exist for the site; verify every table, queue and chart in the three consoles has one rather than a bare "No rows". | P1 |
| 9.5   | **NEW · Skeleton/loading coverage audit.** `loading.tsx` exists for 6 site routes; the admin, organizer and studio route groups have none. | P1 |
| 9.6   | **NEW · An illustrated onboarding/first-run** for each of the three personas (buyer, organizer, performer). | P1  |
| 9.7   | **NEW · Seat-map visual language** — once 3.1.1 exists this is a design system of its own (availability, selection, price tiers, accessibility seats). | P1 |
| 9.8   | **NEW · Ticket design** — the QR screen is functional; a real ticket is a branded, screenshot-worthy artefact (and the Wallet pass in 4.2.10). | P1 |
| 9.9   | **NEW · Email template design.** `notifications` renders text/HTML from pure functions; there is no designed, brand-consistent email. The ticket email is the single most-seen surface after the funnel. | **P1** |
| 9.10  | **NEW · Push notification copy + iconography.**                                                            | P2  |
| 9.11  | **NEW · Motion/celebration on confirmation** — the ticket-issued moment is the emotional peak and is currently a card.                | P2 |
| 9.12  | **NEW · Error-message copy audit** — the platform is scrupulously honest about missing features; make sure the *tone* is warm rather than technical. | P2 |
| 9.13  | **NEW · Print stylesheet** for tickets and invoices.                                                       | P2  |
| 9.14  | **NEW · Density mode** for the operator console (support staff live in tables all day).                    | P3  |

---

## 10. LEGAL · TRUST · COMPLIANCE (India)

| ID    | Task                                                                              | Pri |
| ----- | ----------------------------------------------------------------------------------- | --- |
| 10.1  | Terms of Service, Privacy Policy, Refund/Cancellation Policy, Contact — see §4.1. **Payment-gateway activation depends on these.** | **P0** |
| 10.2  | **GST**: GSTIN on the organization, tax breakdown on the booking, a compliant tax invoice. Currently no tax field exists at all. **[B-20]** | **P0** |
| 10.3  | **DPDP Act**: consent record, data export, account deletion, retention policy.    | P1  |
| 10.4  | **Cookie consent banner** wired to the telemetry in §8.                           | P1  |
| 10.5  | **India DLT** SMS template registration per notification type (the code maps them; the ids are unset). | **P0** |
| 10.6  | **Accessibility conformance pass** (WCAG 2.1 AA) — axe runs in E2E; a full audit of the three consoles has not been done. | P1 |
| 10.7  | **PCI posture statement** — no card data is stored, which is the right answer; say so publicly.  | P2 |
| 10.8  | **Age verification** for 18+ events — `age_restriction` is a display string only.  | P2  |
| 10.9  | **Organizer agreement + payout KYC record** beyond the opaque `payout_account_id`. **[B-54]** | P1 |

---

## 11. PLATFORM QUALITY & OPS

| ID    | Task                                                                                              | Pri |
| ----- | --------------------------------------------------------------------------------------------------- | --- |
| 11.1  | **Error tracking (Sentry or equivalent)** on both halves. Errors are logged to stdout today.      | **P0** |
| 11.2  | **Uptime monitoring + on-call alerting.** `/health` exists; nothing polls it.                     | **P0** |
| 11.3  | **Structured request logging** with a correlation id spanning frontend → backend → task.          | P1  |
| 11.4  | **Backups + a tested restore.** A ticketing platform's DB is its money.                           | **P0** |
| 11.5  | **Load test the on-sale path** — the row-lock design is proven by unit-level concurrency tests, never under real load. | **P1** |
| 11.6  | **CDN in front of the media host** and `NEXT_PUBLIC_MEDIA_BASE_URL` alignment.                    | P1  |
| 11.7  | **Rate-limit tuning** under real traffic (they fail open by design — verify that is still right at scale). | P1 |
| 11.8  | **`QUEUE_BACKEND=cloud_tasks` end-to-end** — the receiver exists, the deployment does not.        | P1  |
| 11.9  | **Staging environment** distinct from the tunnel demo.                                            | P1  |
| 11.10 | **i18n scaffolding** — Hindi + regional languages. BMS/District ship this; there is no framework here at all. | P2 |
| 11.11 | **Native mobile apps or a full PWA install path.** ~70% of Indian ticketing volume is app-based.  | P2  |
| 11.12 | **Visual regression testing** (Storybook is built; nothing snapshots it).                         | P2  |
| 11.13 | **Frontend perf budget in CI** — LCP/INP/CLS enforced, not just measured.                         | P1  |
| 11.14 | **Lighthouse/SEO audit** of the public routes; JSON-LD is there, the sitemap is not complete (3.3.11). | P1 |

---

## 12. SUGGESTED ORDER

**Phase 0 — make it launchable (days).** §1 credentials · 2.1 the ten footer
pages · 10.1 legal copy · 10.5 DLT ids · 11.1/11.2/11.4 error tracking, uptime,
backups · 2.5 the AGENTS.md duplicate.

**Phase 1 — make it trustworthy to operate (2–3 weeks).** 3.3.2 + 3.3.3 booking
and ticket lookup · 6.1.12 moderator preview · 3.3.15 deep health · 6.2.1/6.2.2
latency and errors · 4.2.9 + 5.2.8 refund requests · 3.2.10–3.2.13 the one-line
serializer fields · 5.1.1 organizer settings.

**Phase 2 — make it feel like a product (4–6 weeks).** §8 the telemetry pipeline
(unblocks ~15 items) · 3.2.1 `Event.category` · 3.2.2 `policies` JSONB · 2.7 the
media/FAQ `PATCH` · 2.8 renditions · 3.1.3 coupons · 3.1.4 reviews · 4.2.3
invoices · 9.1/9.9 share cards and email design.

**Phase 3 — category parity (a quarter).** 3.1.1 `venues` + seat maps (S-1) ·
3.1.2 showtimes/series (S-2) · 3.1.5 support desk · 4.3.1/4.3.2 venue and artist
pages · 11.10 i18n · 11.11 the app story.

**Phase 4 — retention & scale.** 3.1.6 teams · 3.1.8 loyalty/wallet · 3.1.9
disputes · 4.2.4 ticket transfer · 4.3.3 recommendations · 7.11 marketplace
payments.

---

### The discipline to keep

Everything absent above is absent *on purpose* and says so at its own call
site — no invented rating, no fake count, no control that discards what was
typed. When any item here is built, the rule holds: **ship the column before the
control, and the endpoint before the badge.**
