import * as React from 'react';
import Link from 'next/link';
import { AllEventsChips } from './all-events-chips';
import { ArrowRight } from 'lucide-react';
import { Container } from '@/components/shell/container';
import { fetchEventsSafe } from '@/lib/api/events';
import { addDays, istToday } from '@/lib/discovery/calendar';
import { browseHref } from '@/lib/discovery/filters';
import { AutoRail } from '@/components/discovery/auto-rail';
import { PosterCard } from './poster-card';

/**
 * ── EVERYTHING THAT IS ON SALE, UNDER ONE HEADING ─────────────────────────
 *
 * The front page used to run four rails — featured, editor's pick, trending,
 * selling fast — which is one card doing one job, four times, under headings
 * nobody reads by the third. This is the replacement: the hero recommends ONE
 * event, and then a single grid shows what there is.
 *
 * ── THE CHIPS ARE REAL FILTERS, AND ONLY REAL ONES ────────────────────────
 *
 * Every chip is a link to `/events` with query params `filtersFromSearchParams`
 * already parses — so each one is shareable, back-buttonable, server-rendered
 * and identical to what the browse page would do if you set the same filter
 * there. Nothing here is a new capability; it is the browse page's own filter
 * vocabulary, surfaced one screen earlier.
 *
 * The reference design's row includes "Under 10 km". That one is NOT here, and
 * its absence is the point: distance needs a radius query against coordinates,
 * `Event.latitude`/`longitude` are nullable and most rows have neither, and
 * there is no distance parameter on `GET /events`. A chip that silently
 * returned "everything" would be a filter that lies, which is the one thing
 * this codebase refuses everywhere else. It goes back in the day the backend
 * can answer it (BACKLOG "distance/near me").
 *
 * ── "Filters" IS A LINK, NOT A DROPDOWN ───────────────────────────────────
 *
 * The full filter set — price bands, date ranges, time of day, organiser — is
 * a slide-over that already exists on `/events`, built and tested. Rebuilding
 * it as a home-page dropdown would be a second implementation of the same
 * panel, drifting from the first. The chip goes to the panel.
 */

/** How many cards the front page shows before handing over to browse. */
const HOME_GRID_SIZE = 12;

/**
 * The quick filters, in the order the reference puts them: time first (the
 * most common question), then kind.
 *
 * `href` is built by `browseHref`, so a chip cannot encode a param the browse
 * page does not parse — the compiler enforces the vocabulary.
 */
function quickFilters(): ReadonlyArray<{ label: string; href: string }> {
  // "Tomorrow" has no NAMED window — the vocabulary is today / weekend / week
  // / month — so it is expressed as the one-day RANGE it actually is. Computed
  // per render rather than at module scope: this page is ISR'd, and a date
  // frozen into the module would make "Tomorrow" mean the day after whichever
  // day the bundle was built.
  const tomorrow = addDays(istToday(), 1);

  return [
    { label: 'Today', href: browseHref({ when: 'today' }) },
    { label: 'Tomorrow', href: browseHref({ dateFrom: tomorrow, dateTo: tomorrow }) },
    { label: 'This Weekend', href: browseHref({ when: 'weekend' }) },
    { label: 'Music', href: browseHref({ category: 'concerts' }) },
    { label: 'Comedy', href: browseHref({ category: 'comedy' }) },
    { label: 'Nightlife', href: browseHref({ category: 'nightlife' }) },
    { label: 'Free', href: browseHref({ price: 'free' }) },
  ];
}


