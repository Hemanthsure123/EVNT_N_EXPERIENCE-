# Organizer UX: what the field does, and what we should take

Research for brief item 19, written to be USED — every section ends with a
decision for this codebase, not an observation about somebody else's.

Platforms studied, chosen because each is strong at a different part of the
job rather than because they are the five biggest: **Eventbrite** (creation
funnel at scale), **Dice** (mobile-first, opinionated), **Ticket Tailor**
(small-organizer simplicity), **Stripe Dashboard** (money surfaces and tables),
**Linear** (not ticketing — the reference for keyboard-first density and
information hierarchy).

A note on method, because it changes what follows: this is a synthesis of
established, publicly documented patterns and the design literature around
them. It is not a live teardown, and nothing below is presented as a measured
claim about another product's current UI.

---

## 1. The dashboard home

**What works.** Stripe opens on one number with a trend, not a grid of equals.
Linear opens on *your* assigned work. Both answer a single question before
offering breadth.

**What does not.** Eventbrite-style dashboards that give attention, sales,
upcoming and activity the same card weight. Five equal regions is no emphasis,
and the eye starts at the top-left and stays there.

**Taken (done).** Today's numbers lead; the worklist moved to the header bell;
money and activity became a second column. See `dashboard-home.tsx`.

**Not taken.** A "revenue goal" ring. Nothing stores a target, and a progress
ring against an invented denominator is the fabricated number this codebase
refuses everywhere else.

---

## 2. Notifications

**What works.** A single bell in the chrome, silent when empty, reachable from
every screen. Linear's inbox is the strongest version: it is a WORKLIST, not a
log, and clearing it means something.

**What does not.** Duplicating the same list on a dashboard panel — two loading
states, and dismissing in one place leaves it visible in the other.

**Taken (done).** Bell in the header, single source (`useAttention`), badge
absent rather than `0` on failure. The duplicate panel and the misleading
sidebar dot were removed.

**Open.** Nothing here is dismissible: the items are derived from live rows, so
"read" state would need a model. Deliberately absent rather than faked.

---

## 3. Event creation

**What works.** Dice and Ticket Tailor both keep the form narrow, one decision
per row, with the step list pinned. Eventbrite's strength is that its preview
is the real card, not an approximation.

**What does not.** Explaining each field in a paragraph above it. That is the
tell of a form whose labels, grouping and order are not carrying their weight —
and it doubles the height of every step.

**Taken (done).** 13 section paragraphs and 11 field hints removed; the step
rail is sticky; the preview already renders the real component.

**Kept deliberately.** Two hints survive — the cumulative seat cap and the
price-phase constraint. Both state a rule the form REJECTS you for breaking but
cannot otherwise tell you in advance, and both have money attached. That is the
line: a constraint stays, a description goes.

---

## 4. Media

**What works.** Dice treats the cover as a distinct decision from the gallery,
because one is the card everywhere and the rest are detail. Drag-drop plus
paste plus a file picker, all three, because people arrive differently.

**What does not.** A single undifferentiated "images" grid where the cover is
just the first item — organizers reorder it by accident and change every
listing card.

**Already true here.** `media-step.tsx` separates cover from gallery, supports
drop / paste / picker, shows real per-file progress via `XMLHttpRequest`, and
collects alt text BEFORE upload.

**Recommended next (NOT done).** The step is 1110 lines and carries cover,
gallery, and video in one scroll. Splitting into three labelled regions with
collapsed video would cut its height materially. This is layout work with no
correctness component — the reason it is written down rather than guessed at.

---

## 5. Details, and search appearance

**What works.** Stripe groups optional metadata under a disclosure so the
required path stays short. A live SERP preview beats any description of what
Google will show.

**Already true here.** The SEO step renders a real search-result and share
preview with the same fallback chain the public page uses.

**Recommended next (NOT done).** Details is four fields presented flat; two are
optional. Grouping "how long / language" apart from "age / access" would make
the required path visibly shorter.

---

## 6. Tables — bookings, customers, refunds, payouts

**What works.** Stripe: filters left, actions right, active filters as
removable chips, and a stated scope for anything computed client-side.

**Already true here.** One table engine, URL-persisted filters, chips, CSV
export, and the explicit "sorted within the rows loaded so far" note.

**Taken (done).** Bookings gained the event filter its state already expected;
the chip names the event rather than showing a uuid.

---

## 7. Analytics

**What works.** Presets AND an explicit range, side by side. Stripe labels what
a comparison is against rather than showing a bare percentage.

**Taken (done).** From/To beside 7/30/90, as a real API addition; the chart
subtitle names the window it is showing.

**Not taken.** A funnel chart. There is no view or impression data — every
stage would be invented.

---

## 8. Check-in

**What works.** Dice's scanner is full-bleed camera, one verdict, huge type,
audible confirmation. A steward is holding a phone in the dark with a queue.

**What does not.** Making the typed field the primary control. It is a fallback.

**Taken (done).** Camera scanning now works on every browser that can open a
camera, not only those with `BarcodeDetector` — Safari and Firefox stewards
were typing codes by hand.

**Recommended next (NOT done).** A full-screen scan mode. The current panel is
correct but small on a phone held at arm's length.

---

## 9. Payouts

**What works.** Stripe answers "when do I get paid" as a status ON the payout
row, not as a preamble.

**Taken (done).** The four-step lifecycle explainer moved below the table into
a closed disclosure. The rows are what the page is for.

---

## 10. The through-line

Every "what does not work" above is the same failure: **prose standing in for
structure**, and **equal weight standing in for hierarchy**. Both are cheap to
add and expensive to read.

The rule this codebase should keep, and mostly now does:

> If a sentence explains what a control is, fix the control. If it states a
> rule the system will REJECT you for breaking, keep it — and put it beside the
> field, not above the section.
