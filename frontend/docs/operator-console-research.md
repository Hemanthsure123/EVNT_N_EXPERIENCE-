# The operator console: what the field does, and what we took

Companion to `organizer-ux-research.md`, same method and same rule: every
section ends in a decision about THIS codebase, not an observation about
somebody else's.

Consoles studied, chosen because each is strong at a different part of an
operator's job: **Stripe Dashboard** (money tables and detail drawers),
**Shopify admin** (CMS-adjacent editing and bulk actions), **Vercel**
(deployment/health surfaces), **Linear** (keyboard-first density),
**Sanity Studio** and **Contentful** (structured content editing),
**Retool** (internal-tool conventions), **PostHog** (analytics with an
entity selector), **GitHub** admin/audit surfaces, and **AWS Console**
(as an anti-pattern reference for nav sprawl).

Method note, because it changes what follows: this is a synthesis of
established, publicly documented patterns. It is not a live teardown, and
nothing below is a measured claim about another product's current UI.

---

## 1. The content studio (Homepage)

**What works.** Sanity and Contentful both make the left rail a real
*navigator*: selecting a document type replaces the editing pane. The rail is
the table of contents, the pane is the document.

**What does not.** A rail that highlights an item and then scrolls one long
page. The highlight promises a destination the pane does not deliver, and the
operator cannot tell whether they arrived.

**Taken (done).** Our rail did exactly the failing thing, and worse:

- Selecting **Footer note** scrolled to `cms-hero`, an id that does not exist.
- The scroll fired before the form had rendered, so `getElementById` was often
  `null` and it silently did nothing.
- **Featured events rendered under every section**, so it appeared twice in the
  console and the seven rail entries were really one page with highlights.
- The **footer note field lived inside the Announcement ribbon panel** — which
  is why choosing "Footer note" appeared to open the ribbon editor.

Each section now renders only itself. Crucially the fields still belong to ONE
record with ONE optimistic-lock version and ONE save button — splitting them
into separate forms is what would make versions race. What changed is what is
drawn, not what is saved.

**Not taken.** A draft/publish workflow for the homepage. Contentful's is
excellent and we have no draft state on this record; inventing a "Draft" chip
over a table that has one row and one version would be a lie about what
pressing Publish does.

---

## 2. Ordering a list

**What works.** Shopify and Sanity both order by dragging, with keyboard
up/down as the accessible equivalent.

**What does not.** A numeric `position` box per row. It asks the operator to
think in indices, and ours saved on every keystroke — typing `12` wrote
position 1 and then position 12.

**Taken (done).** Up/down buttons that SWAP with the neighbour, matching the
pattern the event wizard's gallery already uses and for the reason it already
documents: a multi-column grid has no fixed "up", and a drag handle is
unusable by keyboard without reimplementing the whole interaction. Both writes
are awaited before the list is invalidated, so no half-applied order flashes.

The category row also stopped leading with `/concerts → "concert"` in mono.
The name leads; the route and search term are the quiet second line.

---

## 3. Per-entity analytics

**What works.** PostHog and Stripe both put an *entity selector* at the top of
an analytics view rather than making you navigate to the entity first. The
selection lives in the URL, so a view is a link.

**Taken (done).** `AdminEventAnalytics` was 350 lines of working charts
against a working endpoint, reachable only from one event's detail drawer —
so "where are the event analytics" had the honest answer "built, unreachable".
It now has a screen, an event picker, and `?event=` in the URL.

**Taken (done), and it was a bug.** The picker itself reported "No events on
the platform yet" over a table listing five. It passed `status: undefined`
under a comment claiming that meant "all"; the server treats an absent status
as the pending queue, deliberately. `status=all` is the explicit opt-in.

**Not taken.** Auto-selecting the first event. A chart for an event nobody
asked about is how one row's number gets read as the platform's.

---

## 4. Health and status

**What works.** Vercel separates *probed* from *configured* and never shows a
green tick for something it did not contact.

**Already true here, and it is the console's best screen.** Database and cache
are probed and say "Green here is evidence"; payments, storage, queue, event
bus, email and SMS are labelled "Configured only — NOT contacted from this
page". That is the honest version and it should not be flattened into one grid
of green ticks to look tidier.

**Worth noting from your screenshot:** Queue reads `local adapter (local/fake)`
in orange. That is the UI doing its job — in production it means background
work runs inline. Not a UI fault; a deployment fact worth acting on.

---

## 5. Audit trails

**What works.** GitHub's audit log is filterable by actor, action and target,
and never fails as a whole because one entry is odd.

**What does not.** Ours 500ed permanently. `actor_id` is a CharField so the
trail outlives the account; it was fed into a UUID `id__in` lookup, and Django
raises while *building* that query. One non-UUID actor took the page down and
kept it down, because audit rows are append-only.

**Taken (done).** Unparseable actors are skipped and resolve to no email. The
action and target still read.

---

## 6. Tables

**What works.** Stripe: filters left, actions right, active filters as
removable chips, a stated scope for anything computed client-side, and a
detail drawer rather than a page navigation.

**Already true here.** One table engine, URL-persisted filters, chips, column
chooser, CSV export.

**Open (NOT done).** Payments, Users and Bookings all scroll horizontally on a
wide monitor because every column carries a minimum width. The fix is a
priority order per table — what must always be visible, what may collapse into
the row's second line, what belongs only in the drawer. That is per-table
judgement, not a shared CSS change, which is why it is written down here
rather than guessed at.

---

## 7. The through-line

The organizer research ended on *prose standing in for structure*. The console's
version is different and worse:

> **Controls that describe an action they do not perform.**

A rail that highlights without navigating. A dropdown that says the platform is
empty. A progress bar reading 100% beside a disabled button. An audit page that
offers filters it never gets to apply. Each reads as "bad UI", and each was a
defect — which is why this pass fixed behaviour first and appearance second.

The rule this establishes for the console:

> If a control's state disagrees with what the system will actually do, that is
> a bug, not a style. Fix the disagreement before restyling the control.
