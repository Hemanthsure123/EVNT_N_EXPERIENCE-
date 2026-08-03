# Curatix — Design System

**Status:** authoritative. Where a future brief conflicts with this document,
this document wins. Where this document conflicts with `styles/tokens.css`,
**the code wins and this document is wrong** — fix it here in the same commit.

`styles/tokens.css` already cites `§4`, `§5.2`, `§7`, `§8` and `§10` of this
document. Those citations were dangling until now; the section numbering below
matches them exactly, so the code and the prose finally point at each other.

---

## §0 · How to use this document

Three rules govern everything below.

1. **Tokens are the only vocabulary.** Components reference semantic tokens
   (`--primary`, `--surface`), never primitives (`--violet-600`) and never raw
   values. This is enforced, not encouraged: the `no-raw-values` ESLint rule
   (`eslint-local-rules/index.js`) fails the build on a hex literal or a
   Tailwind arbitrary pixel value anywhere in TS/TSX. The single exception is
   `styles/tokens.css`, which is where raw values are _supposed_ to live.

2. **One ecosystem, three permission sets.** Attendee, organizer and admin
   share the same tokens, components, motion and interaction grammar. What
   changes between roles is _which_ navigation entries and actions exist —
   never the design language. A screen should be recognisable as Curatix
   before you can tell which role is looking at it.

3. **Nothing ships that the data cannot support.** A component that renders a
   rating, a trend, or a count the backend does not maintain is a bug in this
   system, not a gap in the backend. See §13.6.

### What is built vs. what is specified

This document covers both. Every component section is marked:

- **[Built]** — exists in `components/`, used in production paths.
- **[Partial]** — exists but does not yet meet the spec below.
- **[Spec]** — not built. The spec is binding when it is.

Being honest about this is the point: a design system that describes an
imaginary component library is how teams stop trusting the document.

---

## §1 · Philosophy and brand personality

### 1.1 The one-sentence brief

> Curatix sells access to things people are excited about, and handles their
> money while doing it. The interface has to feel like **both** — energetic
> enough to make a Friday night feel close, calm enough that entering a card
> number feels safe.

That tension resolves in a consistent way throughout: **energy lives in the
content, calm lives in the chrome.** Posters, gradients and motion belong to
event imagery and brand moments. Tables, forms, money and settings are quiet,
neutral and dense. A revenue figure never gets a gradient.

### 1.2 Personality

| We are    | We are not |
| --------- | ---------- |
| Confident | Loud       |
| Precise   | Clinical   |
| Warm      | Playful    |
| Fast      | Frantic    |
| Editorial | Decorative |

### 1.3 The reference set, and what we take from each

Naming a reference is useless without naming the _specific_ thing borrowed.

- **Linear** — density with air. Rows are compact; the page still breathes.
  Keyboard-first, and the shortcut is discoverable rather than secret.
- **Stripe** — money is rendered plainly. Tabular numerals, no decoration, and
  a caption that says exactly what a number counts.
- **Notion** — progressive disclosure. The complex thing exists, one level in.
- **Airbnb** — photography leads on discovery surfaces, and typography carries
  everything else.
- **Vercel / GitHub** — restraint in the admin. Chrome recedes; content is the
  interface.
- **Shopify** — the account switcher, and role-scoped navigation inside one
  identity (§12.4).

What we deliberately do **not** take: Material's elevation-as-decoration,
Bootstrap's component-per-colour, and the dashboard-template habit of filling
every viewport with cards because the space is there.

---

## §2 · Principles, in priority order

When two principles conflict, the earlier one wins. This ordering is the useful
part — an unordered list of virtues resolves no arguments.

1. **Truthfulness.** Never render a number, badge or state the system cannot
   substantiate. A dash beats a fabricated zero.
2. **Accessibility.** AA contrast, full keyboard operation, and a visible focus
   ring are not negotiable against aesthetics.
3. **Hierarchy.** Every screen has exactly one primary action. If you cannot
   name it, the screen is not designed yet.
