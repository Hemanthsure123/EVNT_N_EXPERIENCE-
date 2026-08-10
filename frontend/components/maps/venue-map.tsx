'use client';

import * as React from 'react';
import { ExternalLink, MapPin } from 'lucide-react';
import { directionsUrl } from '@/lib/api/maps';
import { useGoogleMaps } from '@/lib/maps/use-google-maps';
import { cn } from '@/lib/utils/cn';

/**
 * An interactive map with one marker: where the event actually is.
 *
 * ── IT RENDERS ONLY WHEN THE COORDINATES ARE REAL ─────────────────────────
 *
 * `latitude`/`longitude` are nullable on an Event — they are populated only
 * when the organizer picked a Places suggestion. With either missing, this
 * renders the address and a directions link instead of a map.
 *
 * That is the whole point. A default of (0, 0) is a real place: a patch of
 * the Atlantic off Ghana called Null Island. A marker there is not "roughly
 * right", it is confidently wrong, and it is exactly the kind of placeholder
 * this codebase refuses.
 *
 * ── FOUR STATES, ALL VISIBLE ──────────────────────────────────────────────
 *
 *   no coordinates   the organizer typed a venue freehand
 *   no key           this deployment has no Maps key
 *   loading          the script is on its way
 *   error            the script failed, or the key is rejected
 *
 * All four fall back to the same honest thing: the address, and a link that
 * opens the user's own maps app. That link is arguably better than the map
 * anyway — it has their location, live traffic and voice guidance.
 */

type VenueMapProps = {
  venue: string;
  city: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  className?: string;
  /** Google's zoom scale. 15 shows a few surrounding streets. */
  zoom?: number;
  height?: number;
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function VenueMap({
  venue,
  city,
  latitude,
  longitude,
  className,
  zoom = 15,
  height = 320,
}: VenueMapProps) {
  const lat = toNumber(latitude);
  const lng = toNumber(longitude);
  const hasCoordinates =
    lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  const state = useGoogleMaps('places');
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<unknown>(null);
  /**
   * The map could not be built, whatever the loader thinks.
   *
   * ── WHY THIS EXISTS ───────────────────────────────────────────────────
   *
   * `useGoogleMaps` reported `ready` while `google.maps.Map` was not a
   * constructor, so `new maps.Map(...)` threw INSIDE an effect — and an
   * exception in an effect is not contained to the component that threw it.
   * React unwound to the nearest error boundary, so the whole event page was
   * replaced by "Something went wrong": no title, no tickets, no Book button,
   * because a decorative map beside the venue address failed.
   *
   * A map is the least important thing on this page and it must not be able
   * to take the page down. It falls back to the address and a directions link
   * — which this component already renders for four other reasons, and which
   * is arguably the better artefact anyway.
   */
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (state !== 'ready' || !hasCoordinates || !containerRef.current) return;

    // Typed loosely on purpose: pulling in `@types/google.maps` for one marker
    // adds a large ambient declaration for an API surface used in one file.
    const maps = (window as unknown as { google?: { maps?: Record<string, never> } }).google
      ?.maps as unknown as
      | {
          Map: new (el: Element, options: unknown) => unknown;
          Marker: new (options: unknown) => unknown;
        }
      | undefined;

    // `ready` means the SCRIPT arrived. It does not mean this library did:
    // a rejected key, a blocked request or an async library import still in
    // flight all leave `google.maps` present and `Map` undefined.
    if (typeof maps?.Map !== 'function' || typeof maps?.Marker !== 'function') {
      setFailed(true);
      return;
    }

    try {
    const position = { lat: lat as number, lng: lng as number };
    const map = new maps.Map(containerRef.current, {
      center: position,
      zoom,
      // A venue map is for orientation, not exploration. Removing the chrome
      // keeps it from competing with the page it sits in.
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      // Scroll-wheel zoom OFF: this sits mid-page, and a map that swallows
      // the scroll wheel traps the reader. Ctrl+scroll and pinch still work.
      gestureHandling: 'cooperative',
    });
    mapRef.current = map;

    new maps.Marker({ position, map, title: venue });
    } catch {
      // Anything Google changes on their side degrades to the address rather
      // than to a blank page. Deliberately silent: there is nothing the reader
      // can do, and the fallback below tells them what they actually needed.
      setFailed(true);
    }
  }, [state, hasCoordinates, lat, lng, zoom, venue]);

  const address = [venue, city].filter(Boolean).join(', ');
  const link = directionsUrl(venue, city, hasCoordinates ? { latitude: lat!, longitude: lng! } : null);

  const showMap = hasCoordinates && state !== 'unavailable' && state !== 'error' && !failed;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {showMap ? (
        <div
          ref={containerRef}
          role="img"
          aria-label={`Map showing ${address}`}
          style={{ height }}
          className={cn(
            'w-full overflow-hidden rounded-2xl border border-border bg-muted',
            state === 'loading' && 'animate-pulse',
          )}
        />
      ) : null}

      <div className="flex items-start justify-between gap-4">
        <p className="flex items-start gap-2 text-body-sm">
          <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            <span className="font-medium">{venue}</span>
            {city ? <span className="text-muted-foreground"> · {city}</span> : null}
          </span>
        </p>

        <a
          href={link}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex shrink-0 items-center gap-1.5 text-body-sm font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Directions
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
    </div>
  );
}
