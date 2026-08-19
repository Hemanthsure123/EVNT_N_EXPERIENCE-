# Frontend — Event & Experience Platform

The Next.js frontend. Five slices exist:

1. **Foundation** — the design system as the single source of truth, the
   performance baseline, the typed data layer, the component library + app shell.
2. **Discovery** — everything from the landing page up to opening an event: the
   personalised home, deep search with grouped autocomplete, the browse page
   (compact banner, sticky filter toolbar, slide-over filter panel, grid/list),
   and the city/category landing pages.
3. **The event page** — the conversion surface: hero and lightbox, live
   countdown, real ticket tiers with uncached availability, a sticky ticket
   panel, organiser, venue and directions, FAQs and policies.
4. **The booking funnel** — tickets → sign-in (only if needed) → review →
   payment. It reserves real inventory, holds it against a real deadline, and
   hands off to Razorpay Checkout.
5. **The operator console** (`/admin`) — platform overview, verifications
   queue, organizations, users and settlements, gated on `is_staff`.

Browsing is **public**: there is no auth gate anywhere in the discovery layer.
Sign-in is offered in the header and at `/sign-in`, and appears as a funnel STEP
only for a visitor without a session — it gates checkout and the console, never
browsing. All three render the same panel.

## Stack

Next.js 14 (App Router, RSC) · TypeScript · Tailwind CSS 3 · next/font (Plus
Jakarta Sans / JetBrains Mono) · Radix UI primitives · TanStack Query ·
react-hook-form + zod · Framer Motion · lucide-react · Storybook · Vitest +
Testing Library · Playwright + axe · ESLint + Prettier + Stylelint.

## Getting started

```bash
cd frontend
cp .env.local.example .env.local     # NEXT_PUBLIC_API_BASE_URL etc.
npm install
npm run dev                          # http://localhost:3000
```

The app needs a backend on `http://localhost:8000`. Either works:

```bash
docker compose up          # at the repo root — the real backend
npm run mock:api           # or the fixture (see below), same port, same contract
```

Open **/** for the discovery funnel and **/style-guide** for the living style
guide (every token and component, light and dark).

### The fixture backend (`npm run mock:api`)

