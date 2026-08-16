import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Container } from '@/components/shell/container';
import type { Homepage, HomepageCard } from '@/lib/api/cms';
import { fetchEventsSafe } from '@/lib/api/events';
import type { EventCard as EventCardModel } from '@/lib/api/types';
import { eventToJsonLd } from '@/lib/discovery/seo';
import { JsonLd, eventItemListJsonLd } from '@/lib/seo/json-ld';
import { Aurora } from './aurora';
import { Marquee } from './marquee';
import { ShowcaseCard } from './showcase-card';

/**
 * The first screen. An operator's picks, moving, over a drifting colour field.
 *
 * ── WHAT REPLACED WHAT ────────────────────────────────────────────────────
 *
 * This is where the old split hero was: a headline, a paragraph, two trust
 * badges, a search bar, six quick-filter chips and a featured panel — nine
 * things competing on the one screen that decides whether somebody stays. It
 * asked the visitor to read a value proposition before it showed them a single
 * event.
 *
 * The replacement shows events, immediately, and nothing else. Search moved to
 * the header where it is on every page anyway (and now carries the rolling
 * suggestions the hero bar used to). The quick filters moved to the browse
 * page, which is where somebody filtering already is.
 *
 * ── THE HEADING IS HONEST ABOUT WHERE THE ROW CAME FROM ───────────────────
 *
 * Curated and derived are DIFFERENT rows and they say so. When an operator has
 * pinned events, this is "Featured this week — chosen by our team". When they
 * have not, it falls back to the soonest live events and calls itself
 * "Happening soon". The fallback exists because this is the top of the front
 * page and an empty top is a broken site; the RELABEL exists because quietly
 * presenting an index query as an editor's choice is the exact fabrication
 * this codebase refuses everywhere else.
 *
 * With no events at all — a fresh platform, which is the state this was built
 * in — it renders a real invitation rather than an empty rail or a fake one.
 *
 * ── SERVER COMPONENT, ONE ISLAND ──────────────────────────────────────────
 *
 * Everything here is server-rendered from the payload the page already read.
 * Only `Marquee` is `'use client'`, because pausing needs pointer, focus and
 * visibility listeners. The cards inside it ship no JavaScript at all.
 */

/** The CMS card shape is a superset of what a card needs; narrow it. */
function toEventCard(card: HomepageCard): EventCardModel {
  return {
    id: card.id,
    title: card.title,
    venue: card.venue,
    city: card.city,
    category: '',
    starts_at: card.starts_at,
    poster_url: card.poster_url,
    from_price: card.from_price,
    tickets_available: card.tickets_available,
    organization_id: card.organization_id,
    organization_name: card.organization_name,
  };
}

/**
 * How many the rail carries.
 *
 * The operator's list is what it is. The FALLBACK is capped at eight: enough
 * that the loop is not two cards ping-ponging, few enough that the front page
 * does not become the browse page with a nicer background.
 */
const FALLBACK_SIZE = 8;

export async function Showcase({ collections }: { collections: Homepage['collections'] | undefined }) {
  const curated = (collections?.featured ?? []).map(toEventCard);

  // Only asked for when nothing is curated — an operator who has done the work
  // costs no extra request. `fetchEventsSafe` never throws: the front page must
  // survive an upstream that does not.
  const fallback = curated.length
    ? []
    : (await fetchEventsSafe({ page_size: FALLBACK_SIZE })).events;

  const events = curated.length ? curated : fallback;
  const isCurated = curated.length > 0;

  return (
    <section className="relative isolate overflow-hidden border-b border-border">
      {/* ── THE CRAWLER-FACING MIRROR OF THE FIRST SCREEN ─────────────────
          The front page is the most-linked URL on the site and it emitted no
          ItemList at all: `WebSite` said the site had a search box and nothing
          said what was on sale. These are the same events a visitor sees, in
          the same order, with the same names and prices — so the structured
          data cannot claim anything the page does not show.

          NAMED the same way the heading is. Curated and derived are different
          rows and the ItemList says which it is, for exactly the reason the
          <h1> does: presenting an index query as an editor's choice is a
          fabrication whether a person or a crawler reads it. */}
      {events.length ? (
        <JsonLd
          data={eventItemListJsonLd(
            isCurated ? 'Featured this week' : 'On sale now',
            events.map(eventToJsonLd),
          )}
        />
      ) : null}

      <Aurora />

      <Container className="flex flex-col gap-8 py-14 sm:gap-10 sm:py-20">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2.5">
            <p className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-surface/80 px-3 py-1 text-caption font-medium text-muted-foreground backdrop-blur">
              <Sparkles className="size-3.5 text-primary" aria-hidden />
              {isCurated ? 'Featured this week' : 'On sale now'}
            </p>
            <h1 className="max-w-2xl text-h2 md:text-display">
              {isCurated ? 'Picked by our team' : 'Happening soon'}
            </h1>
          </div>

          <Link
            href="/events"
            className="group inline-flex h-control w-fit shrink-0 items-center gap-2 rounded-full bg-cta px-pill text-label text-cta-foreground shadow-sm transition duration-fast ease-out hover:bg-cta-hover active:bg-cta-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Browse all events
            <ArrowRight
              className="size-4 transition-transform duration-fast group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
              aria-hidden
            />
          </Link>
        </header>

        {events.length ? (
          <Marquee ariaLabel={isCurated ? 'Featured events' : 'Events on sale now'}>
            {events.map((event, index) => (
              // The first three are the LCP candidates — everything else is
              // off-screen at first paint and must not compete for bandwidth.
              <ShowcaseCard key={event.id} event={event} priority={index < 3} />
            ))}
          </Marquee>
        ) : (
          <EmptyShowcase />
        )}
      </Container>
    </section>
  );
}

/**
 * No events on the platform at all.
 *
 * Not a skeleton (nothing is loading), not a placeholder rail of grey boxes
 * (that reads as broken rather than as new), and not invented cards. It is the
 * one honest thing a ticketing site with no tickets can offer: the other side
 * of the marketplace.
 */
function EmptyShowcase() {
  return (
    <div className="flex flex-col items-start gap-5 rounded-2xl border border-border bg-surface/85 p-card-lg shadow-md backdrop-blur sm:p-8">
      <div className="flex max-w-xl flex-col gap-2">
        <h2 className="text-h4 text-foreground">Nothing on sale just yet</h2>
        <p className="text-body text-muted-foreground">
          The first events are being listed now. If you run one, this is a good moment to be the
          first thing people see.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/organizer"
          className="inline-flex h-control items-center rounded-full bg-cta px-pill text-label text-cta-foreground shadow-sm transition-colors duration-fast hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          List your event
        </Link>
        <Link
          href="/hire"
          className="inline-flex h-control items-center rounded-full border border-border bg-surface px-pill text-label text-foreground transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Hire a performer
        </Link>
      </div>
    </div>
  );
}
