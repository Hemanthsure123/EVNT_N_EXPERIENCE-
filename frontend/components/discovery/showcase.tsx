import * as React from 'react';
import Link from 'next/link';
import { Container } from '@/components/shell/container';
import { featuredFrom, fetchUpcomingEvents } from '@/lib/discovery/upcoming';
import { eventToJsonLd } from '@/lib/discovery/seo';
import { JsonLd, eventItemListJsonLd } from '@/lib/seo/json-ld';
import { HeroCarousel } from './hero-carousel';

/**
 * The first screen: which events lead the front page, and where they came from.
 *
 * This component is the DATA half — curated versus derived, the structured
 * data, and the empty state. `HeroCarousel` is the presentation half. They are
 * split because only the carousel needs to be a client component (it holds a
 * slide index), and pushing the fetch into it would make the front page's
 * first paint wait for JavaScript.
 *
 * ── WHAT REPLACED WHAT ────────────────────────────────────────────────────
 *
 * This was a marquee: five posters side by side under a heading and a "Browse
 * all events" pill. A shelf, in other words — five events competing at a fifth
 * of the attention each, and no room for any of them to say when it is, where
 * it is or what it costs.
 *
 * It is now one full-width banner per event, with the poster's own colour
 * behind it, and the grid of everything moved to its own section below. The
 * hero recommends; the grid lists. Neither is trying to do both.
 *
 * ── IT IS THE FIRST FIVE OF "ALL EVENTS", AND NOTHING ELSE ───────────────
 *
 * This used to read an operator-curated CMS collection and fall back to the
 * index only when nothing was pinned — so with one event pinned, the hero
 * showed that event while the grid below led with a different one, and the
 * page contradicted itself about what was on next. It now reads the SAME rows
 * as `AllEvents` through `fetchUpcomingEvents` (one memoised request for
 * both) and takes the first five: soonest first, most recently published
 * first among events that start together.
 *
 * The CMS `collections.featured` field is no longer read here. It still
 * exists on the backend; nothing on the landing page consumes it.
 *
 * With no events at all — a fresh platform — it shows neither, and offers the
 * other side of the marketplace instead of a rail of grey boxes.
 */

export async function Showcase() {
  // Never throws: the front page must survive an upstream that does not. The
  // identical call in `AllEvents` is memoised by Next into one request.
  const { events: upcoming } = await fetchUpcomingEvents();
  const events = featuredFrom(upcoming);
  // ── ONE NAME, WHATEVER FILLED IT ──────────────────────────────────────
  //
  // The heading used to change with the SOURCE: "Featured events" when an
  // operator had curated a collection, "Events on sale now" when it fell back
  // to the index. That is a distinction only the person who wrote the query
  // can see — to a visitor the rail looks identical either way, and a section
  // whose title changes for reasons invisible on screen is a section nobody
  // can learn. It is the featured rail; it says so.
  const label = 'Featured events';

  if (!events.length) return <EmptyShowcase />;

  return (
    <>
      {/* ── THE CRAWLER-FACING MIRROR OF THE FIRST SCREEN ─────────────────
          The front page is the most-linked URL on the site and emitted no
          ItemList at all: `WebSite` said the site had a search box and nothing
          said what was on sale. These are the same events a visitor sees, in
          the same order, with the same names and prices — so the structured
          data cannot claim anything the page does not show. It is NAMED the
          way the rail is, for the same reason the rail is. */}
      <JsonLd data={eventItemListJsonLd(label, events.map(eventToJsonLd))} />
      <HeroCarousel events={events} label={label} />
    </>
  );
}

/**
 * No events on the platform at all.
 *
 * Not a skeleton (nothing is loading), not a rail of grey placeholders (that
 * reads as broken rather than as new), and not invented cards. It is the one
 * honest thing a ticketing site with no tickets can offer: the other side of
 * the marketplace.
 */
function EmptyShowcase() {
  return (
    <Container className="py-10 sm:py-14">
      <div className="flex flex-col items-start gap-5 rounded-2xl border border-border bg-surface p-card-lg shadow-sm sm:p-8">
        <div className="flex max-w-xl flex-col gap-2">
          <h2 className="text-h3 font-extrabold tracking-tight text-foreground">
            Nothing on sale just yet
          </h2>
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
    </Container>
  );
}
