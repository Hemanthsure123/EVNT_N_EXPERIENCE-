import { api } from './client';

/**
 * Google Maps Platform, through our backend.
 *
 * ── ONLY THE JAVASCRIPT API TALKS TO GOOGLE FROM THE BROWSER ──────────────
 *
 * Everything here goes through the backend on the SERVER key. That is not
 * indirection for its own sake:
 *
 * - a referrer-restricted browser key is not a secure key — the restriction
 *   is a header any script can set;
 * - the backend caches, so one visitor's place lookup serves the next;
 * - rate limits and quota live server-side, so a runaway client loop hits our
 *   throttle rather than the billing account.
 *
 * The Maps JavaScript API is the one exception, because a map has to render
 * client-side. It uses `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, restricted by HTTP
 * referrer in the Google console.
 */

export type MapsConfig = { available: boolean };

export type PlaceSuggestion = {
  place_id: string;
  description: string;
  main_text: string;
  secondary_text: string;
  types: string[];
};

export type PlacePhoto = {
  reference: string;
  width: number;
  height: number;
  /** Google REQUIRES these displayed wherever the photo is. Not optional. */
  attributions: string[];
};

export type PlaceDetail = {
  place_id: string;
  name: string;
  formatted_address: string;
  latitude: number;
  longitude: number;
  city: string;
  country: string;
  postal_code: string;
  types: string[];
  phone_number: string;
  website: string;
  business_status: string;
  photos: PlacePhoto[];
};

export type GeocodeResult = {
  formatted_address: string;
  latitude: number;
  longitude: number;
  place_id: string;
  city: string;
  country: string;
  postal_code: string;
  /** ROOFTOP > RANGE_INTERPOLATED > GEOMETRIC_CENTER > APPROXIMATE. */
  location_type: string;
};

export type TravelMode = 'driving' | 'walking' | 'transit' | 'bicycling';

export type RouteStep = {
  instruction: string;
  distance_metres: number;
  duration_seconds: number;
  travel_mode: string;
};

export type Route = {
  summary: string;
  distance_metres: number;
  duration_seconds: number;
  polyline: string;
  start_address: string;
  end_address: string;
  fare_minor: number | null;
  fare_currency: string;
  warnings: string[];
  steps: RouteStep[];
};

export type DistanceCell = {
  destination: string;
  /** `null` when Google could not route this pair — never render it as 0. */
  distance_metres: number | null;
  duration_seconds: number | null;
  status: string;
};

const query = (params: Record<string, string | number | boolean | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
};

/** Whether this deployment has a Maps key at all. Ask BEFORE rendering. */
export const fetchMapsConfig = () => api.get<MapsConfig>('/maps/config', { auth: false });

export const fetchPlaceSuggestions = (params: {
  q: string;
  session_token?: string;
  country?: string;
  types?: string;
}) => api.get<{ data: PlaceSuggestion[] }>(`/maps/places/autocomplete${query(params)}`);

export const fetchPlaceDetail = (placeId: string, sessionToken?: string) =>
  api.get<PlaceDetail>(
    `/maps/places/${encodeURIComponent(placeId)}${query({ session_token: sessionToken })}`,
  );

export const searchPlaces = (q: string) =>
  api.get<{ data: PlaceDetail[] }>(`/maps/places/search${query({ q })}`);

export const geocodeAddress = (address: string, country?: string) =>
  api.get<GeocodeResult>(`/maps/geocode${query({ address, country })}`);

/**
 * Coordinates -> a place name. The real answer behind "use my current
 * location".
 *
 * ── IT REFUSES ANONYMOUS CALLERS, AND THAT IS THE WRONG AUDIENCE ──────────
 *
 * `GET /maps/geocode` is `IsAuthenticated`. The people choosing a city are
 * overwhelmingly signed OUT — browsing needs no account, which is the product —
 * so for them this 401s and `lib/location/resolve-city.ts` degrades to the
 * bundled nearest-city match, clearly labelled as approximate everywhere it
 * surfaces.
 *
 * `auth` is deliberately left at its default rather than forced to `false`: a
 * signed-in visitor DOES get the exact answer, and dropping the header would
 * take that away without gaining anything. The one-line backend change that
 * makes it exact for everybody is recorded in the slice's `needs_from_others`.
 */
export const reverseGeocode = (lat: number, lng: number) =>
  api.get<GeocodeResult>(`/maps/geocode${query({ lat, lng })}`);

export const fetchDirections = (params: {
  origin: string;
  destination: string;
  mode?: TravelMode;
  departure_time?: number;
}) => api.get<{ data: Route[] }>(`/maps/directions${query(params)}`, { auth: false });

export const fetchDistanceMatrix = (body: {
  origins: string[];
  destinations: string[];
  mode?: TravelMode;
  departure_time?: number;
}) => api.post<{ data: DistanceCell[][] }>('/maps/distance-matrix', body);

/**
 * The proxied photo URL.
 *
 * A path on OUR origin, never Google's: their photo endpoint takes the API
 * key as a query parameter, so linking it directly would publish the server
 * key in an `<img src>` for anyone to read.
 */
export function placePhotoUrl(reference: string, maxWidth = 800): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
  return `${base}/api/v1/maps/places/photo${query({ reference, max_width: maxWidth })}`;
}

/**
 * A Google Maps directions link.
 *
 * Deliberately kept even now that the Directions API is wired: it opens the
 * user's own maps app with their own location, live traffic and turn-by-turn
 * voice guidance — none of which an embedded route can do. The in-page
 * directions answer "how far is it"; this one answers "take me there".
 *
 * Prefers coordinates when the venue was resolved, because a place name is
 * ambiguous and a lat/lng is not.
 */
export function directionsUrl(
  venue: string,
  city: string,
  coordinates?: {
    latitude: number;
    longitude: number;
  } | null,
): string {
  const destination = coordinates
    ? `${coordinates.latitude},${coordinates.longitude}`
    : [venue, city].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`;
}