4. **Reduce cognitive load.** Fewer choices, better defaults, plain language.
5. **Consistency.** A component behaves identically everywhere. A surprise is a
   defect even when it is an improvement.
6. **Performance.** Interaction under 150ms; no layout shift; the LCP element
   is never behind a client fetch.
7. **Whitespace.** Space is a component. Removing a divider is usually better
   than adding one.
8. **Progressive disclosure.** Show the 80% case; keep the rest one level in.
9. **Alignment before decoration.** Fix the grid before adding a shadow.
10. **Elegant motion.** Motion explains a change. If it does not explain
    something, delete it.

---

## §3 · Layout, spacing and grid

### 3.1 The 8pt grid

Every gap, pad and rhythm is a multiple of **8px**. Tailwind's scale is 4px
based, so the discipline is _which steps are used_:

| Use                                                 | Tailwind           | px   |
| --------------------------------------------------- | ------------------ | ---- |
| Icon-scale gaps (the **only** sanctioned half-step) | `gap-1`, `gap-1.5` | 4, 6 |
| Inside a control                                    | `gap-2`, `p-2`     | 8    |
| Between related elements                            | `gap-3`            | 12   |
| Component padding                                   | `p-4`              | 16   |
| Between components                                  | `gap-6`            | 24   |
| Between page sections                               | `gap-8`            | 32   |

**Never** `gap-5`, `gap-7`, `gap-9`, `p-5`. They are off-grid and read as
mistakes at scale even when no individual instance looks wrong.

Canonical section rhythm is a token, not a habit:

```
--space-section:    1.5rem;  /* 24px — mobile  */
--space-section-lg: 2rem;    /* 32px — lg up   */
```

Adjacent sections each contribute this, so the gap a reader perceives is
**double** the token: 48px mobile, 64px desktop. This trips people up; it is
documented in the token file for that reason.

### 3.2 Containers

| Token             | Width  | Used by                                              |
| ----------------- | ------ | ---------------------------------------------------- |
| `max-w-container` | 1280px | Attendee site — reading-length pages                 |
| `max-w-dashboard` | 1600px | Organizer + admin — nine-column tables need the room |
| `max-w-prose`     | ~65ch  | Body copy, policies, any long text                   |

A table stretched across an ultrawide is unreadable, not impressive. Content is
always capped and centred; only the _background_ is full-bleed.

### 3.3 Breakpoints

Mobile first. Design at 360, verify at every stop.

| Name     | Min width | What changes                                          |
| -------- | --------- | ----------------------------------------------------- |
| _(base)_ | 360px     | Single column. Bottom nav. Drawers are bottom sheets. |
| `sm`     | 640px     | Two-column forms.                                     |
| `md`     | 768px     | Table columns begin appearing. Bottom nav retires.    |
| `lg`     | 1024px    | Sidebar becomes permanent. Two-column layouts.        |
| `xl`     | 1280px    | Third column (live preview, inspector rail).          |
| `2xl`    | 1536px    | Container caps; no new content.                       |

**Rule:** a breakpoint may change _layout_ and _density_. It may never change
_which_ information exists. Hiding a column on mobile is fine; hiding an action
is not — move it, don't drop it.

### 3.4 Application shells

Three shells, one grammar.

- **Attendee** — header (56/64px, condenses on scroll), full-bleed content,
  footer, bottom nav below `md`.
- **Organizer / Admin** — sidebar (280px expanded, 80px collapsed, state
  remembered in `localStorage`) + sticky 56px top bar whose breadcrumb _is_ the
  page title. A separate `<h1>` repeating the breadcrumb is the single largest
  waste of vertical space in most admin UIs; we do not do it.
- **Focused flows** (checkout, wizard) — chrome reduced to a progress
  indicator and an exit. Nothing competes with the task.

---

## §4 · Colour

Two layers, always. **Primitives** are theme-independent raw ramps.
**Semantics** are role tokens that flip per theme. Components reference _only_
semantics.

