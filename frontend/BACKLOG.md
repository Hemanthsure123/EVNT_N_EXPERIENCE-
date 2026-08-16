# Frontend → backend backlog

Things the discovery layer wants that the backend doesn't expose yet. Each one
is **already built against a seam** in the frontend, so adopting it is a change
to one module, not a redesign — the item says exactly which file changes.

Nothing here is blocking: every entry has a working interim behaviour, and the
interim is documented at the call site as well as here.

---

### 1. A suggest/autocomplete endpoint — `GET /events/suggest?q=`

**Interim:** `lib/search/suggestions.ts` derives grouped suggestions from one
`GET /events?q=&page_size=12` call — matching events directly, then the distinct
venues / organizers / cities those matches sit in. Real data, one index-backed
request, already cached by the backend.

**Why a real one is better:** prefix matching (today's full-text search needs a
whole word — "mum" doesn't match "Mumbai" via `q`, only via our client-side city
list), and an `artist` facet, which cannot be derived at all (see item 2).

**Seam:** `lib/search/types.ts` defines `SuggestionsProvider`. Swap the one
implementation; no UI component changes.

---

### 2. `Event.category` (and an artist/performer entity)

**Interim:** eight categories are expressed as a single stemmed search term
pushed through the existing full-text index (`concert`, `comedy`, `workshop`, …)
— see `lib/discovery/categories.ts`. A card's category chip is _inferred_ from
its title/venue by keyword, and renders nothing when nothing matches, because a
wrong chip is worse than no chip.

**Why a real one is better:** category filtering is currently only as good as
the organizer's copy. A `category` column would make it exact, indexable, and
combinable with `q` without competing for the same tsquery.

The `artist` suggestion group is declared in the vocabulary and deliberately
never produced — the backend has no performer entity, and chopping names out of
event titles would put wrong names in front of users.

**Seam:** `categoryBySlug()` / `inferCategory()` in `lib/discovery/categories.ts`,
and the `q` composition in `toServerQuery()`.

---

### 3. Price filtering — `min_price` / `max_price` on `GET /events`

**Interim:** the "Free" and "Under ₹500" chips are applied **client-side** to the
pages already loaded, over `from_price`. The results view keeps pulling pages
(bounded) until it has enough matches, and the UI says so rather than pretending
the filter is server-side.

**Why a real one is better:** correctness at scale. Client-side refinement can
only ever filter what's been fetched.

**Seam:** `clientRefinement()` in `lib/discovery/filters.ts` — move the predicate
into `toServerQuery()` and delete it. No component changes.

---

### 4. A cities aggregate — `GET /events/cities`

**Interim:** `lib/discovery/cities.ts` is a curated list of ten cities with
coordinates. The coordinates also let a browser geolocation fix be resolved to a
city **without any third-party reverse-geocoding service** — the user's
coordinates never leave the device, and only the city name is stored.

**Why a real one is better:** the list should be the cities that actually have
live events, with counts, not an editorial guess.

**Seam:** `POPULAR_CITIES` in `lib/discovery/cities.ts`. Keep the coordinates —
they're what makes "near you" work offline.

---

### 5. A `sort` parameter on `GET /events`

**Interim:** "Soonest first" is the backend's (only, index-pinned) ordering.
"Price: low to high / high to low" are applied client-side over loaded pages,
same mechanism and same caveat as item 3.

**Note:** the backend's ordering is pinned to `starts_at` on purpose — it's what
keeps the list an index range scan and cursor-paginatable. A `sort=price` mode
needs its own index; `sort=relevance` (SearchRank) is already noted as deferred
in the root `CLAUDE.md`.

**Seam:** `clientRefinement()` in `lib/discovery/filters.ts`.

---

### 6. Popular searches — `GET /search/popular`

**Interim:** `lib/search/popular-searches.ts` is an editorial seed, chosen so
every entry returns real results rather than a plausible-looking dead end.

**Why a real one is better:** nothing on the platform aggregates query volume
today, so "popular" is currently an assertion.

**Seam:** `POPULAR_SEARCHES` — the overlay reads only `label` and `href`.

---

### 7. A sitemap feed — `GET /events/sitemap` — DONE

