import * as React from 'react';

/** Renders a JSON-LD structured-data script (safe: server-serialized JSON). */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is safe to inline as structured data.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
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
};

/** schema.org/Event structured data (rich results for event pages). */
export function eventJsonLd(input: EventJsonLdInput): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: input.name,
    startDate: input.startDate,
    ...(input.endDate ? { endDate: input.endDate } : {}),
    eventStatus: 'https://schema.org/EventScheduled',
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
            availability: 'https://schema.org/InStock',
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