```
--violet-600            ← primitive.  Never referenced by a component.
--primary               ← semantic.   Always reference this.
```

### 4.1 Brand

- **Violet** is the brand. `violet-600` is primary in light; it lifts to
  `violet-400` in dark for contrast against dark surfaces.
- **Magenta/pink** is the accent — used sparingly, for a single point of
  emphasis per view.
- **Indigo** exists only as a gradient stop.

### 4.2 Semantic roles

| Token                                            | Role                                         |
| ------------------------------------------------ | -------------------------------------------- |
| `background` / `foreground`                      | Page base and default text                   |
| `surface` / `elevated`                           | Card base; raised surfaces (menus, popovers) |
| `muted` / `muted-foreground`                     | Recessed fills; secondary text               |
| `border`                                         | Hairlines                                    |
| `primary` (+ `-hover`, `-active`, `-foreground`) | Brand actions                                |
| `secondary` (+ `-foreground`)                    | Selected/active chrome                       |
| `accent`                                         | Single-point emphasis                        |
| `success` / `warning` / `destructive`            | Outcome states                               |
| `*-subtle` / `*-subtle-foreground`               | **Tint pairs** — see below                   |
| `ring`                                           | Focus                                        |
| `overlay`                                        | Scrims                                       |
| `on-gradient`                                    | Text over a gradient or photo                |

### 4.3 Tint pairs are mandatory

Every semantic hue ships a `-subtle` background **and** a
`-subtle-foreground`. Coloured text on a coloured tint is where contrast dies,
so the pair is pre-verified to clear AA and must be used together:

```tsx
// correct — the pair
<p className="bg-warning-subtle text-warning-subtle-foreground" />

// wrong — unverified combination
<p className="bg-warning-subtle text-warning" />
```

### 4.4 Status colour is semantic, never decorative

A colour means one thing product-wide:

| Meaning                                     | Tone                 |
| ------------------------------------------- | -------------------- |
| Succeeded, live, admitted, paid             | `success`            |
| Needs attention, pending, expiring, re-scan | `warning`            |
| Failed, denied, refunded, destructive       | `destructive`        |
| Informational, in review, neutral-active    | `info` / `secondary` |
| Inert, archived, draft                      | `neutral` / `muted`  |

Never introduce a colour to distinguish two things that mean the same. Never
encode meaning in colour **alone** — pair it with a label or icon (§14.3).

### 4.5 Gradients

Three (`brand`, `royal`, `sunset`), reserved for brand moments: hero
atmosphere, the auth mode toggle, avatar medallions. **Never** behind body
text, data, money or forms. Text over a gradient uses `on-gradient`.

### 4.6 Dark theme

Dark is a **first-class peer**, not an inversion. Only semantic tokens change:

- Surfaces are near-black slate, not pure black — pure black with a light
  overlay produces halation.
- Primary lifts one step (600 → 400).
- Shadows deepen **and** gain a hairline border, because shadow alone is nearly
  invisible on a dark surface.
- Glass frosts denser and the hairline brightens, or the edge disappears.

Every screen must be checked in both. A component that only works in one is
unfinished.

---

## §5 · Typography

### 5.1 Pairing

| Family  | Token          | Use                                 |
| ------- | -------------- | ----------------------------------- |
| Display | `font-display` | Headlines, brand moments, `h1`–`h2` |
| Sans    | `font-sans`    | Everything else                     |
| Mono    | `font-mono`    | IDs, tokens, payment refs, code     |

Mono is not stylistic. It signals _"this is an exact string you may need to
copy or read aloud"_ — payment references, QR tokens, slugs.

### 5.2 The scale

Ten steps. There is no eleventh; if you need one, you need a different layout.