Built as specified: `id`, `slug` and `updated_at`, unpaginated, public and
edge-cached for an hour (crawler traffic, never a visitor's). The visibility
filter is the SAME predicate the public browse list uses
(`EventRepository._publicly_visible`) rather than a restatement of it — a
sitemap that drifts from the read path advertises pages that 404.

Two deliberate differences from the browse endpoint:

- **Past events are included.** Their pages still resolve, still carry `Event`
  JSON-LD, and are what somebody searching for last month's show should land on.
- **`updated_at` is real.** `app/sitemap.ts` used to stamp `new Date()` on every
  entry, which tells a crawler the whole site changed at once and therefore
  nothing in particular is worth re-fetching.

`GET /performers/sitemap` was added alongside it, for the same reason and in the
same shape. It returns an empty list while nothing is published, which is the
honest answer — the sitemap then carries no performer URLs rather than inventing
any.

**Still open:** a sitemap INDEX. Both endpoints cap at 45,000 rows
(`SITEMAP_MAX_URLS`) because the protocol limits one file to 50,000 URLs / 50MB.
Past that the document has to be split across several files with an index at the
top. Not built before there are 45,000 live events to need it.

---

### 8. An editorial "featured" flag on `Event`

**Interim:** the home spotlight carousel shows the five soonest upcoming events.

**Why a real one is better:** "featured" is a merchandising decision (a promoted
event, a partner, a sold-out-fast headliner), not "whatever is next".

**Seam:** `SpotlightSection` in `components/discovery/home-sections.tsx`.

---

### 9. Geo-aware ranking

**Interim:** "Trending near you" filters by exact city name, matching the
backend's `city` filter. The home page ships the national list in its ISR'd HTML
and swaps to the city-filtered list on the client, so personalisation costs
nothing in edge cacheability.

**Why a real one is better:** "near" is currently "in the same city string" —
someone in Thane isn't served Mumbai events, and there's no distance ordering.
That needs coordinates on `Event`/venue, which is also what a `venues` module
would want.

**Seam:** `components/discovery/trending-near-you.tsx`.

---

### 10. Organiser filtering — `organizer_id` on `GET /events`

**Interim:** the filter panel's Organiser section is a **facet built from the
loaded pages** (`organiserFacets` in `lib/discovery/facets.ts`), so every option
shown is guaranteed to match something the user can already see. Selecting one
refines client-side, exactly like the price band.

**Why a real one is better:** the facet can only ever offer organisers present in
the pages fetched so far, so a long tail is invisible and the counts are floors.

**Seam:** `clientRefinement()` in `lib/discovery/filters.ts` — the same one item
3 uses.

---

### 11. A cheap result count — `meta.count` on `GET /events`

**Interim:** every number on the browse page is a **floor**, rendered as such
("24+ events", "12+ today"). `resultStats` counts what's loaded and appends `+`
whenever another page exists.

**Why a real one is better:** "230 concerts in Mumbai" is a materially stronger
headline than "20+ events", and the banner is built to show it — `countLabel`
drops the `+` the moment the list is exhausted, so a real total would just flow
through.

**Why it's not free:** the backend uses cursor pagination specifically to avoid a
`COUNT(*)` per browse request (CLAUDE.md, performance checklist item 7). This
wants an estimate (`reltuples`-style, or a cached per-filter count), not an exact
count on the hot path.

**Seam:** `resultStats()` / `countLabel()` in `lib/discovery/facets.ts`.

---

### 12. The fields five requested filters would need

The redesign brief asked for Distance, Language, Rating, Accessibility and
Duration filters. **None of them are built**, because the platform records none
of them, and a filter that silently matches everything is worse than an absent
one — it's only discovered after being trusted.

| Filter        | What it needs                                                   |
| ------------- | --------------------------------------------------------------- |
| Distance      | Coordinates on `Event`/venue (also wanted by item 9)            |
| Language      | A `language` column, or a venue/event attribute set             |
| Rating        | A review system — no model, no endpoint, nothing to average     |
| Accessibility | Structured venue attributes (step-free, captioned, …)           |
| Duration      | `ends_at` on the card payload (it exists on `EventDetail` only) |

The same applies to the card badges the brief listed: **Trending** (nothing
measures view velocity), **New** (no `created_at` on the card), **Verified**
(organizer verification exists in the backend but isn't exposed on the event
payload), **Family friendly** (no audience/age field), and an **interested
count** (nothing records interest). The badges that ship — Sold out, Few left,
Selling fast, Free — are each computed from a column `ticketing` actually
maintains.

**Seam:** `components/discovery/filter-drawer.tsx` for the sections,
`lib/discovery/availability.ts` for the badges.

---

### 13. A subscription endpoint — `POST /subscriptions`

**Interim:** the signed-out prompt in the results grid offers **browser
notification permission**, which is a real mechanism with a verifiable result.
An email "Subscribe" button is deliberately absent: `notifications` is
event-driven and exposes no public HTTP endpoint, so the button could only ever
show a success message for something that never happened.

**Why a real one is better:** email reaches people who never return to the site,
which is the entire point of the card.

**Seam:** `components/discovery/subscribe-card.tsx` — one component.

---

### 14. `Event.images[]` — **BUILT**

`EventMedia` exists (`apps/events`), with kinds `hero`/`gallery`/`thumbnail`/
`mobile`/`video`, per-kind caps enforced in the service, and a multipart upload
at `POST /events/{id}/media/upload` that validates size, declared type and byte
signature (`core/uploads.py`). `components/event/hero-gallery.tsx` grew the
filmstrip its seam note promised — nothing else on the page changed.

**Still missing, and each is a real backend dependency:**

- **No `PATCH` on a media row.** `position` is set on upload only, so the
  Studio has no drag-to-reorder — it does not ship a handle that would write a
  field no endpoint accepts.
- **No renditions.** The API stores exactly the bytes it is given. A thumbnail,
  a WebP/AVIF variant and a responsive `srcset` all need a processing job
  (`TaskQueuePort` is the seam — `events.process_poster` is already registered
  and does nothing yet). Until then client-side cropping would be destructive
  rather than non-destructive, which is why the Studio does not offer it.
- **No reusable asset library.** Media rows belong to one event, so an
  organiser re-uploads the same logo per event. A shared `Asset` model keyed to
  the organisation is the fix.
- **No video upload.** `MediaKind.VIDEO` exists but `validate_image` is
  image-only, so the Studio's kind picker omits it rather than offering an
  upload that always 422s.

---

### 15. Organiser verification and profile on the event payload

**Interim:** the organiser card shows the real name and links to their other
events — a check the reader can actually make.

**Why a real one is better:** `organizations` already runs a verification flow;
its outcome simply isn't exposed on `GET /events/{id}`. Until it is, this page
cannot show a trust badge, and an unchecked one is the single worst thing to
fabricate on a ticketing site.

**Shape:** `organization: { id, name, verified, logo_url, events_count }` on the
event detail payload.

**Seam:** `OrganizerCard` in `components/event/sections.tsx`.

---

### 16. Event-specific FAQs — **BUILT**

`EventFaq` exists, organiser-edited via `POST`/`DELETE /events/{id}/faqs` and
read publicly through `GET /events/{id}/content`. The event page renders the
organiser's questions ABOVE the platform set, which stays: those answers are
properties of the backend (a signed QR scanned once, a refund that voids
tickets in the same transaction, no card data stored) and are true for every
event.

**Still missing:** there is no `PATCH` on an FAQ or a timeline entry, so the
Studio offers Remove-then-Add rather than an in-place edit. Faking an edit as
delete-then-recreate would silently change the id and reorder the list under
someone's cursor.

---

### 17. `Idempotency-Key` in the backend's CORS allow-list

**Not an interim — a bug.** `POST /bookings` documents an `Idempotency-Key`
header and dedupes on it, but django-cors-headers' default `CORS_ALLOW_HEADERS`
does not include it. A browser will not send a header the preflight did not
allow, so from a cross-origin frontend the request never leaves at all — and it
fails looking like a network error rather than a CORS one.

**Fix:** add `idempotency-key` to `CORS_ALLOW_HEADERS` in
`config/settings/base.py`. One line. Until then the frontend's double-submit
protection cannot reach the server it was built for. (The fixture already allows
it, which is why the funnel works locally.)

---

### ~~18. Profile editing — `PATCH /auth/me`, and `phone`~~ — ✅ DONE

`PATCH /auth/me` exists and carries `full_name`, `phone`, `date_of_birth`,
`gender` and `gender_self_described`; `POST /auth/me/onboarding` records that
the welcome flow was ANSWERED (filled in or skipped).

The frontend half is `components/account/profile-editor.tsx` (the settings
screen's Profile section, which used to be read-only plain text with a note
saying exactly why) and `components/account/onboarding.tsx` (four steps, every
one skippable, saving per step).

**The one shape decision worth carrying forward:** the column is
`date_of_birth`, and AGE IS DERIVED on the server. An age is wrong the day
after it is written, and this platform prints `Event.age_restriction` ("18+")
next to events — so a stored age would let somebody who was 17 at sign-up walk
an adult gate a year later.

**Still not editable: `email`.** It is the sign-in identity AND the destination
every ticket is delivered to, so moving it is a re-verification flow rather
than a profile field. The settings screen says so rather than rendering a
disabled box.

**The funnel's seams remain open** (`step-booking.tsx` "Where your tickets go",
`step-review.tsx` "Delivery"): they still show the account's name and email
read-only. Now that there is somewhere to put an edit, offering one there is a
small follow-up rather than a blocked one.

---

### 19. OAuth and phone/OTP sign-in — the backend half

**Interim:** the UI is BUILT and shipped — `components/auth/auth-panel.tsx`
renders Continue with Google, Continue with Apple, and an Email/Phone method
switch, on both `/sign-in` and the funnel's step 2. `apps/accounts` still
exposes register / login / refresh / logout / me and nothing else, so all three
of those controls fail immediately with `ProviderNotConfiguredError`, rendered
as a plain sentence naming the provider. They never spin and never report a
sign-in that didn't happen: an auth control that appears to work is the worst
thing to fake anywhere, because a ticket and a payment are attributed to
whoever it claims you are.

**Shape, three endpoints:**

- `GET /auth/oauth/{provider}/start?next=` → 302 to the provider.
- `GET /auth/oauth/{provider}/callback` → exchange the code, upsert the user,
  return the same `{user, tokens}` envelope `POST /auth/login` already returns.
- `POST /auth/otp/request {phone}` and `POST /auth/otp/verify {phone, code}` →
  the same envelope. `notifications` already sends SMS OTP through a DLT
  template, so the delivery half exists; what's missing is the challenge store
  and rate limiting.

**Turning each on is one env var, no component change:**
`NEXT_PUBLIC_OAUTH_BASE_URL` and `NEXT_PUBLIC_PHONE_AUTH_ENABLED` (documented,
commented out, in `.env.local.example`).

**Still deliberately absent:** guest checkout. That is not a UI decision — a
ticket is issued TO a user, and `Booking.user` is not nullable.

**Seam:** `lib/api/auth.ts` — `oauthStartUrl`, `startOAuth`, `requestPhoneOtp`,
`verifyPhoneOtp`.

---

### 20. Coupons and taxes

**Not built:** there is no coupon endpoint and no tax field, so the funnel shows
neither — no promo input that could only ever answer "invalid code", and no tax
line nobody computed. `total_amount` is what the customer pays and
`platform_fee` is the platform's cut taken out of it; that is the whole money
model today.

