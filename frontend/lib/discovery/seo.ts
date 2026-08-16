import type { EventCard } from '@/lib/api/types';
import { eventPath } from '@/lib/events/ref';
import type { EventJsonLdInput } from '@/lib/seo/json-ld';
import { SITE_URL } from '@/lib/seo/metadata';

/** An event card -> schema.org/Event input. One mapper, so every listing page
 * emits structurally identical data — and so the `url` here is the SAME
 * canonical URL the event page declares. A JSON-LD `url` that differs from the
 * page's own canonical tag is an inconsistency Google reports and may drop the
 * rich result for. */
export function eventToJsonLd(event: EventCard): EventJsonLdInput {
  return {
    name: event.title,
    startDate: event.starts_at,
    url: `${SITE_URL}${eventPath(event)}`,
    locationName: event.venue,
    city: event.city,
    image: event.poster_url || undefined,
    priceMinor: event.from_price,
    // Real availability rather than a hard-coded "in stock": a sold-out event
    // in a listing must not advertise itself as buyable.
    ticketsAvailable: event.tickets_available,
    currency: 'INR',
  };
}