| Token          | Size / line      | Weight | Use                       |
| -------------- | ---------------- | ------ | ------------------------- |
| `text-display` | 48 / 56, -0.02em | 700    | Hero only                 |
| `text-h1`      | 36 / 44, -0.02em | 700    | Page title                |
| `text-h2`      | 30 / 38, -0.01em | 600    | Major section             |
| `text-h3`      | 24 / 32          | 600    | Section                   |
| `text-h4`      | 20 / 28          | 600    | Card title, KPI value     |
| `text-body-lg` | 18 / 28          | 400    | Lead paragraph            |
| `text-body`    | 16 / 24          | 400    | Default                   |
| `text-body-sm` | 14 / 20          | 400    | Dense UI, tables          |
| `text-label`   | 13 / 16          | 500    | Buttons, form labels      |
| `text-caption` | 12 / 16          | 500    | Metadata, counters, hints |

Negative tracking on large sizes only — it tightens display type and damages
readability below 24px.

### 5.3 Rules

- **Never skip a level for emphasis.** Use weight or colour.
- **Body copy is capped at `max-w-prose`.** A 1600px-wide paragraph is unreadable.
- **All numbers that align in a column use `tabular-nums`.** Money, counts,
  percentages, timestamps. Proportional digits make a column of figures jitter.
- **Sentence case everywhere**, including buttons and headers. Title Case is
  slower to read and reads as marketing.
- **Uppercase only for `text-caption`** with `tracking-wide`, and only for
  table headers and eyebrow labels.

---

## §6 · Iconography, imagery, elevation of content

### 6.1 Icons

Lucide, `currentColor`, stroke only. Sizes: `size-3.5` (inline caption),
`size-4` (default UI), `size-5` (buttons/nav), `size-6` (brand).

- An icon **beside** a label is `aria-hidden`; the label is the accessible name.
- An icon **alone** requires `aria-label`.
- Never an icon-only control for a destructive or irreversible action.

### 6.2 Imagery

- Event posters are **3:2** on cards, **4:5** portrait, **21:8** full-bleed —
  named `aspect-*` tokens, never arbitrary ratios.
- Every image box reserves its space before load. No CLS, ever.
- Posters must clear ~**0.05 bits/pixel** of entropy or Chrome classifies them
  as low-entropy placeholders and refuses them as the LCP element. This is not
  theoretical — it cost us a 5s LCP on the event page, fixed by making the
  fixtures representative.

---

## §7 · Radius

One ladder, applied **by role**, never by eye.

| Token          | px  | Role                                           |
| -------------- | --- | ---------------------------------------------- |
| `rounded-sm`   | 8   | Controls _inside_ controls (a chip in a field) |
| `rounded-md`   | 12  | Buttons, inputs, menu items                    |
| `rounded-lg`   | 16  | Medallions, small tiles, inline panels         |
| `rounded-xl`   | 20  | Cards                                          |
| `rounded-2xl`  | 24  | Panels, sheets, hero surfaces                  |
| `rounded-full` | ∞   | Pills, avatars, switches                       |

**Nesting rule:** an inner radius is always one step _below_ its parent.
Equal radii nested inside each other read as a rendering error.

---

## §8 · Elevation and surfaces

### 8.1 The ladder

Shadows are soft and **cool-tinted** (slate-900 alpha), never harsh black.

| Token         | Use                                         |
| ------------- | ------------------------------------------- |
| `shadow-sm`   | Resting card, sticky bar once scrolled      |
| `shadow-md`   | Hover lift, dropdown                        |
| `shadow-lg`   | Popover, drawer, modal                      |
| `shadow-xl`   | Command palette — the top layer             |
| `shadow-glow` | Brand emphasis on a primary CTA. Sparingly. |

### 8.2 Elevation is meaning, not decoration

Height encodes **how transient** a surface is. A permanent card never floats
above a temporary menu. In dark theme every elevated surface pairs its shadow
with a border, because shadow alone does not read.

### 8.3 The z-index scale

Corrected once already, and the fix is worth remembering: `sticky` used to
outrank `dropdown`, so a `Select` opened from a sticky filter bar rendered
_underneath it_ — the options were there, just unclickable.

