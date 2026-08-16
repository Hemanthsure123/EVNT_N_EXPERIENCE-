import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JsonLd, eventJsonLd, organizationJsonLd, performerJsonLd } from './json-ld';

const base = {
  name: 'Jazz Night',
  startDate: '2026-09-01T18:00:00Z',
  url: 'https://example.test/events/jazz-night-abc',
};

describe('JsonLd escaping', () => {
  it('cannot be broken out of with a closing script tag', () => {
    // Every value in these blocks comes from an organizer's own title,
    // description or venue. `JSON.stringify` keeps the JSON valid but the HTML
    // parser does not care about JSON validity — it ends the script at the
    // first literal `</script`, which would reflect organizer input into the
    // page as markup on the busiest public route on the platform.
    const html = renderToStaticMarkup(
      <JsonLd data={{ name: '</script><img src=x onerror=alert(1)>' }} />,
    );

    expect(html).not.toContain('</script><img');
    expect(html).toContain('\\u003c');
    // Still exactly one script element, so the block a crawler parses is whole.
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it('escapes the line separators that are legal JSON but break JavaScript', () => {
    const html = renderToStaticMarkup(<JsonLd data={{ name: `a b c` }} />);

    expect(html).toContain('\\u2028');
    expect(html).toContain('\\u2029');
  });

  it('leaves ordinary content readable', () => {
    const html = renderToStaticMarkup(<JsonLd data={{ '@type': 'Event', name: 'Jazz Night' }} />);

    expect(html).toContain('"name":"Jazz Night"');
  });
});

describe('eventJsonLd availability', () => {
  it('says SOLD OUT when nothing is left', () => {
    const data = eventJsonLd({ ...base, priceMinor: 50000, ticketsAvailable: 0 });

    expect((data.offers as Record<string, string>).availability).toBe('https://schema.org/SoldOut');
  });

  it('says IN STOCK when tickets remain', () => {
    const data = eventJsonLd({ ...base, priceMinor: 50000, ticketsAvailable: 12 });

    expect((data.offers as Record<string, string>).availability).toBe('https://schema.org/InStock');
  });

  it('omits availability entirely when it is unknown', () => {
    // `tickets_available` is null until ticketing has costed the event. A
    // hard-coded "in stock" — which is what this used to emit for every event
    // — is a claim about inventory nobody has counted.
    const data = eventJsonLd({ ...base, priceMinor: 50000, ticketsAvailable: null });

    expect((data.offers as Record<string, unknown>).availability).toBeUndefined();
  });

  it('marks a cancelled event cancelled and unbuyable', () => {
    // A cancelled event keeps its page on purpose — hundreds of people hold
    // the link in an email — and telling Google it is going ahead as scheduled
    // is a claim the page itself contradicts.
    const data = eventJsonLd({
      ...base,
      status: 'cancelled',
      priceMinor: 50000,
      ticketsAvailable: 40,
    });

    expect(data.eventStatus).toBe('https://schema.org/EventCancelled');
    expect((data.offers as Record<string, string>).availability).toBe('https://schema.org/SoldOut');
  });

  it('emits no offer at all without a price', () => {
    const data = eventJsonLd({ ...base, priceMinor: null, ticketsAvailable: 10 });

    expect(data.offers).toBeUndefined();
  });
});

describe('organizationJsonLd', () => {
  it('drops sameAs when no social handle is configured', () => {
    // A `sameAs` pointing nowhere is a reason for Google to distrust the block,
    // and inventing profiles is the fabrication this codebase refuses.
    const data = organizationJsonLd({ name: 'Curatix', url: 'https://example.test', sameAs: [] });

    expect(data.sameAs).toBeUndefined();
  });

  it('keeps only the handles that are actually set', () => {
    const data = organizationJsonLd({
      name: 'Curatix',
      url: 'https://example.test',
      sameAs: ['https://instagram.com/curatix', '', ''],
    });

    expect(data.sameAs).toEqual(['https://instagram.com/curatix']);
  });
});

describe('performerJsonLd', () => {
  it('is a PerformingGroup, not a Person', () => {
    const data = performerJsonLd({ name: 'The Band', url: 'https://example.test/hire/1' });

    expect(data['@type']).toBe('PerformingGroup');
  });

  it('omits the offer when the act lists no starting price', () => {
    // "Price on ask" is a real answer some acts give. A zero would read as
    // "free", which is a materially different claim on a booking worth tens of
    // thousands of rupees.
    const data = performerJsonLd({
      name: 'The Band',
      url: 'https://example.test/hire/1',
      startingPriceMinor: null,
    });

    expect(data.makesOffer).toBeUndefined();
  });

  it('carries the starting fee as a MINIMUM, never as a price', () => {
    const data = performerJsonLd({
      name: 'The Band',
      url: 'https://example.test/hire/1',
      startingPriceMinor: 8000000,
    });

    const offer = data.makesOffer as { priceSpecification: Record<string, string> };
    expect(offer.priceSpecification.minPrice).toBe('80000.00');
    expect(offer.priceSpecification.priceCurrency).toBe('INR');
  });
});