**Shape:** `discount`, `tax` and `total` on the booking payload, plus a
`POST /bookings/preview` so a code can be validated BEFORE inventory is
reserved.

**Seam:** `SummaryCard`, and `totalsFor()` in `lib/booking/selection.ts`.

---

### 21. Admin lookup for bookings and tickets

**Interim:** the console's ⌘K palette searches sections, organizations and
users. Bookings and tickets are absent: `GET /bookings/{id}` is scoped to the
booking's own owner, so an operator cannot look one up even with the id.

**Why it matters:** "customer says they paid but has no ticket" is the single
most common support question a ticketing platform gets, and today it can only
be answered from the Django admin.

**Shape:** `GET /admin/bookings?q=` (email, booking id, payment ref) returning
the same `BookingDetailSerializer` shape, staff-only.

**Seam:** `lib/api/admin.ts` and the `rows` memo in
`components/admin/command-palette.tsx`.

---

### 22. Deeper health probes

**Interim:** `/admin/health` PROBES database and cache and reports the
configured adapter for payments, storage, queue, event bus, email and SMS —
shown grey (`unknown`), never green, because nothing contacted them.

**Why it matters:** an operator wants to know the payment provider is reachable
before a Friday-night on-sale, not after.

**Shape:** an opt-in `?deep=1` that pings each vendor's status endpoint with a
short timeout and caches the result for a minute, so a dashboard poll never
becomes vendor traffic.

**Seam:** `apps/console/health.py` — `_configured()` becomes `_probe()` per
adapter, and the frontend tile already renders three states.

---

### 23. A "My tickets" page

**Interim:** `GET /me/tickets` is live and the account menu in the header has an
obvious hole where it belongs. Today the only way to see a ticket is the
confirmation screen at the end of the funnel, or the email `notifications`
sends. The menu links only to pages that exist — a menu item that 404s is worse
than its absence.

**Why it matters:** this is the second reason anyone signs in (the first is to
buy), and the QR is what gets scanned at the gate. "Where's my ticket" should
not require finding an email.

**Shape:** no backend change needed. `GET /me/tickets` already returns the
issued tickets with their signed QR tokens, `private, no-store`, in one joined
query.

**Seam:** `lib/api/bookings.ts` already has the client; the route would be
`app/(site)/tickets/page.tsx`, and the entry is the commented gap in
`components/auth/account-control.tsx`.

---

### 24. The organizer dashboard's remaining sections

The dashboard brief asked for fifteen sections. Three are built (`/dashboard`,
`/dashboard/events`, `/dashboard/bookings`), and the rest split into two
groups.

**Have a backend, not yet built** — these are the next slice, no backend work
needed:

| Section             | Endpoint that already exists                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Create Event wizard | `POST /events`, `PATCH /events/{id}`, `POST /events/{id}/publish`, `POST /events/{id}/ticket-types` |
| Customers           | `GET /organizer/customers`, `GET /organizer/customers/{id}`                                         |
| Analytics           | `GET /organizer/timeseries`, `/breakdown`, `/audience`, `/events/{id}/analytics`                    |
| Payouts             | `GET /organizer/settlements[/{event_id}]`                                                           |
| Check-in            | `POST /checkin/verify`, `GET /events/{id}/attendance`                                               |

The typed clients for all five are already written
(`lib/api/organizer.ts`, `lib/api/organizer-writes.ts`) and the query hooks
exist in `lib/organizer/queries.ts` — what is missing is the pages.

**Have no backend at all**: Coupons, Promotions, Team Members, Messages,
Reviews, Notifications, Support. Each needs a Django module built to the same
standard as the other eleven. `teams` and `marketing` are listed as
deliberately deferred in the repo's own CLAUDE.md.

**None of them appears in the sidebar until its page exists.** A nav item that
404s teaches an organizer to distrust the whole dashboard, which is the rule
the operator console already follows.

---

### 25. Row actions the bookings table cannot offer

**Interim:** the table shows the row detail a support agent reads out —
customer, event, quantity, status, amount, platform fee, payment reference.