| Token      | z    | Rationale                             |
| ---------- | ---- | ------------------------------------- |
| `sticky`   | 1000 | Page chrome is furniture              |
| `dropdown` | 1100 | A conversation always beats furniture |
| `drawer`   | 1200 |                                       |
| `modal`    | 1300 |                                       |
| `popover`  | 1400 |                                       |
| `toast`    | 1500 |                                       |
| `tooltip`  | 1600 | Never occluded                        |

Never write a raw `z-index`. If something needs to sit between two steps, the
layering is wrong.

---

## §9 · Blur and glass

`--blur-glass: 16px`, surface alpha `0.85`, hairline alpha `0.08`.

**Glass is only ever applied to thin, small, persistent surfaces**: the header
strip, a floating control, a chip over a poster.

Never full-viewport. A `backdrop-filter` across the whole page is the single
most expensive paint this application can request, and it measurably lengthened
drawer-open time on a throttled CPU. Modal and drawer scrims are a **plain
tinted scrim** (`bg-overlay/70`) — over a dimmed page the difference is
invisible, and the cost is zero.

Glass also only earns its keep over _content_. The header applies it **only
once scrolled**; at rest there is nothing behind it to blur, so the filter
would be pure cost.

---

## §10 · Motion

### 10.1 Durations

| Token      | ms  | Use                          |
| ---------- | --- | ---------------------------- |
| `fast`     | 120 | Hover, focus, colour         |
| `base`     | 200 | Most transitions, accordions |
| `slow`     | 320 | Drawers, modals              |
| `page`     | 400 | Route transitions            |
| `reveal`   | 500 | Section reveals              |
| `carousel` | 600 | Carousel advance             |

### 10.2 Curves

| Token         | Curve                            | Use                         |
| ------------- | -------------------------------- | --------------------------- |
| `ease-out`    | `cubic-bezier(0.2, 0, 0, 1)`     | Entrances — the default     |
| `ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)`   | Moves between two positions |
| `ease-spring` | `cubic-bezier(0.22, 1, 0.36, 1)` | Emphasis                    |

`ease-spring` decelerates hard **without overshooting**. A true bouncing spring
draws attention to the animation instead of the content — we do not bounce.

### 10.3 Rules

- **Motion explains a change of state.** Decorative motion is deleted.
- **Animate `transform` and `opacity` only.** Animating layout properties
  causes jank and, on entrance animations, delays LCP.
- **Never start content at `opacity: 0` on first paint.** This made the booking
  funnel's LCP 4.86s: everything was LCP-ineligible until hydration. Entrance
  transitions run on _navigation_, never on arrival.
- **`prefers-reduced-motion` is honoured everywhere.** `motion-reduce:` is not
  optional decoration; a vestibular disorder is not an edge case.

---

## §11 · Components

### 11.1 Buttons **[Built]**

Sizes `sm` 36 · `md` 44 · `lg` 48 · `icon` 44. Variants: `primary`,
`secondary`, `ghost`, `destructive`, `link`.

- **One primary per view.** Two primaries means neither is.
- Minimum touch target **44×44** on any touch surface.
- `loading` swaps in a spinner and disables — but the button **keeps its
  width**, or the layout jumps under the user's finger.
- Destructive actions are never the default focus target.

### 11.2 Inputs, textareas, selects **[Built]**

44px tall. Label always visible — placeholders are not labels; they vanish
exactly when the user needs them.

The error contract is non-negotiable and is why the field primitives are
shared: `aria-invalid` on the control, `aria-describedby` pointing at the
message, and **the message line is reserved whether or not it is shown**. An
error appearing must never shove the next field down the page.

Character counters use the _same_ number the server enforces, and turn amber at
**80%** — a warning that arrives once you are over is not a warning.

### 11.3 Checkbox · Radio · Switch **[Built]**

Checkbox = multi-select. Radio = one of few. Switch = an immediate on/off with
no Save. **A switch that requires a subsequent Save is a checkbox**; using the
wrong one is the most common form-control error in admin UIs.

