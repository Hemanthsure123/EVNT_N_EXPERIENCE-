import * as React from 'react';
import { EventCard } from '@/components/discovery/event-card';
import { Reveal } from '@/components/discovery/reveal';
import { Section, SectionHeader } from '@/components/discovery/section';
import type { CollectionKey, Homepage, HomepageCard } from '@/lib/api/cms';
import type { EventCard as EventCardModel } from '@/lib/api/types';

/**
 * A rail of events an operator curated, rendered from `GET /homepage`.
 *
 * ── THIS IS THE HALF THAT WAS MISSING ─────────────────────────────────────
 *
 * The admin curation manager has been writing to `cms_featured_entry` since it
 * shipped, and nothing on the homepage read it — so an operator could pin an
 * event, see it in the admin list, and watch the front page ignore it. A CMS
 * whose writes have no reader is worse than no CMS: it teaches an operator
 * that their edits do not matter.
 *
 * ── IT RENDERS NOTHING WHEN NOTHING IS CURATED ────────────────────────────
 *
 * No placeholder, no "coming soon", no auto-filled substitute. An empty
 * curated rail means an operator has not curated — and quietly back-filling it
 * with whatever the search index returned would make the rail a lie about
 * editorial intent, and would hide the fact that nobody is merchandising.
 * The derived rails below it (trending, selling fast) already cover the
 * un-curated case honestly, because they say what they are.
 *
 * ── SERVER COMPONENT ──────────────────────────────────────────────────────
 *
 * The payload arrives with the page (§15). No client fetch, no skeleton, no
 * layout shift — these cards are above the fold on a short viewport.
 */

/** The CMS card shape is a superset of what `EventCard` needs; narrow it. */
function toEventCard(card: HomepageCard): EventCardModel {
  return {
    id: card.id,
    title: card.title,
    venue: card.venue,
    city: card.city,
    starts_at: card.starts_at,
    poster_url: card.poster_url,
    from_price: card.from_price,
    tickets_available: card.tickets_available,
    organization_id: card.organization_id,
    organization_name: card.organization_name,
  };
}

export function CuratedRail({
  collections,
  collection,
  title,
  subtitle,
}: {
  collections: Homepage['collections'] | undefined;
  collection: CollectionKey;
  title: string;
  subtitle: string;
}) {
  const cards = collections?.[collection] ?? [];
  if (cards.length === 0) return null;

  return (
    <Section>
      <Reveal>
        <SectionHeader title={title} subtitle={subtitle} href="/events" linkLabel="Browse all" />
      </Reveal>
      {/* 12px gutters below `sm`, 24px above. The cards are compact rows on a
          phone (see `event-card.tsx`) and a 24px trough between two 140px rows
          reads as a break in the rail rather than as breathing room. */}
      <ul className="grid gap-3 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
        {cards.map((card, index) => (
          <li key={card.entry_id}>
            {/* Only the first row is eager: these sit high on the page, and
                lazy-loading an above-the-fold poster delays LCP. */}
            <Reveal delayMs={Math.min(index, 5) * 60} className="h-full">
              {/* `96px` under 640, matching the compact row's thumbnail —
                  `100vw` here made a phone fetch a full-width poster for a
                  box a quarter of that wide. */}
              <EventCard
                event={toEventCard(card)}
                priority={index < 3}
                sizes="(min-width: 1280px) 30vw, (min-width: 640px) 45vw, 96px"
              />
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  );
}