`scripts/mock-api.mjs` is a dependency-free Node server that reproduces the real
`GET /api/v1/events` and `GET /api/v1/events/{id}/ticket-types` contracts
**exactly** — cursor pagination, the `{data, meta}` envelope, the error envelope,
the same `Cache-Control`/`ETag` headers as `backend/core/http_caching.py`
(including the tiers endpoint's much shorter 5s TTL), and real PNG posters so
`next/image` and LCP measurements are honest. Tiers are derived from each
event's own `from_price` and `tickets_available`, so a card and its event page
can never disagree — the same invariant `ticketing` maintains for real.

The posters carry real **film grain**, and that is a measurement decision as much
as a visual one: Chrome excludes images below ~0.05 bits/pixel from LCP entirely,
treating them as placeholders. A smooth synthetic gradient optimises so well that
the event page's hero landed at 0.046 bpp and was skipped — handing LCP to
whatever text painted last, and reporting 5s. With grain it optimises to ~35KB
AVIF at 0.55 bpp, which is where real event photography sits, and the numbers
below became representative rather than pathological. It listens on **port 8000, the port the real backend
uses**, so nothing in the app or its config is fixture-aware: you run one or the
other. Playwright starts it automatically, which is what makes the E2E suite
deterministic without Postgres/PgBouncer/Redis in CI.

## Design system as the single source of truth

- **`styles/tokens.css`** is the ONLY file with raw values. Colours are stored
  as RGB channels (so opacity utilities work) in two layers: primitive brand
  ramps, and **semantic role tokens** (`--background`, `--primary`, `--border`,
  …) that remap per theme. Everything downstream references tokens by name.
- **`tailwind.config.ts`** is a thin projection of those tokens — utilities like
  `bg-primary`, `text-h1`, `rounded-xl`, `shadow-glow`, `duration-fast` all
  resolve to CSS variables. Swap a token and the whole app reskins.
- **Theming** (`lib/theme`) defaults to the system preference, persists an
  explicit toggle, and sets the theme class before hydration (no flash).
- **Enforced, no raw values:** a custom ESLint rule (`local-rules/no-raw-values`)
  fails the build on any hex colour or arbitrary px in TS/TSX; Stylelint's
  `color-no-hex` does the same for CSS. Try planting `#ff0000` — CI goes red.

### Layout primitives

Four decisions carry the whole page's consistency, and each lives in exactly one
place:

- **8pt grid.** Every gap, pad and rhythm is a multiple of 8px; 4px is the only
  sanctioned half-step, for icon-scale gaps. Tailwind's scale is 4px-based, so
  the discipline is in which steps get used.
- **One vertical rhythm.** `--space-section` / `--space-section-lg` (24/32px) are
  the _only_ section padding. Adjacent sections each contribute it, so the gap a
  reader sees is double — 48px mobile, 64px desktop. Retune the page by editing
  two values.
- **Radius by role**, not by eye: `md` buttons/inputs, `lg` medallions, `xl`
  cards, `2xl` panels and heroes, `full` pills.
- **Two glass recipes, and only one of them blurs.** `.glass` (real
  `backdrop-filter`) is used on exactly one surface: the scrolled header.
  `.glass-media` — chips and buttons over artwork — is a solid translucent scrim
  with no filter, because it appears on every card in a grid and twenty
  backdrop-filters measurably hurt INP. Over a photograph the two look the same.
  It is also NOT theme-adaptive: what's behind it is a photo, so it stays dark in
  both themes (using `.glass` there renders white text on a white frost in light
  mode).
- **Motion is tokenised too**: `--duration-reveal` / `--duration-carousel` and a
  single `--ease-spring` that decelerates hard without overshooting. Nothing
  bounces, nothing loops, nothing floats.

`Section`, `SectionHeader` and `Panel` in `components/discovery/section.tsx` are
the only way blocks get their spacing and framing, which is what keeps the page
reading as one document rather than a stack of widgets.

### The header is a width budget, not a wish list

`components/shell/header.tsx` is the chrome (three columns, condense on scroll);
`site-header.tsx` composes it. The row was rebuilt after it was found painting
its own nav underneath the search field at every desktop width.

**It is TWO rows now** — the search moved out of the bar into a full-width row
of its own, which is what finally ended the budget fight described below. See
"The header is two rows" under the discovery layer. Everything in this section
still governs row one.

**What broke it, because the shape recurs.** The columns were
`[1fr auto 1fr]` with `min-w-0` on both sides — equal side tracks do centre the
middle one on the container, which is why it was written that way. But the
middle track was `auto`, sized by a 448px search field, and `min-w-0` let the
side tracks shrink _below their content_. So the nav overflowed its own column
and drew on top of the search: at 1280 and 1440 "Hire a band" and "More" sat
behind it, and at 1024 "Hire a band" wrapped onto three lines while "More" was
sliced in half. **None of it moved `documentElement.scrollWidth`**, so the
existing "no horizontal overflow" test passed the entire time. A layout can
destroy itself without the page ever scrolling sideways; the regression test
now measures the boxes against each other.

The columns are `[auto minmax(0,1fr) auto]`: sides sized by content and unable
to shrink below it, search absorbs the rest. The items carry the other half
(`shrink-0`, `whitespace-nowrap`) — a track that refuses to shrink is only half
a defence if its contents happily wrap.

**The budget.** The container caps at 1280px, so the widest this row ever gets
is ~1232px — a 1920px monitor buys nothing. Brand (~140) + nav + search + four
44px controls (~260) has to fit inside that; the old bar asked for six nav pills
_and_ a 448px search, needing ~1350px. It was over budget at every width it was
ever displayed at. So the nav thins by breakpoint — `md` Categories · Hire a
band, `lg` + Events, `xl` + Cities — and **everything it drops is in the
Categories menu at exactly the widths it is gone**, which is what makes trimming
a layout decision instead of a product one. Home left the bar entirely: a pill
next to a wordmark that already links home spends the most valuable slot on the
one destination nobody needs help finding.

**Motion, and why none of it is Framer.** The active pill is one element that
SLIDES between items (`nav-rail.tsx`): a background that swaps instantly says
where you are, one that travels says where you came from. `layoutId` is the
obvious way to write that and the wrong one — Framer is confined to the booking
funnel so its ~35KB never lands on the discovery routes, and this component
sits in the site layout. Measuring two boxes and transitioning a transform is a
dozen lines and no bytes. Before hydration the active item wears the identical
pill as a plain class and drops it in the same layout effect that places the
real one, so the handover is never a frame of both or neither; transitions arm
one frame after the first placement, so it never slides in on arrival.

**The progress bar reports real pending state** (`route-transition.tsx`).
`useTransition` around `router.push` is the only thing in the App Router that
knows when a navigation has actually resolved. Starting a fake bar on click and
stopping it on a pathname change cannot see a cancelled or failed navigation, so
it sticks at 90% forever — a progress indicator that can lie about progress is
worse than none. It waits 140ms before drawing anything (a prefetched route
resolves in a frame; a bar that flashes reads as jank), and modified clicks
—⌘, ctrl, shift, middle — are handed back to the browser untouched.

## Performance baseline

- Server Components by default; Client Components only where interactive.
- Route-level `loading.tsx` skeletons; streaming via Suspense with
  content-shaped fallbacks.
- `next/image` (AVIF/WebP) everywhere, with a reserved aspect box on every
  poster — **zero CLS by construction**; self-hosted fonts with `display: swap`;
  `optimizePackageImports` for icons.
- Web Vitals reporting wired (`lib/vitals`) with the budget **LCP < 2.5s,
  CLS < 0.1, INP < 200ms**; `npm run check:bundle` guards JS footprint in CI.
- SEO: Metadata API defaults, JSON-LD helpers (Event, ItemList, WebSite +
  SearchAction, BreadcrumbList), `sitemap.ts`, `robots.ts`.

### Caching, aligned end to end

The public reads are cached on **one clock**, not three: the backend sends
`s-maxage=30` on `GET /events`, so the Next data cache, the ISR interval for the
home/city/category pages, and TanStack Query's `staleTime` all use the same 30s
(`PUBLIC_LIST_REVALIDATE_SECONDS` in `lib/api/events.ts`).

| Route                | Rendering    | `Cache-Control`                       |
| -------------------- | ------------ | ------------------------------------- |
| `/`                  | Static + ISR | `s-maxage=30, stale-while-revalidate` |
| `/cities/[city]`     | SSG + ISR    | `s-maxage=30, stale-while-revalidate` |
| `/categories/[slug]` | SSG + ISR    | `s-maxage=30, stale-while-revalidate` |
| `/events`            | Dynamic      | `private, no-store` (per-query)       |

The home page stays fully static **and** personalised: the ISR'd HTML carries
the national "Trending" row, and the client swaps in the city-filtered one once
a city is known. Nothing per-user is ever read during the server render.

### Measured Core Web Vitals

Lab measurement of the production build (`next start`) in Chromium with the
`web-vitals` attribution build — the same library the app reports with. The
throttled profile is 4× CPU + ~1.6 Mbps / 150 ms RTT, i.e. roughly a mid-range
phone. Interactions driven for real: opening the ⌘K palette and typing on home;
on results, a toolbar chip, opening the filter panel, applying a filter from it,
switching to list view, and a scroll.

Ranges are across multiple runs at each profile (single-sample INP is noisy).

| Page           | LCP (4×)      | CLS (4×)      | INP (4×)     | LCP / CLS / INP unthrottled     |
| -------------- | ------------- | ------------- | ------------ | ------------------------------- |
| `/` (home)     | 1.51 – 1.79 s | 0.075 – 0.081 | 232 – 248 ms | 0.32–0.46 s / ≤0.105 / 56–88 ms |
| `/events`      | 1.29 – 1.56 s | 0.090 – 0.162 | 456 – 584 ms | 0.32–0.36 s / 0.000 / 72 ms     |
| `/events/[id]` | 1.28 – 2.26 s | 0.000 – 0.003 | 168 – 184 ms | 0.30–0.34 s / 0.000 / 16 ms     |

**These numbers are a re-baseline, not a regression.** They were taken after the
fixture's posters gained grain (see above), which roughly tenfold-increased their
encoded size to match real photography. Everything on every page therefore
decodes real bytes now; the earlier, lower figures were flattered by images no
real catalogue would ship. The event page — the newest and heaviest route — is
the only one currently inside every budget on the throttled profile.

**What is over budget, stated plainly:**

- `/events` INP (456–584 ms at 4×) and its interaction CLS (up to 0.162) are both
  the grid↔list relayout: twenty cards changing shape, now with real AVIF decode
  behind them. At 4× CPU that work lands outside the 500 ms window in which the
  browser excludes input-driven shifts, so it scores. Unthrottled, CLS is 0.000
  and INP is 72 ms.
- `/` CLS (0.075–0.105) is a font-swap shift in the hero: the block grows from
  404px to 621px as the display face replaces its fallback. It was always there;
  heavier images simply moved the swap later, past more of the paint. It is a
  home-page issue, untouched by this slice, and the fix is metric-matched
  fallbacks rather than anything in the components.

**LCP clears the budget on both profiles, everywhere.**

**CLS** is 0.000–0.002 unthrottled everywhere. The 0.065 on `/events` at 4× is a
single source: switching between grid and list re-lays out every card, and at 4×
CPU that relayout lands outside the 500 ms window in which the browser excludes
input-driven shifts. It is under budget, it is a layout change the user asked
for, and on unthrottled hardware it is excluded entirely. Two shifts that were
NOT acceptable were found by measuring and fixed: the filter bar used to grow a
row when the first filter was applied, pushing the whole grid down (0.068), and
the post-apply `scrollIntoView` used to animate while results were being
replaced under it.

Four things took `/events` INP down, each found by attributing the interaction
rather than guessing:

1. **Radix's modal mode cost 1080 ms to open the filter panel** — it sets
   `pointer-events: none` on `<body>` and injects a scroll-lock stylesheet, so
   the whole document's style and layout are invalidated. `modal={false}` plus a
   hand-rolled focus trap (`lib/utils/focus-trap.ts`) took it to ~300 ms. Same
   root cause, and now the same shared fix, as the ⌘K palette.
2. **The overflow row re-measured every chip on every tap** (157 ms). Its item
   array is rebuilt whenever a filter changes — the chips carry live pressed
   state — so the layout effect re-read twelve `offsetWidth`s inside the
   interaction. Keying re-measurement on the item _keys_ skips it.
3. **A full-viewport `backdrop-filter` on the drawer scrim.** Removed; over a
   dimmed page it is nearly indistinguishable from the scrim alone. Real blur is
   reserved for the two small persistent bars.
4. **The grid now lags the controls** by a frame (`useDeferredValue` on both the
   filters and the view mode), so a chip paints its pressed state without
   waiting on twenty cards re-rendering behind it.

INP clears the budget comfortably unthrottled (40–104 ms) but sits **above** the
200 ms line on the 4× profile for `/` — the home page carries a lot of DOM
(featured card, 4×2 category grid, trending strip) and its two heaviest
interactions scale with page size. That is stated rather than rounded away. Both
pages are far below where this started (~2.8 s), via findings worth recording
because they generalise beyond the components they were found in:

- **A modal dialog invalidates the whole document.** Radix's modal mode puts
  `pointer-events: none` on `<body>` and injects a scroll-lock stylesheet; both
  are global, so opening an overlay forces a full style + layout pass — **~1.7 s**
  for the ⌘K palette, **~1.08 s** for the filter panel, on the 4× profile.
  `modal={false}` brings them to ~0.22 s and ~0.30 s. What modal mode was buying
  is restored explicitly and scoped to the panel, once, in
  `lib/utils/focus-trap.ts`.
- **`element.focus()` flushes layout**, and `{ preventScroll: true }` does not
  avoid it. Profiling attributed ~970 ms of one interaction to a single `focus()`
  call — because the dialog had just mutated document-level styles, and focus was
  simply what flushed them.
- **`backdrop-filter` does not scale**, with card count or with area. A frosted
  chip on every card cost ~100 ms of INP on the results grid; a full-viewport
  frosted scrim behind the filter panel cost about as much on its own. Blur now
  appears on exactly two small persistent bars in the whole app, and nowhere that
  is large or repeated.
- **A layout effect that re-measures on every render is a hidden cost inside the
  interaction.** The toolbar's overflow row rebuilds its item array whenever a
  filter changes (the chips carry pressed state), which re-read twelve
  `offsetWidth`s per tap — 157 ms. Keying the measurement on the item _keys_
  rather than the array identity skips it.

Three CLS regressions caught the same way and fixed: swapping a full results grid
for an empty state collapsed the page height (**0.101**, over budget — the
results region now reserves a floor); the filter bar grew a row when the first
filter was applied, pushing the entire grid down (**0.068** — the row is now
always present and always says something); and the post-apply `scrollIntoView`
animated while results were being replaced under it (now conditional on the grid
actually being off-screen, and never smooth).

Reproduce with `npm run build && npm run start` plus the throttled Chromium
harness described above; `npm run check:bundle` guards the JS footprint in CI
(largest discovery route: 155 KB gz referenced-JS upper bound, budget 220 KB).

## Data layer

`lib/api` — a typed fetch client (base URL from env, bearer auth with transparent
refresh-on-401, the backend error envelope → typed `ApiError`), a TanStack Query
provider with sane defaults, and hooks. `lib/api/events.ts` is the one place that
knows how to talk to `GET /events`: query-string building, cursor extraction from
the backend's `meta.next`, and a never-throwing `fetchEventsSafe` so one failed
row can't take a page down. Types are hand-aligned now; run `npm run gen:api` to
regenerate `lib/api/schema.d.ts` from the backend OpenAPI schema once the
contract is frozen.

## SEO

Most of this was already in place — `app/robots.ts`, `app/sitemap.ts`, per-route
`generateMetadata`, canonicals on eighteen routes, `Event` / `BreadcrumbList` /
`ItemList` / `WebSite` / `FAQPage` JSON-LD, edge-generated OpenGraph cards,
`noindex` on every private surface, one `<h1>` per page. Five things changed.

**Event URLs are `/events/{slug}-{uuid}`.** The uuid is the identity; the slug is
readable text the backend derives from the title and sends on every payload
(`lib/events/ref.ts` concatenates, never re-derives — a slug computed on both
sides eventually disagrees, and a canonical tag that disagrees with the sitemap
is an SEO fault nobody notices for months). Because the uuid is always there,
**no link can break**: a bare `/events/{uuid}` — every link shared before slugs
existed, every ticket email, every organizer bookmark — still resolves, and 308s
to the canonical URL. So does a stale slug after a rename.

**That redirect is `middleware.ts`, and it has to be.** It was written in the
page and in `generateMetadata` first, and neither can emit an HTTP status:
`app/(site)/loading.tsx` gives the route group a Suspense boundary, so Next has
already flushed the shell and downgrades the redirect to a CLIENT-side
navigation encoded in the RSC stream. A browser follows it and looks fine;
Googlebot sees `200 OK` with an empty shell. The middleware costs the hot path
nothing — a canonical URL already carries its slug, so only a segment that is
exactly 36 characters is looked up — and every failure falls through to
`next()`, because the bare URL renders perfectly well on its own.

**The sitemap lists every live event and every published performer**, with each
row's real `updated_at` rather than the build time (`GET /events/sitemap`,
`GET /performers/sitemap`). Event pages carry the `Event` structured data and are
the only pages anybody searches for, and they were in no sitemap at all —
reachable to a crawler only by walking landing pages that show twenty events
each with no paginated URLs. Both feeds degrade to `[]` on failure: an exception
in `sitemap.ts` does not lose the event URLs, it takes `/sitemap.xml` down.