### 11.4 Tabs **[Built]** · Accordion **[Built]**

Tabs for peer views (≤5). Accordion for progressive disclosure of long content.
Both fully arrow-key navigable, with `aria-selected` / `aria-expanded`.

### 11.5 Tooltip **[Built]**

Supplementary only. **Never the sole source of information** — it is
unreachable on touch and unreliable for screen readers. If it matters, it is
visible text.

### 11.6 Tables **[Built]**

The workhorse of both dashboards.

- Sticky header (`top-14`, under the top bar).
- Row height 40–44px; `text-body-sm`; numerics right-aligned + `tabular-nums`.
- **The row is the control** — `tabIndex`, `role="button"`, Enter/Space
  activate. Making the whole row clickable but only the title focusable is the
  usual half-measure that breaks keyboard use.
- Columns hide by breakpoint (`hidden md:table-cell`), never by horizontal
  scroll on the page body. Wide content scrolls in its own container.
- **When sorting or filtering applies only to loaded pages, the footer says
  so.** Sorting one page while implying you sorted everything is how an
  organizer concludes their best event is their worst.
- Virtualisation is **not** the default. With cursor pagination the DOM never
  holds more than was asked for, and a virtualizer costs a dependency, breaks
  Ctrl+F, and fixes every row height. Reach for it only alongside server-side
  sort.

### 11.7 Cards **[Built]**

`rounded-xl`, `border-border`, `bg-surface`, `p-4`. Hover lifts to `shadow-md`
**only if the card is interactive**. A non-interactive card that lifts is a lie
about affordance.

### 11.8 Modals · Drawers · Bottom sheets **[Built]**

- **Modal** — blocking decision only.
- **Drawer** — inspector: right on desktop, bottom sheet below `sm`, one
  component with a `responsive` side. This is the default for "show me more
  about this row", because a route change loses the table's scroll, filters and
  loaded pages.
- Focus trapped, `Escape` closes, focus returns to the trigger.
- **The scrim is a plain tint, not a blur** (§9).

### 11.9 Command palette **[Built]**

⌘K / Ctrl+K. Sections match locally and appear instantly; entity searches are
debounced 180ms and run in parallel. Arrow keys, Enter, Escape.

**Commands navigate; they do not mutate.** A keystroke away from ⌘K, with no
confirmation and no undo, is the wrong place to publish or archive. Writes live
next to the thing they change.

### 11.10 Toasts · Notifications **[Partial]**

Toasts confirm _completed, non-obvious_ actions. They are **never** used for
autosave — a toast every few seconds while typing is an interruption, not
reassurance. Inline status is correct there (§11.14).

`role="status"` for informational, `role="alert"` for errors only. Auto-dismiss
4–6s; errors persist until dismissed.

### 11.11 Badges and status chips **[Built]**

`rounded-full`, `text-caption`, semantic tint pair. **The label carries the
meaning; the colour reinforces it.** Every status a row can hold has exactly
one chip definition, in one file per domain (`lib/organizer/event-status.ts`) —
so "Selling fast" means the same thing on every screen.

### 11.12 Avatars **[Built]**

Initials on `bg-secondary`, or a gradient medallion for brand contexts. We do
**not** generate cartoon avatars: a fabricated face is a fabricated identity.

### 11.13 Progress: bars, rings, steppers **[Built]**

Bars for determinate work; rings for a proportion of a known total (attendance
against capacity); steppers for multi-step flows. Always `role="progressbar"`
with `aria-valuenow`. An indeterminate bar must not pretend to be determinate.

### 11.14 Autosave indicator **[Built]**

Six states, inline, quiet: `Saved on this device` → `Unsaved changes` →
`Saving…` → `All changes synced · 3m ago`, plus `Offline — changes stored on
this device` and an error state. **Offline is not styled as an error**, because
it is not one.

### 11.15 Charts **[Built]**

SVG, drawn from tokens, no charting library.

