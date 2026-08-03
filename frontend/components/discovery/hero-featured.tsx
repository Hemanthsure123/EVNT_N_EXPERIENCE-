import * as React from 'react';
import { fetchEventDetail, fetchEventsSafe } from '@/lib/api/events';
import type { EventCard } from '@/lib/api/types';
import { eventToJsonLd } from '@/lib/discovery/seo';
import { JsonLd, eventItemListJsonLd } from '@/lib/seo/json-ld';
import { Carousel } from './carousel';
import { FeaturedProvider } from './featured-context';
import { FeaturedIsland, HERO_SENTINEL_ID } from './featured-island';
import { HeroSlide } from './hero-slide';
import { RailError } from './feature-rail';

/**
 * The hero's right column: the featured events, as a cinematic carousel.
 *
 * "Featured" is currently the five soonest upcoming events — the backend has no
 * editorial flag (BACKLOG.md item 8). That's a merchandising decision the
 * product should own, and this one call is the seam for it.
 *
 * DESCRIPTIONS come from a second fetch. The list payload deliberately omits
 * `description` (it's the highest-volume response on the platform and a
 * paragraph per card would bloat it), so the one sentence that answers "why go?"
 * is pulled from each event's own detail endpoint. Five requests, issued in
 * parallel, at ISR time — not per visitor — and each is served from the
 * backend's by-id cache. A failed detail fetch just means that slide renders
 * without its sentence.
 */

const FEATURED_COUNT = 5;

/** First sentence only: the banner has room for one line, not a paragraph. */
function firstSentence(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : trimmed).trim();
}

async function describe(events: EventCard[]): Promise<(string | undefined)[]> {
  return Promise.all(
    events.map(async (event) => {
      try {
        const detail = await fetchEventDetail(event.id);
        return firstSentence(detail.description ?? '');
      } catch {
        return undefined;
      }
    }),
  );
}

export async function HeroFeatured() {
  const { events, error } = await fetchEventsSafe({ page_size: FEATURED_COUNT });

  if (error) return <RailError message={error} retryHref="/events" />;
  if (!events.length) return null;

  const descriptions = await describe(events);

  return (
    <>
      {/* The crawler-facing mirror of what a visitor sees first. */}
      <JsonLd data={eventItemListJsonLd('Featured events', events.map(eventToJsonLd))} />

      <FeaturedProvider events={events}>
        <Carousel label="Featured events">
          {events.map((event, i) => (
            <HeroSlide
              key={event.id}
              event={event}
              description={descriptions[i]}
              priority={i === 0}
            />
          ))}
        </Carousel>

        {/* Marks the bottom of the hero's featured block. Once this has scrolled
            past, the island takes the rotation over. */}
        <div id={HERO_SENTINEL_ID} aria-hidden />
        <FeaturedIsland />
      </FeaturedProvider>
    </>
  );
}

/** Content-shaped fallback: same boxes, same rhythm, so nothing shifts. */
export function HeroFeaturedSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-hidden>
      <div className="skeleton aspect-poster w-full rounded-2xl sm:aspect-feature" />
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-1 flex-1 rounded-full" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={
                i === 2 ? 'skeleton hidden h-16 rounded-xl sm:block' : 'skeleton h-16 rounded-xl'
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