**Structured data is derived, never assumed.** `eventJsonLd` hard-coded
`EventScheduled` and `InStock`, so a sold-out show advertised itself as buyable
and a cancelled event told Google it was going ahead. Both now come off the row,
and `availability` is omitted rather than guessed when nothing has counted the
tickets. `JsonLd` also escapes `<` — every value in those blocks is an
organizer's own title or venue, and `JSON.stringify` keeps the JSON valid while
the HTML parser happily ends the script at the first literal `</script`.

**A filtered browse URL canonicalises to the landing page that owns it.**
`/events?category=comedy` → `/categories/comedy`, `?city=Mumbai` →
`/cities/mumbai`, anything else → `/events`. Without it every filter permutation
was an indexable near-duplicate competing with the prerendered landing pages
built to rank for exactly those queries.

**A URL that does not resolve now returns a real 404.** `notFound()` inside
these routes renders the right page with a `200` — a soft 404, which Google
crawls, may index, and reports in Search Console. Two hypotheses were tested and
eliminated by rebuilding without them (`app/(site)/loading.tsx` and
`app/(site)/not-found.tsx`), and the standalone server production actually runs
behaves the same as `next start`, so the cause is inside Next's streaming rather
than this app's boundaries. The middleware sets the status for the cases it can
decide with no new I/O — a segment that is not an event ref, an event whose
(already-happening) lookup 404s, and a city outside the curated list — and
`NextResponse.rewrite` with a status keeps the styled page, so this is not a
trade between a correct status and a good error page. `/hire/{id}` would need a
lookup per request and is left in BACKLOG 80.

`tests/e2e/seo.spec.ts` asserts all of it against a production build.

## Discovery layer

### The home page's reading order

**Recommend, then list, then navigate.** A visitor arrives in one of three
states — "show me something good", "show me what's on", "I know roughly what I
want" — and the first three blocks answer exactly one each, in descending order
of how many people are in that state:

| block | job | component |
| --- | --- | --- |
| hero carousel | ONE event, full width, in its own colour | `hero-carousel.tsx` |
| All Events | chips + a poster grid of what is on sale | `all-events.tsx` |
| Browse by mood | eight ways in for somebody with no plan | `category-tiles.tsx` |
| Hire a band | the second product, its own tinted band | `hire-a-band-section.tsx` |
| Why / newsletter | the trust argument, then the one ask | — |