- Every chart is `role="img"` with an `aria-label` **and** an `sr-only` data
  table. A chart nobody can read is decoration.
- Series are dense: every day in the window, zeros included. A sparse series
  drawn as a line skips quiet days and turns a flat week into a climb.
- **A failed request renders an error state, never an empty chart.** "You
  earned nothing" and "the query broke" must not look the same.

### 11.16 Empty · Loading · Error states **[Built]**

Three different things, drawn three different ways — see §13.

### 11.17 Date picker · Calendar · Timeline **[Partial]**

Native `datetime-local` today, with `min` bounds mirroring server validation.
A custom picker is **[Spec]** and must keep native keyboard semantics.
Timelines are vertical, one dot per real recorded event — never an inferred
step.

### 11.18 OTP / verification input **[Partial]**

Built in the auth panel; `autocomplete="one-time-code"`, `inputMode="numeric"`.
A per-digit boxed input is **[Spec]** and must remain a single logical field
for paste and for screen readers.

### 11.19 Filtering · sorting · advanced search **[Built]**

**All filter state lives in the URL.** A filtered view is then shareable,
survives reload, and Back steps through filter changes rather than leaving the
page. Saved views are URL states, not stored records — no table to persist and
no sync to get wrong.

### 11.20 Activity feed · Audit log **[Built]**

Two different things, and conflating them is a real failure: the **feed** is
domain events (a booking was confirmed); the **audit log** is human actions (an
operator approved this event). Merged, the second — the one that matters in a
dispute — becomes unfindable. Audit rows read as sentences, never as keys.

### 11.21 Pagination **[Built]**

Cursor-based. No total count, because that costs a `COUNT(*)` on every request.
Counts derived from a cursor list are rendered as **floors** ("24+ events"),
never as totals nobody computed.

---

## §12 · Navigation and information architecture

### 12.1 One nav philosophy

Nav holds **destinations** — things with their own URL. Filters are query
params and belong in the content area, not the nav. Mixing them means the
active state can no longer be derived from the pathname alone.

### 12.2 Sidebar (organizer / admin)

280px expanded, 80px collapsed, remembered across sessions. Rows 36px. Off
canvas below `lg`. Only the _width_ animates, and only after the stored state
has been read — otherwise every page load plays a collapse animation.

### 12.3 No dead navigation

**A nav entry may not exist until its page exists.** An item that 404s, or that
leads to a permanently empty screen, teaches users to distrust the whole
product. This rule has removed more entries from this codebase than it has
added.

### 12.4 Role switching **[Spec]**

One identity, one session. The account menu lists: Personal account ·
Organization(s) · Console (staff only) · Settings · Sign out. Switching scope
**never** requires re-authentication. The current scope is always visible in
the sidebar header — an operator who forgets which organization they are in
will eventually publish to the wrong one.

---

## §13 · States

### 13.1 Loading

Skeletons shaped like the content, never a page spinner. Skeletons reserve
final dimensions — a skeleton that resizes on load is a layout shift with extra
steps.

### 13.2 Empty

Icon + what this is + why it is empty + one action. Distinguish **"nothing
yet"** (offer the action) from **"nothing matches"** (offer to clear filters).
They are different problems.

### 13.3 Error

Say what failed, in plain language, and offer a retry. Never render a failure
as a zero.

### 13.4 Success

Inline and quiet. A checkmark that fades. Success does not need a modal.

### 13.5 Offline

A distinct state, never an error. Say what is stored locally and what will
happen on reconnect. Critically: **queued is not done** — a check-in queued
offline says "Queued", never "Admitted", because a gate flashing green offline
admits two people on one ticket.

### 13.6 The truthfulness rule

Ratings, interest counts, attendee avatars, booked percentages, verified
badges, trend arrows against a zero baseline — **none of these may be rendered
unless a maintained column backs them.** When a denominator is zero the API
returns `null` and the UI renders an em dash, never `0%`. A made-up trend is
worse than an absent one.

---

