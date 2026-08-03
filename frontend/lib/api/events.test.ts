import { describe, expect, it } from 'vitest';
import { cursorFromNextLink, eventsQueryString } from './events';

describe('eventsQueryString', () => {
  it('omits every empty param so identical browses share one cache key', () => {
    expect(eventsQueryString({})).toBe('');
    expect(eventsQueryString({ q: '', city: '' })).toBe('');
  });

  it('encodes what the backend serializer accepts', () => {
    const qs = eventsQueryString({
      q: 'live music',
      city: 'Mumbai',
      starts_after: '2026-08-01T00:00:00.000Z',
      page_size: 20,
    });
    expect(qs.startsWith('?')).toBe(true);
    const params = new URLSearchParams(qs.slice(1));
    expect(params.get('q')).toBe('live music');
    expect(params.get('city')).toBe('Mumbai');
    expect(params.get('starts_after')).toBe('2026-08-01T00:00:00.000Z');
    expect(params.get('page_size')).toBe('20');
  });
});

describe('cursorFromNextLink', () => {
  it('takes only the cursor out of the backend-built absolute URL', () => {
    // DRF builds `next` from ITS OWN host; we must not re-use that host.
    const next = 'http://backend.internal:8000/api/v1/events?page_size=20&cursor=cD0yMDI2LTA4';
    expect(cursorFromNextLink(next)).toBe('cD0yMDI2LTA4');
  });

  it('is null on the last page', () => {
    expect(cursorFromNextLink(null)).toBeNull();
    expect(cursorFromNextLink(undefined)).toBeNull();
  });

  it('is null (not a throw) for a link without a cursor', () => {
    expect(cursorFromNextLink('http://localhost:8000/api/v1/events')).toBeNull();
  });

  it('handles a relative link too', () => {
    expect(cursorFromNextLink('/api/v1/events?cursor=abc123')).toBe('abc123');
  });
});
