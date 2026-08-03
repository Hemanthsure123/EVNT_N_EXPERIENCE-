import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { classifyFailure, resolveCityFromFix } from './resolve-city';

/** Kochi, to two decimals. */
const KOCHI = { lat: 9.93, lng: 76.27 };

/**
 * The point of this module is that a looked-up city and a nearest-match are
 * DIFFERENT ANSWERS. Every test here is really the same assertion: a guess is
 * never returned wearing the shape of a fact.
 */
describe('resolveCityFromFix', () => {
  it('is exact when the geocoder names a city we filter on', async () => {
    const fix = await resolveCityFromFix(KOCHI.lat, KOCHI.lng, async () => ({ city: 'Kochi' }));
    expect(fix).toEqual({ kind: 'exact', city: expect.objectContaining({ name: 'Kochi' }) });
  });

  it('is exact through an alias, because the backend matches names exactly', async () => {
    const fix = await resolveCityFromFix(12.97, 77.59, async () => ({ city: 'Bangalore' }));
    expect(fix.kind).toBe('exact');
    expect(fix.kind === 'exact' && fix.city.name).toBe('Bengaluru');
  });

  it('degrades to an APPROXIMATE match when the endpoint refuses us', async () => {
    // `GET /maps/geocode` is `IsAuthenticated` and most people choosing a city
    // are signed out. This is the branch nearly every real visitor takes today,
    // and `because: 'refused'` is what lets the sheet say so in plain words.
    const fix = await resolveCityFromFix(KOCHI.lat, KOCHI.lng, async () => {
      throw new ApiError(403, 'permission_denied', 'Authentication credentials were not provided.');
    });
    expect(fix).toEqual({
      kind: 'approximate',
      because: 'refused',
      city: expect.objectContaining({ name: 'Kochi' }),
    });
  });

  it('separates an outage from a refusal', async () => {
    const fix = await resolveCityFromFix(KOCHI.lat, KOCHI.lng, async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(fix.kind === 'approximate' && fix.because).toBe('unavailable');
  });

  it('falls back when the answer is a place we cannot filter on', async () => {
    // A real village, correctly returned, that no event is listed under.
    const fix = await resolveCityFromFix(KOCHI.lat, KOCHI.lng, async () => ({
      city: 'Chellanam',
    }));
    expect(fix).toEqual({
      kind: 'approximate',
      because: 'unnamed',
      city: expect.objectContaining({ name: 'Kochi' }),
    });
  });

  it('returns nothing at all rather than the nearest Indian city to Paris', async () => {
    const fix = await resolveCityFromFix(48.85, 2.35, async () => {
      throw new ApiError(401, 'not_authenticated', 'nope');
    });
    expect(fix).toEqual({ kind: 'unknown', because: 'out_of_range' });
  });
});

describe('classifyFailure', () => {
  it('reads 401 and 403 as a refusal and everything else as an outage', () => {
    expect(classifyFailure(new ApiError(401, 'x', 'x'))).toBe('refused');
    expect(classifyFailure(new ApiError(403, 'x', 'x'))).toBe('refused');
    expect(classifyFailure(new ApiError(502, 'x', 'x'))).toBe('unavailable');
    expect(classifyFailure(new Error('boom'))).toBe('unavailable');
  });
});