## §14 · Accessibility

Target **WCAG 2.2 AA**, verified with axe in both themes on every route.

### 14.1 Colour and contrast

4.5:1 body, 3:1 large text and UI boundaries. Tint pairs are pre-verified
(§4.3). Never colour alone (§14.3).

### 14.2 Keyboard

Everything operable. Logical tab order following visual order. Visible focus:
`focus-visible:ring-2 ring-ring` plus an offset on filled surfaces. **Never
`outline: none` without a replacement.** Focus is trapped in overlays and
returned to the trigger on close. Skip-to-content is the first tab stop.

### 14.3 Semantics

Real elements first: `<button>`, `<a>`, `<table>`, `<dl>`. ARIA only when no
element expresses it. A live region for async status; `alert` reserved for
genuine errors — anything else interrupting mid-sentence is rude, not urgent.

Two failures already found and fixed here, worth naming: a `<dl>` with `dt`/`dd`
nested two levels deep (a 1.3.1 violation), and a duplicated `id` from a panel
rendered twice.

### 14.4 Motion and touch

`prefers-reduced-motion` honoured. 44×44 minimum targets. No hover-only
affordance.

---

## §15 · Performance budgets

Binding, and enforced in CI.

| Budget                  | Limit                                        |
| ----------------------- | -------------------------------------------- |
| First Load JS per route | **220 KB gzipped** (`npm run check:bundle`)  |
| INP                     | < 150ms                                      |
| CLS                     | ~0 — every media box reserves space          |
| LCP                     | Server-rendered; never behind a client fetch |

Rules that follow from these:

- **Server Components by default.** Client components only where interaction
  requires them.
- Public, identical-for-everyone content is fetched during the **server**
  render with ISR matched to the backend's `s-maxage`. Per-user content is
  client-fetched and never cached at the edge.
- Heavy modules are code-split: image upload, maps, rich editors, scanners.
- The header's `backdrop-filter` engages only once scrolled (§9).

---

## §16 · Print **[Spec]**

Tickets, invoices and settlement statements must print. Chrome hidden, black on
white, backgrounds off, URLs expanded after links, no page break inside a
ticket. Print is a supported medium here because a QR code on paper still gets
scanned at a gate.

---

## §17 · Governance

### 17.1 Changing the system

1. Change `styles/tokens.css`.
2. Update this document in the **same commit**.
3. Update `/style-guide`, which renders the system and is axe-tested in both
   themes.

Never add a token to solve one screen. If a screen needs a value the system
lacks, either the screen is wrong or the system has a real gap — decide which,
out loud, in the PR.

### 17.2 Definition of done

A screen is done when:

- [ ] Typecheck, ESLint (0 warnings), Prettier, stylelint pass
- [ ] Light **and** dark verified
- [ ] 360 / 768 / 1280 / 1600 verified
- [ ] Keyboard-only path works; focus visible throughout
- [ ] axe clean
- [ ] Loading, empty, error and offline states all exist
- [ ] No fabricated data (§13.6)
- [ ] No raw hex or arbitrary px (lint enforces)
- [ ] Bundle budget holds
- [ ] One primary action, and you can name it

### 17.3 Known debt

Named here rather than quietly carried:

- **Toasts [Partial]** — no shared toast surface; components render inline
  status instead. Fine today, will not scale to bulk actions.
- **Date picker / OTP [Partial]** — native today; custom specced.
- **Role switching [Spec]** — the frontend does not yet read `is_organizer`
  from `/auth/me`, so an organizer has no menu entry to their dashboard.
- **Print [Spec]** — no print stylesheet exists.
- **Monitoring centre [Spec]** — `/admin/health` probes database and cache and
  reports every other adapter as `unknown`. Extending it to latency, CPU,
  queues and traces requires infrastructure telemetry that does not exist; a
  tile that is green because nothing checked it is the one an operator would
  trust to page somebody.

`frontend/BACKLOG.md` tracks each item against the endpoint or migration it
needs.
