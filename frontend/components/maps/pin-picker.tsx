'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crosshair, Loader2 } from 'lucide-react';
import { geocodeAddress, reverseGeocode } from '@/lib/api/maps';
import { useGoogleMaps } from '@/lib/maps/use-google-maps';
import { Button, Input } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

/**
 * Drop the pin: an interactive map the organizer clicks or drags to say exactly
 * where their event is.
 *
 * ── THE PIN IS THE ORGANIZER'S, NEVER A GUESS ─────────────────────────────
 *
 * Nothing here writes a coordinate the organizer did not choose. Searching the
 * venue by name (`VenueAutocomplete`) covers the case where Google knows the
 * place; this covers the case it does not — a farm, a new space, the correct
 * gate of a stadium whose official pin is on the other side.
 *
 * The map has to be CENTRED somewhere before there is a pin, and that centre is
 * a VIEWPORT, not a value: it comes from geocoding "venue, city" and is never
 * written to the draft. A default coordinate would be (0, 0), which is a real
 * patch of the Atlantic off Ghana — the exact placeholder this codebase
 * refuses. So the draft stays null until a human clicks.
 *
 * ── THE REVERSE GEOCODE IS A LABEL, NOT THE ANSWER ────────────────────────
 *
 * Dropping a pin resolves an address for it, so the organizer can read back
 * where they just clicked. That address is DISPLAY only — the coordinates the
 * human chose are authoritative, and a failed lookup costs the label, never the
 * pin. It goes through OUR backend (`lib/api/maps`) rather than the browser's
 * own `google.maps.Geocoder`, which would bypass the server key, the server's
 * caching and its rate limit — the whole reason the proxy exists.
 *
 * ── IT RENDERS NOTHING WITHOUT A BROWSER KEY ───────────────────────────────
 *
 * `useGoogleMaps` reports `unavailable` when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
 * is unset, and this returns null: a map is the only way to place a pin, so a
 * deployment without a key gets no pin section rather than a grey box with
 * Google's "this page didn't load Google Maps correctly" watermark on it. The
 * venue, the city and the directions link all still work.
 */

type LatLng = { lat: number; lng: number };

/* Only the handful of Maps methods this file calls, typed by hand for the same
 * reason `venue-map.tsx` does it: `@types/google.maps` is a large ambient
 * declaration for an API surface used in two files. */
type MapsMouseEvent = { latLng?: { lat: () => number; lng: () => number } | null };
type MapsMarker = {
  setPosition: (position: LatLng) => void;
  setMap: (map: unknown) => void;
  addListener: (event: string, handler: (payload: MapsMouseEvent) => void) => void;
};
type MapsMap = {
  addListener: (event: string, handler: (payload: MapsMouseEvent) => void) => void;
  panTo: (position: LatLng) => void;
  setZoom: (zoom: number) => void;
};
type MapsApi = {
  Map: new (element: Element, options: unknown) => MapsMap;
  Marker: new (options: unknown) => MapsMarker;
};

/**
 * 7 decimal places, because `latitude`/`longitude` are
 * `DecimalField(decimal_places=7)` and DRF refuses more digits than the column
 * holds. It is ~11mm on the ground — finer than any venue pin needs, and far
 * finer than a fingertip on a phone can express.
 */
const round7 = (value: number) => Math.round(value * 1e7) / 1e7;

/** Close enough to read a building number off. */
const PIN_ZOOM = 17;
/** A city, not a building — used when the seed geocode is only locality-level. */
const CITY_ZOOM = 12;
/**
 * The opening viewport when there is no pin and no usable seed. India, because
 * that is where the events are. Purely a camera position: nothing is written
 * until the organizer clicks, so this is never mistaken for an answer.
 */
const FALLBACK_VIEW = { lat: 20.5937, lng: 78.9629, zoom: 4 };

type Props = {
  venue: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  /**
   * Commit the pin. `city` is what the reverse geocode called the area — offered
   * so a blank city field can be filled from the pin; the caller decides
   * whether to take it, because it must never overwrite what somebody typed.
   */
  onPick: (pin: { latitude: number; longitude: number; city: string }) => void;
  onClear: () => void;
  className?: string;
};