**The hero commits to one event.** Date, title, venue, from-price and a single
black CTA, beside the poster, over a blurred blow-up of that same poster — so
each slide takes the colour of the event it shows without anybody picking a
colour per event. The rail it replaces put five posters on screen at once,
which is a shelf: five things at a fifth of the attention each, and no room for
any of them to say when it is or what it costs.

**It does not autoplay.** A banner that advances on a timer moves the CTA out
from under a pointer already travelling towards it and restarts the decision
every few seconds. Chevrons, dots, arrow keys and a swipe are all explicit.

**Below `md` the same slides are a peeking rail** — one component, one set of
keyboard behaviours. A 360px split of nothing is not a hero.

**The chips under "All Events" are real filter URLs.** Each is `browseHref(...)`,
so it is shareable, back-buttonable and server-rendered, and the compiler
enforces that a chip cannot encode a param the browse page does not parse.
"Tomorrow" has no named window in that vocabulary (today / weekend / week /
month), so it is the one-day RANGE it actually is, computed per render — frozen
at module scope it would mean the day after whichever day the bundle was built.
The reference design's "Under 10 km" is deliberately absent: distance needs
coordinates most events do not have and a parameter `GET /events` does not
accept, and a chip that silently returned everything is a filter that lies.

**One h1, and it is not drawn.** The biggest text on the first screen is the
name of an event, and the hero's title cannot be the h1 because it changes on
every chevron press. So the h1 is `sr-only`, first in the document, and names
the page; everything below is an h2.

### The header is two rows

Row one is identity and place — wordmark, city switcher, nav, account. Row two
is one thing: the search field, full width, on every breakpoint.

The single-row header this replaces had all five competing for ~1232px and the
search field lost every time — squeezed to ~240px at `lg`, replaced by an icon
below that. Giving it its own row costs 56px and ends the width fight: the nav
no longer thins out by breakpoint, so every destination is visible at every
desktop width instead of disappearing one by one on the way down.

The reference hides its nav row once scrolled, leaving the search docked alone.
That was built here and then **taken back out**: this row also carries the
account control, so collapsing it left a signed-in visitor with no route to
their tickets or sign-out until they scrolled back to the top. The row condenses
instead. Hiding the only path to the account menu is not a layout decision.

The nav carries OUR four destinations. The reference's bar carries seven —
Dining, Movies, Stores, Play — because that company sells seven things. Copying
the shape of a nav is a design decision; copying its contents would be shipping
links to pages that do not exist.

### Typography

One family, two roles. **Plus Jakarta Sans** — a geometric grotesque with
near-circular bowls, a tall x-height and a 200–800 axis — covers both the 56px
extrabold hero line and the 13px medium chip label, separated by weight and
tracking rather than by family. The Space Grotesk / Inter pairing it replaces
was two skeletons that disagreed, which is why the old headings read as a
different product from the paragraphs under them. `--font-display` and
`--font-sans` remain separate variables so putting a real display face back is a
change to `lib/theme/fonts.ts` and nothing else.

The colour palette is unchanged. Every token in `styles/tokens.css` is the same
one it was; what moved is layout, type and density.

### The browse page

`/events` is the compare-and-decide surface, and it's shaped differently from the
home page on purpose: home is there to make you want something, browse is there
to let you rule things out quickly.

- **No permanent sidebar.** A filter column spends ~280px of every viewport,
  forever, on controls used once at the start of a session. That column is worth
  roughly one more card per row, which is the page's actual job. The full set
  lives in a slide-over — a bottom sheet on phones, a left panel from `lg`, one
  `side="responsive"` drawer so the contents are written once.
- **The toolbar never scrolls sideways and never wraps.** `OverflowRow` measures
  what fits and moves the rest into "More filters" — every category at 1440px,
  six at 1024px, none on a phone, with the remainder always one tap away in the
  same panel. Breakpoint rules can't do this honestly: whether a chip fits
  depends on its text, which no breakpoint knows.
- **Two lines, always.** The second row is never conditional, because a bar that
  grows when you apply a filter pushes the whole grid down. It shows the applied
  filters when there are any and how the list is ordered when there aren't.
- **Draft-then-apply in the panel, live in the toolbar.** Live filtering is right
  for a chip whose result is visible behind your finger, and wrong for a panel
  that covers the grid — there, every tap would refetch results nobody can see.
- **Three columns, not four.** Four across at 1280px leaves ~296px per card,
  below the width at which a title, a venue line and a price all fit without
  truncating. Three gives ~400px and turns the poster into photography.
- **Grid or list, remembered.** A grid is for scanning by poster; a list puts
  date, price and venue at the same x-position down the page, which is what
  actually makes five events comparable.
- **Not virtualised, deliberately.** `content-visibility: auto` on off-screen
  cards already skips their layout and paint, while keeping every card in the
  DOM — so find-in-page, screen-reader browse mode, "open in new tab" and the
  reserved scroll height all keep working. A windowing library trades all of that
  away and fights the reserved min-height that holds CLS at zero.

**The banner's photograph is a real one**: the top result's own poster, blurred
and scaled past the frame. Stock imagery would depict an event nobody can book,
and a flat gradient looks like a placeholder because it is one. It arrives as a
server-rendered slot so the image is in the initial HTML while the statistics
beside it stay live.

**Every number on it is a floor**, rendered as "24+ events". The backend uses
cursor pagination precisely to avoid a `COUNT(*)` per browse request, so an exact
total doesn't exist to show — see BACKLOG.md item 11.

### What the browse page does not show, and why

The redesign brief asked for an interested count, ratings, "trending"/"new"/
"verified"/"family friendly" badges, and Distance / Language / Rating /
Accessibility / Duration filters. **None of them are built.** The platform
records none of them, and a filter that silently matches everything — or a badge
nobody computed — is only discovered after being trusted, on a page whose job is
to be trusted with someone's money.

What ships instead is derived from columns the backend actually maintains:
Sold out / Few left / Selling fast / Free from `tickets_available` and
`from_price`; a time-of-day filter from `starts_at` (exact, not approximate); and
an organiser facet built from the loaded pages, so every option offered is
guaranteed to match something already on screen. Card CTAs say "View", not "Book
tickets", because checkout doesn't exist yet. BACKLOG.md item 12 lists each
missing filter against the field it would need.

### The event page

The conversion surface, and the first page on this site where being wrong costs
money rather than attention. The reading order is the argument: photograph and
title (do I want this), countdown and availability (can I still go), tickets
(what does it cost), then organiser, venue, FAQs and policies (can I trust this)
— long-form last, because nobody reads it until they're already interested.

- **Inventory is never cached.** Tiers are fetched `no-store` on the server and
  re-verified in the browser (`staleTime: 0`, refetch on focus, once a minute
  while open). Everything else public here rides a shared 30-second clock; this
  is the one read where staleness costs money in both directions — selling a
  ticket that doesn't exist, or turning away someone who could have bought one.
  It is why the route is `force-dynamic`: ISR'ing the page would ISR the tiers.
- **The tiers are real.** `GET /events/{id}/ticket-types` exposes `name`,
  `price`, `quantity`, `sold`, `available` and `max_per_order`, which is where
  every number on the page comes from — the availability line, the "N booked"
  count, the per-tier "only 3 left", and the quantity ceiling.
- **Rank comes from price order, not from the tier's name.** "Basic/Gold/
  Premium" is one organiser's vocabulary; the next will say "Early bird/
  Regular". The top tier gets elevation and a ring, the entry tier stays flat,
  and sold-out tiers stay visible and disabled — knowing the ₹499 tier is gone
  is what makes the ₹1,099 one make sense.