**Refund** is the closest to free: `POST /payments/{id}/refund` exists and is
organizer-only and idempotent, but it needs `Payment.id` and the booking
payload carries `payment_ref` (Razorpay's id). Adding `payment_id` to
`OrganizerBookingSerializer` is a one-line change and would turn the action on.

**Resend ticket** has no endpoint — `notifications` is event-driven with no
re-send trigger. **Download invoice** generates nothing today. **Cancel on
behalf of** would need `POST /bookings/{id}/cancel` to accept the event's
organizer, not only the booking's owner.

**Seam:** `components/organizer/bookings-table.tsx`.

---

### 26. A `sort` parameter for the organizer lists

**Interim:** the events table sorts client-side over the pages already loaded
and says so in the footer whenever another page exists — the same honest
compromise the browse page makes (item 5).

**Why it matters:** "my highest-grossing event" is the single most common
question this table gets asked, and today it can only be answered across the
rows fetched so far.

**Why it is not free:** the list is cursor-paginated on `-created_at`, which is
what keeps it an index scan. A `sort=revenue` mode needs the aggregate to be
sortable in the database — most likely a denormalised `revenue_minor` on
`Event`, maintained the way `ticketing` maintains `from_price_minor`.

**Seam:** `OrganizerRepository.event_rows()` and the `sorted` memo in
`components/organizer/events-table.tsx`.

---

### 27. CSV export for bookings

**Not built:** there is no export endpoint, and generating a CSV in the browser
would only ever contain the pages already fetched — which is precisely the kind
of quietly-truncated file that gets reconciled against a bank statement.

**Shape:** `GET /organizer/bookings.csv` with the same filters, streamed with
`StreamingHttpResponse` so a year of bookings never materialises in memory.

**Seam:** `apps/organizer/api.py` — the filters are already parsed there.

---

### 28. The fields the event wizard cannot store

The wizard is built and integrated, but the brief asked for far more fields
than `Event` and `TicketType` have columns for. **None of them is rendered as
an input**, because a form that collects a refund policy and then discards it
on save is worse than one that never offered it — the organizer would believe
it was published and find out from an attendee.

**What `POST /events` accepts today:** `organization_id`, `title`,
`description`, `venue`, `city`, `starts_at`, `ends_at`, `poster`.
**What `POST /events/{id}/ticket-types` accepts:** `name`, `price`,
`quantity`, `sale_start`, `sale_end`, `max_per_order`.

| Wizard step | Asked for                                                                           | Needs                                                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basics      | Short description, category, tags, language, age restriction                        | `Event.category` (item 2) is the highest-value one — it makes browse filters exact instead of inferred from wording. The rest are columns.                                                    |
| Venue       | Street address, state, country, pin code, coordinates, venue capacity, embedded map | A `venues` module. Coordinates are also what item 9 (geo ranking) needs.                                                                                                                      |
| Schedule    | Timezone, separate doors-open time, recurrence                                      | Two columns and a series model. The doors time shown in the timeline is derived from the real `CHECKIN_WINDOW_OPENS_BEFORE_MINUTES`, not invented.                                            |
| Tickets     | Per-tier description, perks, visibility, refundable flag                            | Columns on `TicketType`. Refunds are per booking today, not per tier.                                                                                                                         |
| Media       | Gallery, video, thumbnail, crop, compression                                        | `Event` has one `poster_url` (item 14).                                                                                                                                                       |
| Policies    | Refund, age, parking, food, photography, terms, dress code, contact, emergency      | **No backend at all.** A single `policies` JSONB column on `Event` would cover all nine and is the cheapest large win here. The step is absent from the wizard rather than present and inert. |

**Also absent, and why:** a slug preview (the public route is
`/events/{uuid}`, so a slug would be a picture of a URL that never exists); a
social share card preview (it would just restate the SEO block); and tier
DELETE (`apps/ticketing` exposes none, correctly — a tier with sales is
referenced by issued tickets and by the settlement that pays them out; it
needs an `archived` flag, not a delete).

**Tier ordering** is editor-only. There is no `position` column, and the
public tiers endpoint orders by price — the builder says so rather than
implying a merchandising control that does not exist.

---

### 29. Analytics the platform does not measure

**Built and real:** revenue / bookings / tickets trends, revenue by event, revenue
by city, bookings by status, repeat-customer rate, per-event conversion,
abandonment, sell-through and attendance.

**Not built, because nothing records it:** traffic source, device, conversion
funnel and payment-method breakdown. There is no telemetry pipeline, no
user-agent capture, and `Payment` stores only the Razorpay order/payment/refund
reference ids and the amount — not the method. Rendering these as empty charts
would read as "you had no traffic" rather than "nobody measured it".

**Shape:** traffic and device need a page-view collector (a first-party
endpoint plus a session cookie, or an external analytics product) — a project in
its own right, not a column. Payment method is the cheap one: Razorpay returns
it on the webhook payload; storing `Payment.method` would need one column and
one line in the webhook handler.

**Seam:** `components/organizer/analytics.tsx`.

---

### 30. Customer fields the CRM cannot show

**Interim:** the customer table shows initials, name, email, bookings, lifetime
value with this organizer, last booking and a derived segment. The inspector
adds refunds, tickets attended vs issued, top cities and recent bookings.

**Absent:** avatar (`User` has no image column), phone (`User.phone` exists but
is on no serializer an organizer can read), and notes (no table). Notes are the
one that matters — a box that discards what was typed is worse than no box.

**Shape:** expose `phone` on the organizer customer payload; add a
`CustomerNote` model owned by the organization, not the platform.

**Seam:** `CustomerInspector` in `components/organizer/customers.tsx`.

---

### 31. Payout statements and an exact release date

**Interim:** the payouts page shows paid / awaiting-release totals, a per-event
settlement table with gross, platform fee, refunds and net, and the four-step
explanation of when money moves.

**Absent:** a downloadable statement (no endpoint), and the exact next-payout
date — `Settlement.releasable_at` is on the ADMIN payload but not the organizer
one. Adding it to `SettlementSerializer` is a one-line change and would turn
"after the event plus the refund window" into a date.

**Seam:** `components/organizer/payouts.tsx`.

---

### 32. Camera QR decoding for check-in

**Interim:** the scanner takes a token from a USB/Bluetooth barcode reader
(which types the code and presses Enter — handled natively, with the field
re-focusing after every scan) or from paste. Offline scans are queued and
replayed, and are labelled "queued", never "admitted" — a gate that flashes
green while offline would admit two people on one ticket, which is exactly what
the backend's per-ticket row lock exists to prevent.

**Absent:** in-browser camera decoding. It needs a QR decode library (~40KB
gzipped) and this build carries none; adding one is a real bundle decision, not
an oversight.

**Shape:** dynamic-import the decoder so it costs nothing until someone presses
"Use camera". The verdict must still come from `POST /checkin/verify` — a
client-side decode is a way to READ the token, never to decide on it.

**Seam:** `components/organizer/check-in.tsx`.

---

### 33. Filters the events list cannot express

**Interim:** saved views are URL states over the filters the endpoint really
supports (`q`, `status`, `city`), so a view is shareable and needs no storage.

**Absent:** "Needs attention", "Low inventory", "Today", and user-defined saved
views. Low inventory is a comparison between two columns, "Today" is a date
range, and a custom view needs somewhere to persist it. Offering them as chips
that filtered one loaded page would make an organizer believe they had seen
every at-risk event when they had seen twenty.

**Shape:** `starts_after`/`starts_before` already exist on the PUBLIC events
endpoint — porting them to `/organizer/event-rows` gives "Today" immediately. A
`remaining` expression annotation would give low inventory.

**Seam:** `SavedViews` in `components/organizer/events-table.tsx`, and
`OrganizerRepository.event_rows()`.

---

### 34. Organizer dashboard sections still unbuilt

**Settings** is partly backed — `PATCH /organizations/{id}` (name, logo),
`POST /organizations/{id}/verification` and `.../payout-account` all exist. No
page is built for them yet; branding beyond a logo, GST, bank details, API keys
and a danger zone have no columns.

**No backend at all:** Coupons, Promotions, Team members, Messages, Reviews,
Notifications, Support. Each needs a Django module built to the standard of the
other eleven. `teams` and `marketing` are listed as deliberately deferred in the
repo's own CLAUDE.md.

**Bulk operations** on the events table are partly possible: publish is real
(`POST /events/{id}/publish`) and duplicate is real (create + copy tiers), but
**archive is not** — `status` is not in `UpdateEventRequestSerializer`'s
editable set, so an event cannot be archived through the API at all. Delete does
not exist either. Rather than ship a bulk bar where two of five actions fail,
none is built yet.

---

### 35. The Event Creation Studio's remaining backend dependencies

Everything the Studio collects is stored for real. These are the capabilities
it deliberately does NOT expose, each because no endpoint backs it:

- **Scheduled publishing.** `POST /events/{id}/publish` submits for review
  immediately; there is no `publish_at`. A date picker that did nothing at the
  chosen hour is worse than no date picker.
- **Archive and delete.** `status` is not in `UpdateEventRequestSerializer`'s
  editable set (deliberately — lifecycle transitions go through `publish`,
  never a blind PATCH), and there is no delete endpoint. See item 34.
- **Version history and rollback.** `Event.version` is an optimistic lock, not
  a revision log — it holds one integer, not previous values. A real history
  needs an `EventRevision` table written in the same transaction as the update.
- **Collaboration.** No comments, no presence, no per-field locking. `teams`
  is the module that would own this and is deliberately deferred.
- **Category, tags and policy text.** Still no columns — items 2, 12 and 28.
- **A structured venue.** `venue` and `city` are plain strings, so there is no
  address, no coordinates, no capacity and no map — item 9.

The Studio names each of these on the step it would belong to, as a sentence
rather than a disabled control: a greyed-out field reads as "coming soon, keep
checking", whereas a sentence naming the missing column reads as a decision
somebody made.

---

## The Organizer Operations Platform — what the backend still owes it

The surfaces below are built and read real data. These are the capabilities the
brief asked for that no endpoint supports, each named rather than faked.

### 36. Refund request workflow

**Interim:** `/dashboard/refunds` lists refunds that have COMPLETED. Partial vs
full is real (computed server-side from the refunded amount against the
payment's), and the reason is shown as stored.

**What is missing:** Pending / Approved / Rejected. `payments.Refund` is a
record of money already returned — `execute_refund` writes it only after the
vendor call succeeds — so there is no object representing a request awaiting a
decision, and no way for a customer to raise one.

**Shape:** a `RefundRequest` model (`booking`, `requested_by`, `amount_minor`,
`reason`, `evidence_url`, `status`, `decided_by`, `decided_at`), `POST
/bookings/{id}/refund-requests` for the attendee, `POST
/organizer/refund-requests/{id}/decide` for the organizer, and a notification on
each transition. Approval would then call the existing `execute_refund`.

**Seam:** `components/organizer/refunds.tsx` grows a status filter and a
decision drawer; the completed list stays exactly as it is.

---

### 37. Owner-scoped activity log

**Interim:** `GET /organizer/feed` merges five real sources — bookings, refunds,
gate admissions, payout attempts and publishing decisions — and sorts them by
time. Every row is a database record with its own timestamp.

**What is missing:** content edits, media uploads and announcements.
`core.OutboxEvent` records the first two platform-wide, but it has **no owner
column**, so filtering it per organizer would mean scanning every event on the
platform and inspecting payloads. (`apps/console` can read it because the
console legitimately sees everything.)

**Shape:** either an `owner_id` column on `OutboxEvent` with an index on
`(owner_id, created_at)`, or a dedicated `OrganizerActivity` table written in
the same transaction as each event. The second is more work and much easier to
keep correct.

**Seam:** `selectors.get_unified_activity` gains a sixth source; the client
already renders by `kind` and `severity`, so nothing on the frontend changes.

---

### 38. Organizer notification centre

**Interim:** none, deliberately. There is no bell icon.

**Why not:** `notifications` is an internal, event-driven module with no HTTP
surface. It has a `NotificationLog` keyed by recipient, but no read/unread state
and no organizer-scoped read endpoint — so a notification centre could only ever
show a list this client invented and "marked read" in its own localStorage. What
an organizer actually needs from one (what is wrong, what changed) is answered
by the attention panel and the activity timeline, both of which read real rows.

**Shape:** `read_at` on `NotificationLog`, `GET /organizer/notifications`, `POST
/organizer/notifications/{id}/read`, and organizer-addressed notification types
for the events that concern them (rejection, payout released, payout failed).

---

### 39. Event view counting

**Interim:** the event cards show sold, remaining, revenue and check-ins — every
one a column the backend maintains. Views and conversion-from-views are ABSENT
rather than shown as "—", because a greyed-out row implies the number exists and
merely happens to be zero.

**What is missing:** nothing counts a page view. `GET /events/{id}` is
edge-cached with `s-maxage=60`, so a naive counter in the view would miss most
traffic anyway.

**Shape:** a fire-and-forget `POST /events/{id}/view` from the client behind a
session guard, aggregated into a daily `EventViewDaily` row. Conversion then
becomes bookings ÷ views over the same window.

**Seam:** `EventCards` in `components/organizer/events-table.tsx`, and
`EventAnalyticsSerializer`.

---

### 40. Duplicate an event

**Interim:** not offered. The bulk bar has Submit for review and Archive, both
real endpoints.

**Why not client-side:** duplicating means `POST /events` followed by N `POST
/events/{id}/ticket-types`, with no transaction around them. A failure halfway
leaves a half-built event that looks real — on the surface an organizer uses to
decide what is on sale.

**Shape:** `POST /events/{id}/duplicate`, copying content fields, tiers (with
`sold`/`reserved` zeroed), FAQs and timeline inside one `UnitOfWork`.

---

### 41. Delete an event

**Not planned, and the reason should be recorded.** An event is referenced by
bookings, tickets and a settlement, all `PROTECT`ed at the database. A delete
would either fail outright or orphan real money. **Archive is the honest
operation** and now exists (`POST /events/{id}/archive`, draft/rejected/finished
only). A bulk bar offering Delete would be offering something the platform
cannot do.

---

### 42. A `sort` parameter for the organizer lists

**Interim:** tables sort CLIENT-SIDE over the rows loaded so far, and say so —
the footer reads "sorted within the N rows loaded so far, not across every
event" whenever another page exists.

**Why a real one is better:** an organizer with 300 events who sorts by revenue
is looking at the top of page one, not the top of their business.

**Shape:** `sort=revenue|sold|starts_at` plus `dir`, with the cursor
pagination's `ordering` following it. Every sortable column needs an index or
the scan stops being an index scan.

---

### 43. Scheduled publishing, and a Cancelled state

**Interim:** the status filter offers what `EventStatus` actually holds — draft,
pending review, changes requested, published, paused, completed, archived.

**What is missing:** the brief also asked for **Scheduled** and **Cancelled**.
There is no `publish_at` column, so a date picker would do nothing at the hour
chosen; and `cancelled` is not an `EventStatus`. Archiving is the closest stored
state and is what the UI offers.

**Shape:** `publish_at` plus a scheduled task that runs the same readiness
checks at the appointed time; a `CANCELLED` status with a refund sweep, since
cancelling an event with issued tickets has to refund them.

---

### 44. Read-only ticket lookup

**Interim:** QR lookup lives on the check-in surface, not on Bookings.

**Why:** a QR token resolves to a TICKET, and the only endpoint that reads one
(`POST /checkin/verify`) also MARKS IT USED under a row lock. "Looking one up"
from a bookings table would silently admit somebody.

**Shape:** `POST /checkin/lookup` — same signature verification, same
authorization, no write, returning the ticket's status and event without
touching it.

---

### 45. Bundled QR decoder

**Interim:** the camera scanner uses the browser's own `BarcodeDetector`, which
costs zero bytes and is hardware-accelerated. It is in Chrome and Edge and NOT
in Safari or Firefox, so those browsers are told plainly to use a handheld
reader rather than shown a button that opens a black rectangle.

**Shape:** a dynamically imported decoder (~40 KB gzipped) loaded only when
`BarcodeDetector` is absent AND the organizer presses the camera button — so the
cost falls on the people who need it, not on every page load.

---

### 46. Booking state transition timestamps

**Interim:** the booking inspector's timeline is DERIVED from four stored facts
(`created_at`, `hold_expires_at`, `payment_ref`, `status`), which determine the
lifecycle completely because it only has four states. Steps whose time is not
stored say "Time not recorded" rather than borrowing another step's clock.

**Shape:** `paid_at` and `cancelled_at` on `Booking`, written in the same
transaction as the transition.

---

### 47. Customer tags, segments and notes

**Interim:** the customers surface shows real lifetime value, booking count,
refunds, tickets issued and attended, and top cities — all grouped over this
organizer's own events. Segments are DERIVED from those numbers, which is honest
because each is a computation over stored data.

**What is missing:** organizer-authored tags and notes. There is no
`CustomerTag` or `CustomerNote` model, so a tag input would drop what was typed
on reload.

**Shape:** `CustomerTag(organization, user, label)` and `CustomerNote(
organization, user, author, body, created_at)`, both organization-scoped so one
organizer's notes never reach another.

---

### 48. Traffic sources and device types

**Not built, and no interim.** The brief lists both under Analytics as
extensions. Nothing on this platform records a referrer or a user agent against
a booking, so both would be invented from nothing. They need item 39's view
pipeline first — a device type is a property of a VISIT, not of an order.

---

## The Admin Operations Center — what the backend still owes it

The console's surfaces are built and read real rows. These are the capabilities
the brief asked for that no model supports, each named rather than faked.

### 49. Support desk

**Interim:** none, and there is no Support section in the nav. That absence is
deliberate: a Support page could only show an empty list and a "New ticket"
button writing nowhere, while implying to every operator that customer messages
are being captured. They are not — nothing on this platform receives one.

**Missing model:** `SupportTicket(requester, subject, status, priority,
assignee, tags, created_at, resolved_at)` plus `SupportMessage(ticket, author,
body, created_at, is_internal)`.

**Missing endpoints:** `GET/POST /support/tickets` for the customer,
`GET /admin/support/tickets` with status/assignee filters, `POST
/admin/support/tickets/{id}/messages`, `POST .../assign`, `POST .../status`.

**Permission change:** operators need a read of another user's tickets, which
no current permission grants.

**Background job:** an inbound email-to-ticket poller, or the support desk only
ever receives what someone types into the site.

**Notification:** each reply needs to reach the requester through the existing
`notifications` module — a new type plus a template.

---

### 50. Operational telemetry

**Interim:** `/admin/health` probes the database and the cache for real and
reports every other adapter as `unknown` with its configured backend. The
"Not measured" section on that page NAMES each missing signal and why, rather
than drawing a chart of numbers nothing produces.

**Missing, and why each is genuinely absent:**

- **Latency and response times** — no request-timing middleware runs in
  production. `core.middleware.PerformanceLoggingMiddleware` is gated on
  `DEBUG`, deliberately, because query logging has real overhead.
- **Error rates** — errors are logged, not counted. There is nowhere to count
  them into.
- **Health history** — each probe answers for right now and is not persisted.
- **Background job depth** — `QUEUE_BACKEND=local` runs tasks synchronously, so
  a pending count would structurally always be zero.

**Missing model:** a `MetricSample(name, value, at)` hypertable, or an external
time-series store — this is the one case where a dedicated store beats a
Postgres table.

**Missing middleware:** a production-safe timing middleware that records
duration and status per route without logging queries.

**Caching requirement:** the health endpoint must stay uncached (it is a probe),
but the HISTORY read wants a short TTL or every dashboard poll aggregates the
whole window.

---

### 51. Preview an unapproved event as an attendee

**Interim:** the moderation row carries the poster, title, description, venue,
date and organiser verification level — enough to decide without opening
anything. A "View the public page" link appears only on APPROVED events,
because `GET /events/{id}` filters on `status=live` and would 404 for a pending
one.

**Missing:** a staff override on the public detail read, or a signed
`?preview=<token>` route that renders a non-live event for a staff caller.

**Caching requirement:** the preview response must be `private, no-store`. The
public detail is edge-cached with `s-maxage=60`, and an unapproved event
landing in a shared cache would publish it by accident.

---

### 52. Chargebacks

**Interim:** none. The Payments surface has Transactions and Refunds, and says
in its own docstring why there is no third tab.

**Missing:** this platform handles exactly ONE webhook event (payment
captured). A dispute arrives as a different event entirely and nothing listens
for it.

**Missing model:** `Chargeback(payment, provider_ref, amount_minor, reason,
status, evidence_due_at)`.

**Missing endpoint:** an additional branch in `POST /payments/webhook` for the
dispute events, plus `GET /admin/chargebacks`.

**Notification:** a chargeback has a deadline. It has to page somebody, not sit
in a list.

---

### 53. Manual payment review

**Interim:** none, and no queue is rendered. No payment is ever held for a
human — the webhook either confirms and issues tickets, or refunds
automatically. A review queue nothing can enter is furniture.

**Missing model:** a `hold` state on `Payment` plus `PaymentReview(payment,
reason, decided_by, decided_at)`.

**Missing rule:** something has to DECIDE to hold — a velocity check, an amount
threshold, a mismatched country. Until that rule exists the queue has no
inputs, so the rule is the real dependency, not the table.

---

### 54. Organizer applications, documents and warnings

**Interim:** `/admin/verifications` approves or rejects a real
`VerificationRecord`, and `/admin/organizations` lists every organization with
its verified level and payout account.

**Missing:**

- **Applications** — there is no application object distinct from the
  verification record, and no "apply to become an organizer" flow. Today
  `is_organizer` is set at registration.
- **Documents** — `VerificationRecord` has a `notes` text field and no file.
  Uploading a registration certificate needs a `VerificationDocument(record,
  url, kind, uploaded_at)` and a multipart endpoint through
  `core.uploads.validate_image` (extended to accept PDF).
- **Business information** — no GST number, no registered address, no bank
  details beyond the opaque `payout_account_id`.
- **Warnings** — no model. A warning that is not recorded is a conversation,
  not a moderation tool.

---

### 55. Incidents and deployments

**Interim:** none. The home page shows attention items derived from real
queues, and announcements are separately editable.

**Missing:** an `Incident(title, severity, started_at, resolved_at,
status_page_visible)` model, and a deployment record something in CI writes to.
Neither exists, and a "Recent deployments" tile would show an empty list
forever on the screen operators trust most.

---

### 56. Admin lookup for bookings and tickets

**Interim:** the command palette searches sections, organizations, users,
pending events, payments, refunds and settlements. Bookings and tickets are
absent.

**Missing endpoint:** `GET /admin/bookings` with customer/reference/event
filters, and `POST /checkin/lookup` (read-only ticket resolution — see the
organizer BACKLOG item 44).

**Why it matters here:** an operator on a support call has a booking reference
and currently has to find the event, then the organizer, then ask them. The
payment search partly covers it, because the payment carries the customer and
event — but a booking that never reached payment is invisible.

---

### 57. Draft preview for the CMS Studio

**Interim:** the Studio's preview pane frames the REAL homepage in an iframe
and is labelled "Published version — refreshes on save". It reloads after each
save rather than pretending to be live.

**Missing:** a draft-render mode. `GET /?preview=<token>` (or a header) that
renders unsaved homepage content for a staff caller, so typing updates the
pane.

**Caching requirement:** that response must be `private, no-store` — the
homepage is edge-cached, and a draft leaking into a shared cache would publish
half-typed copy.

**Why an iframe and not a mock:** a hand-built preview is a second
implementation of the homepage, and it drifts. The whole value of a preview is
that it is not a drawing.

---

### 58. Cities, Trending and Banners as CMS content

**Interim:** the Studio's tree covers hero, search placeholder, ribbon, trust
badges, featured collections, categories, footer note and announcements —
every one a real field or a real row.

**Missing:**

- **Cities** — `Event.city` is a plain string. The served-cities list is a
  frontend constant (`lib/discovery/cities.ts`). Editing it needs a `City`
  model with a slug, hero image and display order.
- **Trending** — `CollectionKey` includes `trending`, but nothing computes or
  writes it. It would need either an editorial collection (which already works)
  or a real popularity aggregate over bookings.
- **Banners** — no `Banner` model. The ribbon is one line of text on the
  homepage record, which is not the same thing as a scheduled, targeted,
  image-backed banner.

A tree row that opens an editor saving nowhere is worse than an absent row —
an operator would believe the site had been changed.

---

### 59. Shared saved views

**Interim:** saved views are stored per surface in `localStorage`. That is the
honest scope: one operator's shortcuts on one machine.

**Missing:** `SavedView(owner, surface, name, query, layout, shared)` plus
`GET/POST/DELETE /admin/saved-views`, so a team can agree on "the failed
payouts view" instead of each rebuilding it.

---

### 60. Bulk editing

**Interim:** bulk APPROVE on the moderation queue (identical action, real time
saving) and bulk archive/submit on the organizer's events table. Bulk REJECT is
deliberately not offered — a rejection carries a reason the organiser reads,
and one reason pasted across twenty events fits none of them.

**Missing for general bulk editing:** every write endpoint is single-resource.
Editing twenty rows means twenty requests with no transaction around them, so a
failure halfway leaves a half-applied change. A `PATCH /admin/<resource>/bulk`
taking a list of ids and one patch, inside one `UnitOfWork`, is what a real
bulk edit needs.

---

## Hire a Band — what the marketplace still needs

The marketplace is built on a real module (`apps/performers`) and the whole
customer flow works end to end. These are the capabilities the brief asked for
that no model supports, each named rather than faked.

### 61. Performer reviews and ratings

**Interim:** none, and there are no stars anywhere. Profiles and cards show
what CAN be checked — years of experience, whether the organisation behind the
act is verified, and the fact that every listing passed a human review before
appearing. The marketplace filters have no "minimum rating" for the same
reason.

**Why it must not be faked:** hiring a band for a wedding is a decision worth
tens of thousands of rupees. A five-star row backed by nothing is the single
most damaging thing this product could invent.

**Missing model:** `PerformerReview(performer, booking_request, author, rating,
body, created_at)` — anchored to a `BookingRequest` that actually completed, so
a review cannot be left by somebody who never hired them.

**Missing endpoints:** `POST /hire/requests/{id}/review` (only for a booked
request, only by its customer, only once), `GET /performers/{id}/reviews`.

**Denormalisation:** `rating_average` and `rating_count` columns on
`Performer`, recomputed in `transaction.on_commit` — a card that aggregates
reviews per row is the N+1 the whole repository is shaped to avoid.

**Moderation:** reviews need the same gate listings have, or the first
retaliatory one-star ends the feature.

---

### 62. Video on a performer profile

**Interim:** photos only. `core.uploads.validate_image` is image-only by
design, and the profile links out to YouTube where an act has one.

**Missing:** video needs a different pipeline entirely — a size cap in the
hundreds of megabytes rather than ten, a transcode job, a poster frame, and a
player. Uploading raw video through the same multipart endpoint would block a
worker for minutes.

**Shape:** a `PerformerVideo` model holding a provider id rather than bytes
(Mux, Cloudflare Stream), a signed direct-to-provider upload URL, and a webhook
that marks it ready. Storing video ourselves is the expensive way to do this.

---

### 63. A real availability calendar

**Interim:** the honest signal is that a performer answers a brief for that
date or does not. `travel_radius_km` is stored and shown, but is NOT used to
match leads.

**Why the radius does not match:** matching a radius needs coordinates, and
`city` is a plain string on both the performer and the brief. Comparing "Navi
Mumbai" to "Mumbai" as strings is wrong in both directions.

**Missing models:** `PerformerBlackout(performer, date, reason)` for dates they
are unavailable, plus geocoded cities (BACKLOG item 9's `venues` work would
serve both).

**Missing endpoint:** `GET /performers/{id}/availability?from=&to=`, and an
`available_on=` filter on the browse.

---

### 64. Reported performers

**Interim:** none, and the admin console has no Reported tab. A tab that could
only ever be empty would imply the platform is watching for something it is
not.

**Missing model:** `PerformerReport(performer, reporter, reason, detail,
status, resolved_by, resolved_at)`.

**Missing endpoints:** `POST /performers/{id}/report` (authenticated, rate
limited — an unauthenticated report endpoint is a denial-of-service against a
competitor), `GET /admin/performer-reports`.

**Permission change:** the report list is staff-only; the report itself is open
to any signed-in user.

---

### 65. Per-act suspension, and availability incidents

**Interim:** an operator can send a profile back with a reason, and can suspend
the OWNER's whole account from Users. There is nothing in between.

**Missing:** suspending one act while leaving the organisation's other acts and
its events alone. `PerformerStatus` has `paused`, but that is the owner's own
control — an operator-imposed suspension needs its own state so the owner
cannot simply un-pause it.

**Also missing:** nothing records a no-show. "Availability issues" as a
moderation queue needs an incident model fed by the customer after the event
date passes.

---

### 66. Payment through the platform

**Interim:** a quote is an agreement between two people. Curatix introduces
them and records the price; the money moves outside.

**Why that is the honest first version:** the `payments` module is built around
a ticket — one capture, one refund window, one settlement after the event.
A booking is a deposit now, a balance later, and a cancellation policy that
varies per act. Forcing it through the ticket shape would mean a refund rule
nobody agreed to.

**Missing:** a milestone/escrow shape — `BookingPayment(quote, kind, amount,
due_at, captured_at)` with deposit and balance kinds, a cancellation policy on
the performer, and a dispute path. This is the largest item on this list and
should not be started until the marketplace has real volume.

---

### 67. Messaging between customer and performer

**Interim:** a quote carries a message, and that is one round trip. After
accepting, the two parties have each other's details outside the platform.

**Missing:** a thread. `QuoteMessage(quote, author, body, created_at)` plus a
notification per message, and — importantly — a rule about when contact details
become visible, because a marketplace whose parties can exchange phone numbers
before booking is a marketplace they will book around.

---

### 68. Performer search ranking

**Interim:** the browse orders featured-first then newest. Search filters by
the tsvector and keeps that order.

**Why not relevance:** `SearchRank` would break the cursor pagination, exactly
as it would on the events browse (item 5's reasoning applies unchanged). A
`sort=relevance` mode needs its own non-cursor path.

---

### 69. Organizer-side performer studio — BUILT

**Done.** `/studio` (act picker), `/studio/new` (create), and eight act-scoped
screens under `/studio/[id]`: overview, leads, pipeline, calendar, profile,
photos, analytics, preview. Every one consumes an endpoint that already
existed; the only backend change was adding `photos` to the owner payload
(item 78). Kept here as the anchor for items 70–78, which are the things that
workspace asked for and could not have.

---

## The Performer Studio — what the backend still owes it

Nine entries. Eight are things the studio's brief asked for that were
deliberately NOT drawn, because nothing stores the fact they would display; the
last is the one change that WAS made. Each says what it would take.

---

### 70. Cover photo and profile photo as distinct kinds

**Interim:** `photos[0]` — lowest `position` — is the marketplace card, and the
photo manager labels it "Your card" so the consequence of upload order is at
least visible. `PerformerMedia.kind` exists in the model with `photo` as its
only member.

**Why it matters:** the picture that works as a 4:3 card crop is rarely the one
that works as a hero, and "whichever you uploaded first" is not a choice
anybody made. Today the only way to change the lead photo is to delete and
re-upload, which the manager says out loud rather than hiding behind a control.

**Missing:** either `kind` gaining `cover`/`portrait` members with a
"one per performer" constraint, or a `Performer.cover_media` FK — plus a
`PATCH /me/performers/{id}/photos/{media_id}` that can set it.

**Seam:** `components/performer/photo-manager.tsx` — the tile already computes
`isCover`; it would read the flag instead of the index.

---

### 71. Reordering photos

**Interim:** `position` is written once, at upload
(`uploadPerformerPhoto(..., { position })`). The gallery renders in that order
and the manager states the rule rather than offering a drag handle that would
write nothing.

**Why not a local-only drag:** an order that reverts on reload is worse than no
drag at all, and this is the screen where a performer decides their profile is
finished.

**Missing:** `PATCH /me/performers/{id}/photos` taking `[{id, position}]` and
writing them in one transaction — the same shape the event studio's media step
will want, so it is worth building once for both.

---

### 72. Editing alt text and captions after upload

**Interim:** alt text is collected in the picker, BEFORE the bytes go up,
because the server refuses a photo without it — and because alt text written
while looking at the image is real alt text, where a field appended to a
finished grid gets "image1". Caption is accepted at upload and displayed.
Neither can be changed afterwards.

**Missing:** the same `PATCH` as item 71, carrying `alt_text` and `caption`. A
typo currently costs a delete and a re-upload of the same file.

---

### 73. Structured quote line items, and revising a quote

**Interim:** a `Quote` is `amount_minor` + `message`. The composer offers one
price and one message, and states plainly that a performer gets **one quote per
brief and cannot edit it** — that is a `UniqueConstraint` on
`(request, performer)`, verified against live Django. Withdrawing does not free
the slot (also verified), so the pipeline's withdraw control says so before the
click rather than after it.

**Why the constraint is right today:** it stops a bidding war in the customer's
inbox and keeps "cheapest first" meaningful.

**Missing, in order of value:**

1. `QuoteRevision(quote, amount_minor, message, created_at)` — a superseding
   price with the history kept, so a customer can see they were re-quoted.
2. `QuoteLineItem(quote, label, amount_minor)` — travel, sound, extra set. The
   composer would itemise instead of asking for one number.
3. A counter-offer from the customer, which is the missing "Negotiation" lane
   in the pipeline (item 76).

---

### 74. A real availability calendar

**Interim:** `/studio/[id]/calendar` is an AGENDA of things that are true —
confirmed bookings (accepted quotes) and open briefs — soonest first. There are
**no green "available" cells**, because nothing stores availability and a
performer may be booked elsewhere, ill, or simply not want that Saturday. The
page says this rather than leaving it to be inferred.

**Missing:** `PerformerBlackout(performer, starts_on, ends_on, reason)` plus a
recurring rule for "no weekday gigs" — and, the part that earns it,
`BookingRequestRepository.list_open_for_performer` excluding briefs whose date
is blacked out, so the lead feed gets quieter rather than the calendar getting
prettier. Item 63 covers the customer-facing half of the same model.

---

### 75. Profile views, conversion, impressions

**Interim:** `/studio/[id]/analytics` shows quotes sent, win rate (accepted ÷
**decided**, with pending excluded from the denominator and `null` until
something is decided), booked value and average quote. All four are counts or
sums over the performer's own rows. The screen then **names** the four metrics
it does not have, and why, instead of approximating them from lead counts.

**Why approximating would be worse here than anywhere else:** this is the
screen a performer uses to decide whether to lower their price.

**Missing:** a view pipeline. `GET /performers/{id}` is edge-cached
(`s-maxage=60`), so a naive counter in the view misses most traffic — it needs
either a client beacon or log-derived aggregation, then
`PerformerDailyStat(performer, day, views, lead_matches, quotes, wins)` written
by a scheduled job. Conversion and CTR fall out of that; impressions need the
marketplace to log which acts appeared in which search.

---

### 76. Dismissing a lead, and a response deadline

**Interim:** not quoting IS how a performer passes on a brief, and the studio
says so ("Not for you? Just skip it — the brief closes when the customer
books"). The pipeline has five lanes, all real; the brief asked for seven.
**Negotiation** was not drawn because there is no counter-offer object, and
**Accepted** vs **Booked** were merged because accepting closes the brief and
books the act in one transaction — two lanes holding identical rows teach
somebody there is a step they are missing.

**Missing:**

- `DismissedLead(performer, request, dismissed_at)` so a skipped brief leaves
  the feed and stays gone, with `list_open_for_performer` excluding them.
- `BookingRequest.respond_by`, so leads can be sorted by urgency honestly —
  today they sort by event date, which is a proxy for it.

---

### 77. Performer FAQ, contact preferences, and a tiered rate card

**Interim:** the profile editor writes exactly the columns `Performer` has —
stage name, type, tagline, bio, city, travel radius, base price, genres,
languages, occasions, experience, set length, three links. The brief asked for
an FAQ block, contact preferences and a rate card; none has a column, so none
has a control.

**Missing:** `PerformerFaq(performer, question, answer, position)` — the same
shape `events` already has, so the editor could reuse that builder outright;
`PerformerContactPreference` (preferred channel, notice period, whether to
accept leads outside the travel radius); and `PerformerRate(performer, label,
amount_minor, duration_minutes)` for "2 hours ₹X, 4 hours ₹Y", which is what
the single `base_price_minor` is currently flattening.

---

### 78. Photos on the owner payload — DONE

The one backend change this slice needed, recorded here so it is not mistaken
for something the studio worked around.

`OwnerPerformerSerializer` now carries `photos`. It had to: the public detail
carries them but **404s for anything not yet approved**, so without it an owner
could upload a photo and never see it again while their profile was still a
draft — the exact window in which they most need to look at it.

Implemented as one grouped query (`PerformerMediaRepository.all_media_for_many`)
attached by the view (`_with_photos`), so a twenty-row owner list costs one
photo query rather than twenty. Covered by five tests, one of them a query
budget.

---

### 79. Re-sync the E2E specs to the shipped UI — BLOCKING A DEPLOY GATE

`tests/e2e/*.spec.ts` describes a home page that no longer exists. The suite
has **never passed in CI** — 33 runs, 0 successes — and that was masked by a
separate configuration bug (the job built against `https://ci.invalid/api`, so
every spec failed on DNS long before any assertion was reached, and the real
mismatch was invisible).

With the API base pointed at the fixture backend, the true state was
**51 pass / 38 fail / 3 skipped**. Measured again on a real production build
(`npm run build && next start`, which is what CI runs) it was **39 pass / 31
fail**, every failure in `discovery.spec.ts`. It is now **47 pass / 24 fail**,
and the causes below are no longer guesses.

**Two of the 31 were not stale specs at all, and both are fixed:**

1. **The fixture's event DETAIL payload was missing sixteen of the serializer's
   thirty fields**, `policies` among them. The event page reads
   `event.policies.length`, and an ABSENT `policies` (rather than the empty list
   the real API always sends) threw `Cannot read properties of undefined` during
   render — which collapsed the ENTIRE event page to the not-found boundary, on
   every event, in every production-build run. Eight specs failed on that one
   line. `scripts/mock-api.mjs` now sends every field the serializer does, with
   the same blank/null defaults. A fixture that sends less than the contract
   does not merely under-test; it makes the app look broken in ways it is not.
2. **`tests/e2e/discovery.spec.ts:94` asserted `ItemList` JSON-LD on the home
   page and the home page emitted none.** The only component that built it was
   `components/discovery/hero-featured.tsx`, whose sole consumer `home-hero.tsx`
   is imported nowhere. The spec was right about what the page SHOULD carry —
   the home rail is a list of events — so `Showcase` emits it now.

**The axe failures are NOT an accessibility regression** — the open question
this item raised, now answered. Every violation is `color-contrast`, and every
reported ratio is ~1.02 between two near-whites (`#fcfcfc` on `#ffffff`). That
is the signature of `content-visibility: auto` (the `.cv-card` utility on deep
grid rows) taking a subtree far enough out of the render tree that axe cannot
resolve its colours. `styles/globals.css` already documents this exact
interaction as the reason `cv-card` is scoped to grid rows and nothing else; it
still catches the browse grid and the event page's "More in {city}" row. Real
contrast failures produce plausible ratios, not 1.02. The fix belongs in the
spec (scroll the grid, or scope the scan) or in dropping `cv-card` — the
codebase's own comment argues for the latter: "an accessibility gate you can't
trust is worth more than the remaining milliseconds".

The specs are STALE, not flaky. `app/(site)/page.tsx` was rewritten in
`c983c09` to lead with `<Showcase>`; `tests/e2e/discovery.spec.ts` has not been
touched since the earlier `30c162e`. So the specs still assert `<HomeHero>` — a
component now imported **nowhere**:

    expected  <h1>What do you feel like…   (HomeHero, orphaned)
    actual    <h1>Happening soon           (Showcase)

**The remaining 24 are genuinely stale**, and they are all one kind of thing —
a spec describing a control the redesign removed or renamed:

- **featured carousel (4) and featured island (6)** — 10 of the 24. These assert
  `components/discovery/carousel.tsx`, `featured-island.tsx`, `hero-slide.tsx`
  and `featured-context.tsx`, which are reachable only from `hero-featured.tsx`
  -> `home-hero.tsx`, and nothing imports that. The components are dead and the
  specs test nothing that ships. Deleting both together is the honest fix, and
  is deliberately left out of the SEO change that diagnosed it.
- **deep search (4) + "/" opens search (1) + the funnel's search step (1)** —
  all six wait for `getByRole('combobox', { name: /Search events, artists/ })`.
  The header's search control is a `button`, not a combobox.
- **`region "Featured events"` (2)** — `Showcase` renders a `Marquee`, which is
  a `list`.
- **quick filters (1)** — no `navigation` named "Quick filters" on the home page.
- **3 / 2 / 1 columns (1)** — the browse grid is 4-up at the widest breakpoint.
- **subscribe card copy (1)** — the card says something else now, and what it
  says is more accurate.
- **axe (3)** — the `content-visibility` false positives described above.

Two things to be careful about while fixing this:

- **The axe failures were checked and are not real.** See above. Do not
  "fix" the UI for them.
- **The fixture does not serve `GET /events/{id}/content`** (it 404s, while
  detail and `ticket-types` both return 200). `fetchEventContentSafe` swallows
  that correctly, so the page still renders — but any spec asserting gallery,
  FAQs or running order is asserting against empty collections. Extend
  `scripts/mock-api.mjs` rather than weakening the spec. The same applies to
  every other endpoint the fixture is missing: the event-detail gap above cost
  eight specs and looked like eight separate UI bugs.
- **`tests/e2e/seo.spec.ts` is green (15/15) and is the model to follow.** It
  was written alongside the SEO work and passes on a production build, so a new
  spec failing here is a real signal rather than more of the same noise.

**Until this is done, `frontend-e2e` runs but does not gate the deploy** —
`.github/workflows/frontend-e2e.yml`, excluded from `resolve`'s `needs:` in
`release.yml`. The exception is dated: `test_the_e2e_exception_is_real_visible_
and_expiring` in `backend/core/tests/test_deployment_topology.py` fails after
**2026-10-31**, which is deliberate. Put `frontend-e2e` back into `resolve`'s
`needs:` and delete that test when the specs are green.