export function PinPicker({ venue, city, latitude, longitude, onPick, onClear, className }: Props) {
  const state = useGoogleMaps();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<MapsMap | null>(null);
  const markerRef = React.useRef<MapsMarker | null>(null);

  const saved = latitude !== null && longitude !== null ? { lat: latitude, lng: longitude } : null;
  /** Placed but not committed — the map shows it, the draft does not have it. */
  const [pending, setPending] = React.useState<LatLng | null>(null);
  const [label, setLabel] = React.useState<string | null>(null);
  const [resolvedCity, setResolvedCity] = React.useState('');
  const [resolving, setResolving] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  const [typedError, setTypedError] = React.useState<string | null>(null);
  /** Which reverse geocode is the current one, so a slow reply for a pin the
   *  organizer has already dragged away from cannot overwrite the new label. */
  const resolveTicket = React.useRef(0);

  const active = pending ?? saved;
  const hasPin = active !== null;
  const unsaved =
    pending !== null && (saved === null || saved.lat !== pending.lat || saved.lng !== pending.lng);

  const place = React.useCallback((lat: number, lng: number) => {
    const next = { lat: round7(lat), lng: round7(lng) };
    setPending(next);
    setLabel(null);
    setResolvedCity('');
    setTypedError(null);
    const ticket = ++resolveTicket.current;
    setResolving(true);
    reverseGeocode(next.lat, next.lng)
      .then((result) => {
        if (ticket !== resolveTicket.current) return;
        setLabel(result.formatted_address || null);
        setResolvedCity(result.city ?? '');
      })
      .catch(() => {
        // The label is a convenience. The coordinates came from the organizer,
        // not from this call, so a failure costs a line of text and nothing else.
        if (ticket === resolveTicket.current) setLabel(null);
      })
      .finally(() => {
        if (ticket === resolveTicket.current) setResolving(false);
      });
  }, []);

  /** Read by the map's own listeners, which are attached once and would
   *  otherwise close over the first render's `place`. */
  const placeRef = React.useRef(place);
  placeRef.current = place;

  /**
   * A viewport seed, and nothing more. Skipped once there is a pin — the pin is
   * a better centre than a geocode of its name, and asking anyway would spend a
   * paid call to learn something already known.
   */
  const address = [venue, city].filter(Boolean).join(', ');
  const seed = useQuery({
    queryKey: ['maps', 'geocode', address],
    queryFn: () => geocodeAddress(address, 'in'),
    enabled: state === 'ready' && !hasPin && address.trim().length > 2,
    staleTime: 3_600_000,
    // One attempt: this is decoration for the camera, and a retry loop against
    // a paid API to reposition a map nobody has looked at yet is not worth it.
    retry: false,
  });

  /* ── the map, created once ─────────────────────────────────────────── */

  React.useEffect(() => {
    if (state !== 'ready' || mapRef.current || !containerRef.current) return;

    const maps = (window as unknown as { google: { maps: unknown } }).google.maps as MapsApi;
    const start = active ?? FALLBACK_VIEW;
    const map = new maps.Map(containerRef.current, {
      center: { lat: start.lat, lng: start.lng },
      zoom: active ? PIN_ZOOM : FALLBACK_VIEW.zoom,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      // `greedy`, unlike the public venue map's `cooperative`: there the map is
      // something a reader scrolls past and must not trap the wheel; here the
      // map IS the task, and placing a pin means zooming in.
      gestureHandling: 'greedy',
      clickableIcons: false,
    });
    mapRef.current = map;

    map.addListener('click', (event) => {
      const position = event.latLng;
      if (position) placeRef.current(position.lat(), position.lng());
    });
    // `active` is deliberately not a dependency: it is the OPENING centre, and
    // re-creating the map on every drag would fight the organizer for the
    // viewport. Later positions are handled by the marker effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  /* ── the marker follows the value ──────────────────────────────────── */

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const maps = (window as unknown as { google: { maps: unknown } }).google.maps as MapsApi;

    if (!active) {
      markerRef.current?.setMap(null);
      markerRef.current = null;
      return;
    }
    if (markerRef.current) {
      markerRef.current.setPosition(active);
      return;
    }
    const marker = new maps.Marker({
      position: active,
      map,
      draggable: true,
      title: venue || 'Event location',
    });
    marker.addListener('dragend', (event) => {
      const position = event.latLng;
      if (position) placeRef.current(position.lat(), position.lng());
    });
    markerRef.current = marker;
    // Primitives rather than the object, whose identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, active?.lat, active?.lng, venue]);

  /* ── the seed, once it arrives ─────────────────────────────────────── */

  React.useEffect(() => {
    const map = mapRef.current;
    const result = seed.data;
    if (!map || !result || hasPin) return;
    map.panTo({ lat: result.latitude, lng: result.longitude });
    // `APPROXIMATE` means Google matched a locality rather than a building —
    // `maps_port`'s own note says a caller storing a venue pin should refuse it.
    // Nothing is stored here, but framing a city centroid at rooftop zoom is how
    // a viewport gets mistaken for an answer, so it opens at city zoom instead.
    map.setZoom(result.location_type === 'APPROXIMATE' ? CITY_ZOOM : PIN_ZOOM);
  }, [seed.data, hasPin, state]);

  /* ── actions ──────────────────────────────────────────────────────── */

  const commit = () => {
    if (!pending) return;
    onPick({ latitude: pending.lat, longitude: pending.lng, city: resolvedCity });
  };

  /** Forget an uncommitted pin. The saved one, if any, is untouched — the marker
   *  effect follows `pending ?? saved`, so it walks back to it. */
  const discard = () => {
    setPending(null);
    setLabel(null);
    setResolvedCity('');
    setTypedError(null);
    // Bumped so a reverse geocode still in flight for the discarded position
    // cannot land and label the pin the organizer just went back to.
    resolveTicket.current += 1;
    // The marker moves on its own; the CAMERA does not, and a marker that walks
    // off the edge of a map somebody dragged across a city reads as lost.
    if (saved) mapRef.current?.panTo(saved);
  };

  const clear = () => {
    discard();
    onClear();
  };

  /**
   * Coordinates, pasted.
   *
   * The map is a pointer affordance — click and drag are both mouse gestures —
   * so without this the pin would be unreachable by keyboard. It also happens to
   * be how coordinates actually travel between people: a venue sends "19.0760,
   * 72.8777" in a message, and retyping it into a map by eye is worse than
   * pasting it.
   */
  const placeTyped = () => {
    const parts = typed
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(Number);
    const [lat, lng] = parts;
    if (
      parts.length !== 2 ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      setTypedError('Give a latitude and longitude, like 19.0760, 72.8777.');
      return;
    }
    place(lat, lng);
    setTyped('');
    mapRef.current?.panTo({ lat: round7(lat), lng: round7(lng) });
    mapRef.current?.setZoom(PIN_ZOOM);
  };

  // Every hook above runs unconditionally; the key check is the last thing.
  if (state === 'unavailable') return null;

  return (
    <div
      className={cn(
        'flex flex-col gap-stack rounded-xl border border-border bg-surface p-card shadow-sm',
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex items-center gap-2 text-body-sm font-medium">
          <Crosshair className="size-4 text-primary" aria-hidden />
          Pin the exact spot
        </p>
        {saved ? (
          <span className="shrink-0 text-caption text-success-subtle-foreground">Pinned</span>
        ) : null}
      </div>

      <p className="max-w-prose text-body-sm text-muted-foreground">
        Click the map, or drag the pin. The event page shows a map only once a pin is saved —
        without one it shows the address and a directions link, which is honest but plainer.
      </p>

      {state === 'error' ? (
        <p role="alert" className="text-caption text-destructive">
          The map script did not load, so a pin cannot be placed here. Everything else on this step
          still saves.
        </p>
      ) : (
        <div
          ref={containerRef}
          aria-label="Map for placing the event's pin"
          style={{ height: 300 }}
          className={cn(
            'w-full overflow-hidden rounded-xl border border-border bg-muted',
            state === 'loading' && 'animate-pulse',
          )}
        />
      )}

      {active ? (
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-caption text-muted-foreground">
          <span className="tabular-nums text-foreground">
            {active.lat}, {active.lng}
          </span>
          {resolving ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              looking up the address
            </span>
          ) : label ? (
            <span>{label}</span>
          ) : null}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {unsaved ? (
          <Button size="sm" onClick={commit}>
            Use this location
          </Button>
        ) : null}
        {/* Two different acts, so two different buttons rather than one label
            that changes: going back to the pin that IS saved is not the same as
            removing it, and a "Discard" that also deleted the saved pin would be
            destroying the thing it offered to keep. */}
        {unsaved && saved ? (
          <Button variant="ghost" size="sm" onClick={discard}>
            Back to the saved pin
          </Button>
        ) : null}
        {active ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear pin
          </Button>
        ) : null}
      </div>

      {unsaved ? (
        <p className="text-caption text-warning-subtle-foreground">
          Not saved yet — press “Use this location” to keep it.
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5 border-t border-border pt-stack">
        <label htmlFor="event-pin-coordinates" className="text-caption text-muted-foreground">
          Or paste coordinates
        </label>
        <div className="flex flex-wrap items-start gap-2">
          <Input
            id="event-pin-coordinates"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              setTypedError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                // The Studio is not inside a <form>, but a bare Enter in a text
                // field is what everybody expects to submit it.
                event.preventDefault();
                placeTyped();
              }
            }}
            placeholder="19.0760, 72.8777"
            inputMode="decimal"
            aria-invalid={Boolean(typedError)}
            aria-describedby={typedError ? 'event-pin-coordinates-error' : undefined}
            className="w-full max-w-64"
          />
          <Button variant="outline" size="sm" onClick={placeTyped} disabled={!typed.trim()}>
            Place
          </Button>
        </div>
        {typedError ? (
          <p
            id="event-pin-coordinates-error"
            role="alert"
            className="text-caption text-destructive"
          >
            {typedError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