- **One ticket panel, placed by the grid.** It is not duplicated per breakpoint:
  source order gives the mobile reading order, and at `lg` explicit row/column
  placement moves the single instance into the sticky rail. An earlier version
  rendered it twice and put two `id="tickets"` anchors in every document.
- **The mobile bar is not a second CTA.** It appears only once the panel has
  scrolled away, and its button scrolls back to the panel rather than starting a
  parallel booking flow.
- **The countdown is hydration-safe**: the first client render deliberately
  matches the server's (a reserved, empty frame), and digits arrive on the first
  tick. Rendering `Date.now()` during render mismatches on every load, and React
  patches it silently — which is how countdowns flash a wrong value.
- **The lightbox is not a Radix dialog** — it's ~20 lines with the same Escape,
  outside-click and focus-trap behaviour (via `lib/utils/focus-trap.ts`), and
  none of modal mode's document-wide style invalidation.

**What the event page does not show, and why.** No rating (no review system), no
"interested" count (nothing records interest), no verified-organiser badge (the
verification flow exists in the backend but its outcome is not on the event
payload — and an unchecked trust badge is the worst thing to fake on a ticketing
site), and no embedded map with a pin (the backend stores a venue name and a
city, no coordinates, so any pin would be a guess drawn at street precision).
The gallery is one image because the payload has one image. Directions hand the
venue and city to Google Maps, which is the search that actually resolves them.
BACKLOG.md items 14–16.

### The booking funnel

Four routes under one layout, which is the whole architecture in a sentence:
Next keeps a layout mounted while its children change, so the stepper and the
summary card are never re-created. The summary animates its height between
steps instead of snapping, its poster is fetched once for the journey, and the
total counts from the old value to the new rather than blinking.

- **The selection is the URL** (`?tickets=<tierId>:<qty>`). React state dies on
  refresh, `sessionStorage` can't be linked, and there is no server session — a
  query string survives reload, back/forward, a shared link and a crash. That
  matters most exactly here, because someone who loses their basket at the
  payment step does not rebuild it.
- **Sign-in is a conditional STEP, not a hidden one.** The stepper renders three
  entries for a signed-in visitor and four otherwise. Showing someone a step
  they will never reach makes the journey look longer at the moment they decide
  whether to continue.
- **Inventory is reserved at REVIEW, not at step one.** Holding stock while
  someone is still comparing tiers — or worse, while they create an account —
  takes tickets off sale for people ready to buy, and the hold would routinely
  expire before payment. `POST /bookings` takes a per-tier row lock, decrements
  availability, and starts the hold timer the summary counts down.
- **Every reserve carries a derived `Idempotency-Key`**, built from the event and
  the exact quantities rather than randomly. A double-tap, a retry on a flaky
  connection, and a reload-then-continue all resolve to ONE booking; the backend
  dedupes on `(user, key)` and returns the original.
- **Razorpay loads only when the button is pressed** — verified in the E2E suite,
  which asserts `window.Razorpay` is undefined until then. It's a third-party
  script on the highest-intent route; every visitor who abandons before payment
  should not pay for it.
- **The browser's success callback is not proof.** The backend confirms a booking
  only from the signed server-to-server webhook, so the confirmation screen polls
  `GET /bookings/{id}` until the backend itself says `paid`. Showing a tick
  because a client callback fired would congratulate someone for a payment the
  system hasn't recorded — and on this platform that same step is what issues
  the tickets.
- **No live key configured? It says so.** The default backend runs
  `PAYMENTS_BACKEND=fake` with an empty `RAZORPAY_KEY_ID`. The page shows the
  real order id and stops. Nothing is simulated: a confirmation screen for money
  that never moved is the one thing a checkout must never produce.
- **Framer Motion is used here and nowhere else**, for the two things CSS can't
  do — animating to an unknown height, and interpolating a number. Everything
  else still animates with the design system's own tokens.

**What the funnel does not have, and why.** No guest checkout: issuing a ticket
requires a user to issue it to. No promo-code field: there is no coupon endpoint,
and an input that always answers "invalid code" implies discounts exist and that
you failed to find one. No taxes line: the backend returns `total_amount` and
`platform_fee` and nothing else. And no editable name/email/phone form —
`/auth/me` is GET-only and `phone` isn't on the serializer, so the screen shows
the account tickets will actually reach rather than a form whose contents would
be discarded. BACKLOG.md items 17–19.

**The platform fee is shown but never added.** It is the platform's cut taken OUT
of the total at settlement, not a surcharge, so it appears as a note under the
total. Adding it as a line would overstate the price by exactly the fee, which on
a checkout isn't a rounding error.

### Signing in

There is **one** auth surface — `components/auth/auth-panel.tsx` — rendered by
the standalone `/sign-in` route and by the funnel's step 2. Two copies of a
sign-in form is how the two drift, and a checkout is a bad place to find out that
the funnel's copy never got phone sign-in.

- **The header carries the control.** Anonymous visitors get a Sign in button
  that remembers where they were (`?next=`); signed-in ones get an account menu.
  Auth resolves on the client, so the unresolved state renders a **same-sized
  placeholder** rather than guessing "anonymous" — otherwise every signed-in
  visitor watches a Sign in button turn into their own avatar.
- **The account menu is the only link to `/admin`,** and only for staff
  (`is_staff` from `/auth/me`). Before this, the console had no door.
- **`?next=` is validated as a same-origin path** (`safe-next.ts`). "We'll send
  you back where you came from" is exactly the affordance an open redirect
  abuses, and a `startsWith('/')` check waves `//evil.example` straight through.
  The rejected forms are unit-tested.
- **Google, Apple and phone/OTP are built, and say so when they can't work.**
  `apps/accounts` still exposes email + password only, so each of those controls
  fails instantly with a plain sentence naming the provider — never a spinner,
  never a success that didn't happen. An auth control that appears to work is
  the worst thing on the site to fake, because a ticket and a payment are
  attributed to whoever it claims you are. Turning either on is one env var
  (`NEXT_PUBLIC_OAUTH_BASE_URL`, `NEXT_PUBLIC_PHONE_AUTH_ENABLED`) and no
  component change. BACKLOG.md item 19.
- **The panel uses no animation library.** Its sliding mode indicator is one
  element and a CSS transform; Framer Motion stays confined to the funnel.

### The operator console

`/admin`, in its own route group so it inherits none of the attendee site's
header, footer or bottom nav — an operator needs the viewport for tables.