export async function AllEvents() {
  // Never throws: the front page's main content must not depend on an upstream
  // being healthy, and an empty grid is a state this renders honestly below.
  const { events } = await fetchEventsSafe({ page_size: HOME_GRID_SIZE });

  return (
    <section aria-labelledby="all-events-heading">
      <Container className="flex flex-col gap-5 py-8 sm:gap-6 sm:py-10">
        <h2
          id="all-events-heading"
          className="text-h3 font-extrabold tracking-tight text-foreground sm:text-h2"
        >
          All Events
        </h2>

        {/* ── STICKY, AND IT STOPS WHERE THE SECTION DOES ───────────────────
            One row, scrolled rather than wrapped. Wrapping puts the grid a
            whole row further down on a phone for no gain; a scroller keeps the
            first cards on the first screen. It stays a SCROLLER at every width
            rather than wrapping from `sm` — a bar that is one line on a phone
            and two on a tablet changes height as it sticks, which shifts the
            grid under it.

            `position: sticky` and nothing else: a sticky element is bounded by
            its CONTAINING BLOCK, and this row's parent is the same Container
            that holds the grid. So it follows the reader down the event list
            and stops of its own accord at the end of the section — with no
            scroll listener, no measured offsets and no `IntersectionObserver`
            to get wrong. That is still true; the client component below adds a
            listener for the horizontal COLLAPSE only, and touches none of the
            pinning.

            Two details it does not work without:
              - a BACKGROUND. The row is transparent by default and the poster
                grid would scroll visibly through it.
              - `z-[999]`, one below the header's `z-sticky` (1000). The header
                sticks at `top-0` and this sticks beneath it; on the same z the
                later element in the DOM wins, so the chips would slide over
                the header's bottom edge and its shadow.

            The hrefs are computed HERE, on the server: `quickFilters()` reads
            the date windows per render, and freezing "Tomorrow" into a client
            bundle would mean the day after whichever day the bundle was
            built. */}
        <AllEventsChips chips={quickFilters()} />

        {events.length ? (
          <>
            {/* ── A RAIL THAT MOVES, NOT A GRID THAT SITS ────────────────────
                This was a static 3-up grid. It is a horizontal rail that
                advances every 4 seconds, which is what makes the section read
                as a shop window rather than a page of results — and the browse
                page one press away is where a grid belongs, because that is
                the surface for comparing twenty events rather than noticing
                three.

                `AutoRail` owns the motion AND its stops: a visible pause
                button, pause on hover and on keyboard focus, no motion at all
                under `prefers-reduced-motion`, and a permanent handover the
                moment somebody scrolls it themselves. Auto-motion without a
                stop is a WCAG 2.2.2 failure, and one that resumes over a
                deliberate scroll is the most irritating thing a carousel does.

                Card widths are set here rather than in `AutoRail`, which knows
                nothing about posters — two on a phone, four at desktop, so the
                rail always shows a partial card and reads as scrollable. */}
            <AutoRail label="All events">
              {events.map((event, index) => (
                <li
                  key={event.id}
                  className="w-[46%] shrink-0 snap-start sm:w-[31%] lg:w-[23%]"
                >
                  <PosterCard
                    event={event}
                    // The first row is above the fold on every width.
                    priority={index < 3}
                    sizes="(min-width: 1024px) 23vw, (min-width: 640px) 31vw, 46vw"
                  />
                </li>
              ))}
            </AutoRail>

            <Link
              href="/events"
              className="group inline-flex h-control w-fit items-center gap-2 self-center rounded-full border border-border bg-surface px-pill text-label text-foreground transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              See all events
              <ArrowRight
                className="size-4 transition-transform duration-fast group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                aria-hidden
              />
            </Link>
          </>
        ) : (
          // Not a skeleton (nothing is loading) and not placeholder cards
          // (that reads as broken rather than as new). The honest thing a
          // ticketing page with no tickets can offer is the other side of the
          // marketplace.
          <div className="flex flex-col items-start gap-4 rounded-2xl border border-border bg-surface p-card-lg">
            <p className="text-body text-muted-foreground">
              Nothing is on sale just yet. New events are added every week.
            </p>
            <Link
              href="/hire"
              className="inline-flex h-control items-center rounded-full bg-cta px-pill text-label text-cta-foreground transition-colors duration-fast hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Hire a performer instead
            </Link>
          </div>
        )}
      </Container>
    </section>
  );
}

/** Reserved height for the grid while it streams, so the footer never jumps. */
export function AllEventsSkeleton() {
  return (
    <Container className="flex flex-col gap-6 py-8 sm:py-10" aria-hidden>
      <div className="h-9 w-44 rounded-lg bg-muted" />
      <div className="flex gap-2.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-control w-24 rounded-full bg-muted" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex flex-col gap-3">
            <div className="aspect-portrait w-full rounded-2xl bg-muted" />
            <div className="h-5 w-4/5 rounded bg-muted" />
            <div className="h-4 w-3/5 rounded bg-muted" />
          </div>
        ))}
      </div>
    </Container>
  );
}
