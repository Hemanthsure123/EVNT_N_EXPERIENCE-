import { type City, matchCityName, nearestCity } from '@/lib/discovery/cities';
import { isApiError } from '@/lib/api/errors';
import { reverseGeocode } from '@/lib/api/maps';

/**
 * A geolocation fix -> a city we can filter on.
 *
 * ── WHY THIS IS NOT ONE LINE ─────────────────────────────────────────────
 *
 * "Use my current location" used to be an offline nearest-match against ten
 * coordinates, so a user in Kochi was told they were in Chennai — confidently,
 * with no way to tell that answer apart from a real one. This module exists to
 * make those two cases DIFFERENT THINGS.
 *
 *   `exact`       — a geocoder named the place and we can filter on that name.
 *   `approximate` — we could not ask, or could not map the answer, so this is
 *                   the NEAREST of the 186 bundled cities. Every caller has to
 *                   say so; nothing may present it as a location.
 *   `unknown`     — no honest answer at all. Show the manual list.
 *
 * ── THE ENDPOINT REFUSES ANONYMOUS CALLERS TODAY ─────────────────────────
 *
 * `GET /maps/geocode` is `IsAuthenticated`, and the overwhelming majority of
 * people choosing a city have not signed in — browsing needs no account, which
 * is the whole product. So for now the honest path for a signed-out visitor is
 * `approximate` + a plain sentence, and `because: 'refused'` is what records
 * that it was an authorisation refusal rather than a network failure. The
 * one-line backend change that turns this into `exact` for everybody is in the
 * agent report's `needs_from_others`; nothing here changes when it lands.
 */

/** Why a geocoded answer was not available. */
export type FixFailure =
  /** The endpoint refused an anonymous caller (401/403). */
  | 'refused'
  /** No Maps key, an upstream error, or the request never completed. */
  | 'unavailable'
  /** It answered, but with a place we cannot turn into a filter value. */
  | 'unnamed';

export type CityFix =
  | { kind: 'exact'; city: City }
  | { kind: 'approximate'; city: City; because: FixFailure }
  | { kind: 'unknown'; because: FixFailure | 'out_of_range' };

/** Classify a thrown value from the geocode call. Pure, so it is testable. */
export function classifyFailure(error: unknown): FixFailure {
  if (isApiError(error) && error.isAuthError) return 'refused';
  return 'unavailable';
}

/**
 * The nearest-city fallback, tagged with why we had to reach for it.
 *
 * With nothing inside `nearestCity`'s radius the reported reason becomes
 * `out_of_range` rather than the geocoder's failure: "we could not match you
 * to a city" is the fact the reader needs, and it is true whichever way we got
 * there.
 */
function fallback(lat: number, lng: number, because: FixFailure): CityFix {
  const near = nearestCity(lat, lng);
  if (!near) return { kind: 'unknown', because: 'out_of_range' };
  return { kind: 'approximate', city: near, because };
}

type Geocoder = (lat: number, lng: number) => Promise<{ city: string }>;

export async function resolveCityFromFix(
  lat: number,
  lng: number,
  // Injected so the branches can be tested without a network or a token.
  geocode: Geocoder = reverseGeocode,
): Promise<CityFix> {
  let name: string;
  try {
    name = (await geocode(lat, lng)).city;
  } catch (error) {
    return fallback(lat, lng, classifyFailure(error));
  }

  const matched = matchCityName(name);
  if (matched) return { kind: 'exact', city: matched };

  // It answered with a real place that is not one of ours — a town, or a city
  // spelled a way no event uses. The nearest city is still the best available
  // answer, but it is a guess and is labelled as one.
  return fallback(lat, lng, 'unnamed');
}