**It required a backend.** The platform had exactly ONE admin endpoint before
this (`POST /admin/settlements/{id}/release`): no platform stats, no users or
organizations list, no verification queue, no activity feed, no time series,
and no way for the frontend to even tell whether the signed-in user was staff.
So `apps/console` was built first (see the repo's CLAUDE.md), and every widget
here reads a real endpoint. Nothing on this screen is illustrative.

- **The guard is UX, not security.** Every `/admin/*` endpoint enforces
  `is_staff` server-side; the shell only decides what to render while the
  browser waits, and renders nothing until auth resolves so an operator never
  sees "access denied" flash before their own dashboard.
- **Charts are plain SVG**, drawn from the design tokens. A charting library is
  40–100KB gzipped and arrives with its own colours, fonts and tooltips, all of
  which then have to be fought back into this design system. A line, an area,
  bars and a donut are a few dozen lines of path maths, they theme correctly in
  both modes for free, and every one ships a visually-hidden table of the same
  numbers so a screen reader gets the data rather than the word "chart".
- **One `DataTable`** carries sorting, filtering, column visibility, search,
  bulk selection and bulk actions, so a new admin list is a column definition.
  Sorting and search are client-side over the LOADED pages — the list endpoints
  are cursor-paginated with a fixed server ordering — and the footer says so
  every time there are more pages. Sorting one page while implying you sorted
  the platform is how an operator reaches the wrong conclusion.
- **Loading, empty and error are three different states**, everywhere. An early
  version rendered a failed request as an empty chart, which reads as "the
  platform earned nothing" rather than "the query broke".
- **The notification centre reports work queues, not messages.** There is no
  notifications table; what exists is real backlog — verifications awaiting a
  decision, payouts that dead-lettered — and those are the things that actually
  need an operator. "Real-time" is a 30-second poll while the tab is visible; a
  websocket for two counters would be infrastructure with nothing to carry.
- **⌘K searches real records** — sections, organizations and users. Bookings and
  tickets are absent because no admin lookup endpoint exists for them, and an
  empty "Bookings" group teaches an operator the platform has none.
- **Quick actions only offer what leads somewhere.** "Create admin" and "Create
  announcement" have no endpoint, so they are not on the page.

### The domain

`lib/discovery` is the domain: the eight categories, the served cities, the
filter codec (URL ⇄ filters ⇄ backend query), IST-anchored date windows,
money/date formatting, and the availability badge rules.

The filter model has **two explicit tiers**, and the split is visible rather than
hidden. Tier A (`toServerQuery`) is what the backend really accepts today: `q`,
`city`, and a date range. Tier B (`clientRefinement`) is price banding and price
sorting, which the backend has no support for — those refine the loaded pages,
the UI says so, and the results view keeps pulling pages until it has enough
matches. When the backend grows `min_price`/`sort`, they move from one function
to the other and no component changes. Every such gap is written up in
[BACKLOG.md](./BACKLOG.md), and each code site points at its item number.

## Real integrations only

A dedicated audit pass removed every mocked, placeholder and simulated
capability from this app. The full record — every credential, webhook, callback
URL, SDK, env var and manual step — is `REAL_INTEGRATIONS_AUDIT.md` at the repo
root. Three things changed here.

**The subscribe card was the one outright fake, and is now real.** It called
`Notification.requestPermission()` and, on success, said _"Notifications are on
for this device"_. The permission was real; everything the sentence implied was
not — nothing subscribed, nothing was stored, and no code path could send
anything. Somebody who granted it would stop checking the page, trusting they
would be told.

It is now Web Push end to end: `lib/push/use-push.ts` asks the SERVER whether
push is configured **before** touching the browser, registers the worker served
from `app/sw.js/route.ts`, requests permission only on a press, subscribes, and
stores the subscription. The `on` state is reached only once the server has it.
Reminders arrive through the same exactly-once ledger that owns email and SMS.

The ordering is the fix. Asking for a browser permission before knowing the
server can send is what produced the original problem — a permission is consent
to use a feature, not the feature.

**Push can be unavailable for five unrelated reasons and each gets its own
sentence**: this deployment has no VAPID keys, this browser has no push, the
page is not on https, you are not signed in, you blocked it. A single
greyed-out button would be a shrug at all five.

**A production build now fails without its public URLs.**
`NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_SITE_URL` used to fall back to
localhost — right in development, catastrophic in production, and silent in
both. A build with them unset emitted a sitemap, canonical tags and OpenGraph
URLs pointing at `localhost:3000`, which search engines index exactly as
written, and every server-rendered page called an API on the container's own
loopback. `lib/api/config.ts` throws instead, which fails `next build` before a
deploy rather than after one.

**The service worker deliberately does nothing but push.** No fetch
interception, no response caching, no offline shell. A worker that quietly
serves stale HTML is how a ticketing site shows a sold-out event as available;
offline support is a decision to take on purpose, not to acquire as a side
effect of wanting notifications.

## Hire a Band — the marketplace

`/hire`, `/hire/[id]`, `/hire/new`, `/hire/requests` — the platform's second
product, over `apps/performers`.

**It is a marketplace, not a checkout.** A customer posts one brief — what,
where, when, how much — and every act that fits answers with a real quote. Four
steps, because those are the four things a performer needs before they can put
a number on it, and asking them one at a time is what makes nine fields feel
like a conversation. The form is fully usable signed out; sign-in is asked for
at the END, because asking before somebody has said what they want is how a
marketplace loses the people it is for.

**Accepting a quote is the one irreversible action in the product**, so it is
the one place that keeps an explicit confirm rather than offering undo — there
is no compensating write that un-declines four performers already told they
lost. The copy says exactly what will happen before the click.

**Nothing on a card or a profile is invented.** Price, city, travel radius,
years and the verification badge are all stored columns. There are **no stars
and no review counts** — nothing records a review, and a five-star row on a
decision worth tens of thousands of rupees is the worst possible thing to
fabricate. The trust argument is made from what can actually be checked. A
null price renders "Price on ask", which is a real answer some acts give, and
the budget filter still includes them rather than quietly removing the
expensive end of the market.

**The filter options are derived, not declared.** Cities, genres and languages
come from `/performers/facets`, computed server-side over live rows — a
hard-coded genre list would offer filters that return nothing.

## The Performer Studio

Where an act runs its side of the marketplace. `/studio` picks an act,
`/studio/new` creates one, and eight screens sit under `/studio/[id]`:
overview, leads, pipeline, calendar, profile, photos, analytics, preview.

**It is scoped to one act, not to an account.** An organisation may list a DJ
and a live band; leads are matched per act, quotes belong to an act, and a
profile IS an act. So the id is in the URL and the switcher changes it, rather
than the studio showing a merged view nobody could act on.

**The profile editor autosaves against the optimistic lock.** `Performer` has a
`version` column and `PATCH` refuses a stale one with `409`. So exactly one save
is in flight at a time, the version is taken from each response, a save
requested mid-flight is queued rather than raced, and a 409 offers a **reload**
— never a retry, because retrying a conditional update with a refreshed version
is precisely how you clobber the edit the lock just protected.

**Photos: alt text is collected before the bytes go up.** The server refuses a
photo without it, so asking afterwards would mean sending six megabytes and
then rejecting them — and alt text written while looking at the picker is real
alt text, where a field appended to a finished grid gets "image1". Drag, drop
and ⌘V paste all work; each upload shows real progress (`XMLHttpRequest`, which
`fetch` still cannot do) and can be cancelled or retried individually. The
first photo is the marketplace card, which the manager labels rather than
leaves to be discovered. **Reordering is stated, not offered** — `position` is
written at upload and there is no PATCH on a media row, so a drag handle would
revert on reload (BACKLOG 70–72).

**Five pipeline lanes, all real.** The brief asked for seven. _Negotiation_ has
no state — a quote is pending or decided, and there is no counter-offer object
— and _Accepted_ and _Booked_ are the same event, because accepting closes the
brief and books the act in one transaction. Two lanes holding identical rows
teach somebody there is a step they are missing. _Performed_ is honest: an
accepted quote whose date has passed, derived from a stored date rather than a
status somebody forgot to set.

**The calendar is an agenda, not a grid.** Confirmed bookings and open briefs,
soonest first. There are no green "available" cells, because nothing stores
availability — a performer may be booked elsewhere, ill, or simply not want
that Saturday, and a calendar that says otherwise is a promise the platform
cannot keep (BACKLOG 74).

**Analytics counts, and names what it cannot count.** Quotes sent, win rate,
booked value, average quote — each a count or sum over the act's own rows.
Win rate is accepted ÷ **decided**, with pending quotes excluded from the
denominator (counting an unanswered quote as a loss makes a performer's rate
drop every time they bid) and `null` until something is decided, because a rate
over zero decisions is not 0%, it is unknown. Profile views, conversion,
impressions and peer comparison are listed as **not measured**, with the reason
— this is the screen someone uses to decide whether to lower their price, so a
proxy wearing the right label is worse here than a gap (BACKLOG 75).

**The preview renders the marketplace's own components.** `PerformerProfile`
and `PerformerCard`, fed by `toPublicShape(act)`. A preview built from a second
set of markup is a preview that quietly stops being true. The public API cannot
serve this — `GET /performers/{id}` 404s for anything unapproved, which is
every profile at the moment it most needs previewing.

**One backend change, and only one.** `OwnerPerformerSerializer` now carries
`photos`: the public detail has them but 404s for a draft, so without it an
owner could upload a photo and never see it again while their profile was
unapproved. One grouped query attached in the view, so a twenty-act list costs
one photo query (BACKLOG 78). Everything else consumes what already existed.

## The landing page

Rebuilt around one purpose per section: hero → featured → categories → **Hire
a Band** → trending → cities → why Curatix → newsletter.

**The change is hierarchy, not colour.** The old page ran four event rails in a
row — featured, editor's pick, trending, selling fast — which is four
variations of one card doing one job. Repeating a card is how a page gets long
without getting more useful: by the third rail nobody reads the heading, so the
editorial distinction stops paying for the scroll it costs. There are now two
rails with genuinely different jobs (what a human chose, and what is actually
selling), and the space that bought is spent on whitespace and on the second
product rather than on a fifth rail. Selling-fast is gone as a section because
Trending's cards already carry real urgency badges computed from remaining
stock.

**The Dynamic Island is untouched**, as the brief required.

**Hire a Band sits on a tinted band with its own rhythm** — it is the one place
on the page a second background appears. Everything above it sells a ticket to
somebody else's event; this sells a service for the visitor's own, and rendered
as another rail it would be scrolled past as more of the same.

**The eight type tiles ARE the section.** A "Featured acts" scroller used to
follow them and was removed: on the landing page it answered a question nobody
had got to yet, and it put a visitor in front of one specific act — with a
price — before they had said a word about their own event. The job here is to
reach the brief or the index; choosing an act is `/hire`'s job, where the
filters and the full roster are. Its removal also took a server request off the
front page's critical path.

That section also had **no width cap at all**: it used `max-w-content`, which is
not a token, so it resolved to nothing and the section ran full-bleed with its
own gutters — putting its heading 72px left of every other heading on the page
at 1440. The tint made a full-bleed band look deliberate, which is why it read
as a rendering glitch rather than as the missing class it was. It uses
`Container` now, like every other section.

### Buttons on the landing page

`components/discovery/cta.tsx` is the marketing surface's button, deliberately
NOT `components/ui/button.tsx`. That one is the whole app's, including the
checkout's, and the design system is explicit that a screen where somebody
types a card number should not be playful. The flourish lives where the
flourish belongs and cannot leak into the funnel, because the funnel does not
import it.

Three beats, applied consistently across the page's tiles, chips, city cards
and CTAs so it has one interaction language rather than six:

1. **Hover lifts** 2px and deepens the shadow — the idiom the tiles already
   used.
2. **Press puts it back down** and scales to 0.98. This is the beat that was
   missing _everywhere_: things rose when you pointed at them and then did
   nothing when you clicked, which reads as the click not registering. The
   press cancels the lift on purpose, which is what a physical button does.
3. **Icons and arrows move in the direction they mean** — the forward arrow
   slides right, the city card's ↗ leaves up and to the right.

The **sheen sweep** on the primary CTA is the one frankly decorative thing, and
a considered exception to "decorative motion is deleted": one control, on
deliberate hover, one composited transform, nowhere else on the page. It is
declared only in the `hover:` state so it sweeps in and SNAPS back rather than
travelling backwards when the pointer leaves. Under `prefers-reduced-motion` it
is `display: none` — removed, not shortened.

## The Admin Operations Center

`/admin/*` — eleven surfaces over `components/admin/`, sharing the organizer
platform's table engine and attention pattern, adapted to operating a platform
rather than running events.

**Three rules specific to this console:**

- **A health tile is never green because nobody looked.**
  `/admin/health` renders PROBED checks (database, cache — contacted on every
  request) differently from CONFIGURED ones (payments, storage, queue, bus,
  email, SMS — which report `unknown` plus which adapter is wired up).
  `unknown` gets its own icon and the words "not contacted", not a pale green.
  A local/fake adapter is called out explicitly, because "console adapter" on
  an email tile in production means no customer is receiving anything.
- **Reversible actions get undo, not a confirmation dialog.**
  `components/admin/undo.tsx`. The write goes IMMEDIATELY and Undo issues the
  compensating write — it is not a five-second delay pretending to be an
  action, because an operator who closes the tab during a countdown would find
  nothing had happened. ⌘Z works, and skips text fields so the browser's own
  undo still does what someone mid-edit expects.
- **A section nothing backs is absent, not empty.** There is no Support nav
  item, no chargebacks tab, no manual-review queue and no latency chart. Each
  would show an invented number on the screen operators trust most. The health
  page goes further and NAMES what is not measured, and why.

**Also here:** an attention panel that escalates on the OLDEST wait rather than
on volume (ten events submitted this morning is a normal Tuesday; one submitted
nine days ago is an organizer who has concluded the platform ignores them);
moderation with status tabs, bulk approve (never bulk reject — one reason
pasted across twenty events fits none of them) and the decision note shown on
every decided row; a payments console over the real ledger; user management
with suspension; and a CMS Studio whose preview frames the REAL homepage in an
iframe rather than a hand-built mock that would drift.

**Table engine upgrades**, shared with the organizer platform: multi-sort
(shift-click appends, and the precedence number shows only when more than one
key is active), column pinning, a compact/comfortable density toggle, and named
saved views. Views are `localStorage` — the honest scope for one operator's
shortcuts on one machine; sharing them is BACKLOG item 59.

Backend dependencies named rather than faked: a support desk, operational
telemetry, unapproved-event preview, chargebacks, manual payment review,
organizer documents and warnings, incidents and deployments, admin booking
lookup, CMS draft preview, cities/trending/banners, shared views and
transactional bulk edits — **BACKLOG items 49–60**, each with the model,
endpoint, permission, migration, job and caching requirement it needs.

## The Organizer Operations Platform

`/dashboard/*` — nine surfaces over `components/organizer/`.

**The home page answers three questions, in order of how expensive each is to
miss.** What needs attention comes first even though it is usually empty: a
rejected event loses sales for every hour it goes unseen, whereas yesterday's
revenue will still be there after lunch. Then today's numbers, then what is
coming up, then the live feed.

- **The attention engine** (`lib/organizer/attention.ts`) derives every item
  from a real row — an event an operator sent back, a payout the vendor
  refused, an event starting within a week with nothing sold, a cluster of
  refunds on one day. Nothing is a heuristic or a nudge. **An empty list is the
  good outcome and is drawn that way**, with a calm all-clear rather than
  manufactured tasks; an organizer who learns this panel only speaks when
  something is wrong will read it every morning. A failed READ renders as an
  error, never as an all-clear.
- **One table engine** (`lib/organizer/table.ts`,
  `components/organizer/data-table.tsx`) behind Events, Bookings and Refunds:
  a real `<table>` with `position: sticky` headers on the PAGE scroll (not an
  inner overflow box, which traps the wheel and breaks browser find), resizable
  columns via pointer events with keyboard resizing too, a column chooser
  persisted per surface, roving-tabindex row navigation, bulk selection that is
  **pruned against rows that still exist**, and CSV export.
- **The CSV export neutralises formula injection.** A customer name beginning
  `=`, `+`, `-` or `@` executes as a formula when the file opens in Excel —
  that is a real path out of our data into someone's spreadsheet. Covered by
  `lib/organizer/table.test.ts`.
- **Sorting says it is client-side.** These lists are cursor-paginated on a
  fixed server ordering, so sorting can only reorder the rows already loaded.
  The footer says so whenever another page exists. BACKLOG item 42.
- **Filters live in the URL** on every surface, debounced into it rather than
  written per keystroke, with dismissible chips so "why am I seeing four rows"
  is answerable at a glance.
- **Date ranges go to the server.** `toISOString()` (ending in `Z`), because an
  unencoded `+05:30` arrives as a space and the filter silently does nothing.
- **Check-in** offers three real input paths: a handheld USB/Bluetooth reader
  (the field handles it natively and re-focuses after every scan), the camera
  via the browser's own `BarcodeDetector` — **zero bytes**, and offered only
  where the browser has it rather than as a dead button in Safari — and typing.
  The verdict is a full-width band readable at arm's length plus a sound that
  differs in PITCH DIRECTION, so either channel alone keeps the queue moving.
  Offline scans are **queued, never green**: a gate that flashes admitted while
  offline would admit two people on one ticket.
- **The booking inspector's timeline is derived, not fabricated.** Four stored
  facts determine the lifecycle completely because it only has four states;
  steps whose time is not stored say "Time not recorded" rather than borrowing
  another step's clock.

What is deliberately absent, each because no endpoint backs it: a notification
centre (there is no per-organizer notification store, so it could only show a
list this client invented), Delete on events (`PROTECT`ed by bookings, tickets
and settlements), Duplicate (no transactional endpoint), a refund approval
queue, scheduled publishing, a Cancelled status, page views and conversion,
traffic sources and device types, customer tags and notes. Each is written up
as BACKLOG items 36–48 with the model and endpoints it would need.

## The Event Creation Studio

`/dashboard/events/new` — eight steps (basics, venue, schedule + running order,
tickets, media, details + FAQs, search, review) over
`components/organizer/wizard/`.

- **Local-first autosave.** `POST /events` needs a title, venue, city AND a
  future start time all at once, so nothing can reach the server until step 3.
  Every keystroke goes to `localStorage` immediately and the server write fires
  the moment the draft becomes creatable. A draft written by an older build is
  merged onto a fresh one rather than used as-is — `undefined.trim()` on a
  field added since is a white screen holding someone's half-written event.
- **Every step that needs a saved draft says which fields unlock it** rather
  than rendering a form that 404s. Gallery images, FAQs and the running order
  all hang off an event id.
- **The blank fields are sent, not omitted.** `toPatchInput` puts every content
  field on the wire including the empty ones — that is what makes CLEARING
  work, because a missing key means "leave it alone" to the serializer. Verified
  end-to-end against live Django, not assumed.
- **Uploads use `XMLHttpRequest`**, the only place in this codebase that does:
  `fetch` has no upload-progress event, and a spinner that cannot say "40%" is
  the difference between "it is working" and "it has frozen". `uploadMedia`
  returns `{promise, cancel}`, because a cancel button that cannot cancel is
  worse than no cancel button.
- **Alt text is collected BEFORE the bytes go up.** The server refuses a file
  without it, so asking afterwards would mean uploading six megabytes and then
  refusing them — and text written while looking at the picker is real alt text
  where a field appended to a finished grid gets "image1".
- **The live preview applies the SAME fallback chain the public page does**
  (`seo_title || title`, `seo_description || short_description || derived`).
  Reproducing a different chain is how a preview quietly stops matching the
  page it previews.
- **Keyboard:** ⌘S save, ⌘Z / ⇧⌘Z undo-redo (skipped inside a text field, so the
  browser's own per-field undo still works), ⌥←/→ between steps, ⌘↵ to add an
  FAQ. The close guard fires only while a save is actually outstanding — a
  blanket one is the dialogue everyone learns to dismiss without reading.

What it deliberately does NOT offer, each because no endpoint backs it:
cropping and renditions, drag-to-reorder media, in-place editing of an FAQ or
timeline entry, video upload, scheduled publishing, archive, and version
history. Each is named on its own step as a sentence rather than a disabled
control, and written up as [BACKLOG.md](./BACKLOG.md) items 14, 16 and 35.

## Scripts

| Command                                 | What                                                   |
| --------------------------------------- | ------------------------------------------------------ |
| `npm run dev` / `build` / `start`       | Next dev / prod build / serve                          |
| `npm run mock:api`                      | Fixture backend on :8000 (real `GET /events` contract) |
| `npm run typecheck`                     | `tsc --noEmit`                                         |
| `npm run lint` / `lint:css`             | ESLint (incl. no-raw-values) / Stylelint               |
| `npm run test` / `test:coverage`        | Vitest + Testing Library                               |
| `npm run e2e`                           | Playwright smoke + axe (light + dark)                  |
| `npm run storybook` / `build-storybook` | Component library                                      |
| `npm run check:bundle`                  | Bundle-size budget (run after `build`)                 |
| `npm run gen:api`                       | Regenerate typed API from the backend OpenAPI schema   |

## Structure

```
app/(site)/        the public discovery shell: home, /events, /events/[id],
                   /cities[/city], /categories/[slug], /booking/[eventId]/*, /sign-in
app/(admin)/       the operator console: /admin and its four lists
app/               root layout, providers, style-guide, sitemap/robots, error states
components/ui/     primitives (Button, Input, Select, Modal, Toast, …) + stories + tests
components/shell/  Header (condensing, slots), NavRail (sliding active pill), CategoriesMenu,
                   RouteTransition (real pending state + progress bar), Footer, BottomNav,
                   Container, ThemeToggle, SiteHeader/SiteBottomNav (the shell's composition)
components/discovery/  EventCard, rails, grid, category tiles, spotlight, filter bar,
                       results view, location card, trust strip, home sections
components/search/     the ⌘K command palette + its triggers and shared context
components/event/      the event page: hero + lightbox, countdown, live ticket panel
components/booking/    the four funnel steps, the persistent summary, motion helpers
components/auth/       the one sign-in panel, /sign-in screen, header account control
components/admin/      console shell, data table, SVG charts, palette, notifications
components/consent/    cookie consent
lib/api/           typed client, events read path, query provider, hooks, types
lib/discovery/     categories, cities, filter codec, date windows, format, availability
lib/booking/       the URL selection codec, totals, idempotency key, Razorpay loader
lib/auth/          AuthProvider (three states, token confirmed against /auth/me)
lib/admin/         console query hooks and formatting
lib/search/        suggestions provider, recent + popular searches
lib/location/      geolocation soft-ask + shared city state
lib/theme/         tokens bridge, fonts, ThemeProvider
lib/seo/ lib/vitals/   metadata, JSON-LD, web-vitals
scripts/mock-api.mjs   the fixture backend
styles/            tokens.css (source of truth) + globals.css
```

> Both faces are **Plus Jakarta Sans** — see "Typography" above for why one
> family covers display and body. `--font-display` and `--font-sans` are still
> separate variables, so putting a distinct display face back is a one-line
> change in `lib/theme/fonts.ts` and nothing else moves.
