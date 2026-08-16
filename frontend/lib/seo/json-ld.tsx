import * as React from 'react';

/**
 * Escapes the sequences that let a string inside JSON break OUT of the
 * `<script>` element containing it.
 *
 * `JSON.stringify` is not enough on its own, and that is the whole point: it
 * escapes quotes and backslashes, so the JSON stays valid — but the HTML parser
 * does not care about JSON validity. It ends the script block at the first
 * literal `</script`, wherever that appears. Every value below comes from an
 * organizer's own title, description or venue, so a title of
 * `</script><img onerror=...>` would be reflected into the page as markup, on
 * the highest-traffic public route on the platform.
 *
 * `<` is the same character to a JSON parser and inert to the HTML
 * tokenizer, so Google reads exactly what was intended. U+2028 and U+2029 go
 * with it: they are legal inside a JSON string but terminate a JavaScript line,
 * which breaks any consumer that evaluates the block rather than parsing it.
 */
function escapeForScriptTag(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Renders a JSON-LD structured-data script. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: escapeForScriptTag(JSON.stringify(data)) }}
    />
  );
}

export type EventJsonLdInput = {
  name: string;
  startDate: string;
  endDate?: string;
  url: string;
  locationName?: string;
  city?: string;
  image?: string;
  description?: string;
  priceMinor?: number | null;
  currency?: string;
  /**
   * The event's lifecycle status, straight off the row (`live`, `cancelled`, …).
   * Omitted where the payload does not carry it — a CARD does not, which is
   * correct: a cancelled event is not in any public listing to begin with.
   */
  status?: string | null;
  /**
   * Remaining tickets, the same denormal the card renders. `null`/`undefined`
   * means UNKNOWN (a draft, or an event ticketing has not costed yet) and the
   * offer then omits `availability` rather than asserting one.
   */
  ticketsAvailable?: number | null;
};

/**
 * `availability` and `eventStatus` are DERIVED, never assumed.
 *
 * Both used to be hard-coded to "scheduled" and "in stock". So a sold-out show
 * advertised itself as buyable in the search result, and a CANCELLED event —
 * which still has a page on purpose, because hundreds of people hold a link in
 * an email — told Google it was going ahead as planned. Structured data that
 * contradicts the page is worse than none: Google demotes or drops the rich
 * result, and the visitor who clicks it has been misled by us.
 */
function offerAvailability(input: EventJsonLdInput): string | undefined {
  if (input.status === 'cancelled') return 'https://schema.org/SoldOut';
  if (input.ticketsAvailable == null) return undefined;
  return input.ticketsAvailable > 0 ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut';
}

function eventStatus(input: EventJsonLdInput): string {
  return input.status === 'cancelled'
    ? 'https://schema.org/EventCancelled'
    : 'https://schema.org/EventScheduled';
}

/** schema.org/Event structured data (rich results for event pages). */
export function eventJsonLd(input: EventJsonLdInput): Record<string, unknown> {
  const availability = offerAvailability(input);
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: input.name,
    startDate: input.startDate,
    ...(input.endDate ? { endDate: input.endDate } : {}),
    eventStatus: eventStatus(input),
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    ...(input.image ? { image: [input.image] } : {}),
    ...(input.description ? { description: input.description } : {}),
    location: {
      '@type': 'Place',
      name: input.locationName ?? '',
      address: { '@type': 'PostalAddress', addressLocality: input.city ?? '' },
    },
    url: input.url,
    ...(input.priceMinor != null
      ? {
          offers: {
            '@type': 'Offer',
            price: (input.priceMinor / 100).toFixed(2),
            priceCurrency: input.currency ?? 'INR',
            url: input.url,
            ...(availability ? { availability } : {}),
          },
        }
      : {}),
  };
}

/**
 * schema.org/ItemList of Events — what a discovery listing (home, city page,
 * category page) should expose, rather than N loose Event blobs. Each entry
 * carries the full nested Event so a rich result can render without a crawl of
 * every detail page.
 */
export function eventItemListJsonLd(
  name: string,
  events: EventJsonLdInput[],
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: events.length,
    itemListElement: events.map((event, i) => {
      const { '@context': _context, ...eventNode } = eventJsonLd(event);
      return { '@type': 'ListItem', position: i + 1, item: eventNode };
    }),
  };
}

/** schema.org/WebSite + SearchAction — the sitelinks search box. */
export function webSiteJsonLd(input: {
  name: string;
  url: string;
  searchUrlTemplate: string;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: input.name,
    url: input.url,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: input.searchUrlTemplate },
      'query-input': 'required name=search_term_string',
    },
  };
}

/**
 * schema.org/Organization — the PUBLISHER, emitted once site-wide.
 *
 * This is what ties the domain to a name and a logo in Google's knowledge
 * panel, and it was the one top-level entity the site never declared: every
 * page said what it was ABOUT and no page said who was saying it.
 *
 * Deliberately minimal. `sameAs` carries only social profiles that are
 * actually configured — an empty array of placeholder handles would be the
 * same fabrication the rest of this codebase refuses, and Google treats a
 * `sameAs` pointing nowhere as a reason to distrust the block.
 */
export function organizationJsonLd(input: {
  name: string;
  url: string;
  logo?: string;
  sameAs?: string[];
}): Record<string, unknown> {
  const sameAs = (input.sameAs ?? []).filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: input.name,
    url: input.url,
    ...(input.logo ? { logo: input.logo } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

/**
 * schema.org/PerformingGroup — a bookable act on the hire marketplace.
 *
 * `PerformingGroup` rather than `Person` because an act is what the platform
 * models: a band, a DJ duo, a dance troupe. A solo performer is still a group
 * of one as far as the booking is concerned, and choosing `Person` would put a
 * real individual's name, city and fee into a schema type Google associates
 * with people rather than services.
 *
 * `makesOffer` carries the starting fee ONLY when the act published one. A
 * price of zero on a marketplace where quotes are negotiated would read as
 * "free", which is a materially different claim from "not stated".
 */
export function performerJsonLd(input: {
  name: string;
  url: string;
  description?: string;
  image?: string;
  city?: string;
  genres?: string[];
  startingPriceMinor?: number | null;
  currency?: string;
}): Record<string, unknown> {
  const genres = (input.genres ?? []).filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': 'PerformingGroup',
    name: input.name,
    url: input.url,
    ...(input.description ? { description: input.description } : {}),
    ...(input.image ? { image: [input.image] } : {}),
    ...(genres.length ? { genre: genres } : {}),
    ...(input.city
      ? {
          address: { '@type': 'PostalAddress', addressLocality: input.city },
          areaServed: input.city,
        }
      : {}),
    ...(input.startingPriceMinor != null && input.startingPriceMinor > 0
      ? {
          makesOffer: {
            '@type': 'Offer',
            priceSpecification: {
              '@type': 'PriceSpecification',
              minPrice: (input.startingPriceMinor / 100).toFixed(2),
              priceCurrency: input.currency ?? 'INR',
            },
            url: input.url,
          },
        }
      : {}),
  };
}

/** schema.org/BreadcrumbList structured data. */
export function breadcrumbJsonLd(items: { name: string; url: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
