import type { EventCard } from '@/lib/api/types';
import type { EventJsonLdInput } from '@/lib/seo/json-ld';
import { SITE_URL } from '@/lib/seo/metadata';

/** An event card -> schema.org/Event input. One mapper, so every listing page
 * emits structurally identical data. */
export function eventToJsonLd(event: EventCard): EventJsonLdInput {
  return {
    name: event.title,
    startDate: event.starts_at,
    url: `${SITE_URL}/events/${event.id}`,
    locationName: event.venue,
    city: event.city,
    image: event.poster_url || undefined,
    priceMinor: event.from_price,
    currency: 'INR',
  };
}
