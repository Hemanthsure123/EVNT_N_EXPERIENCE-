'use client';

import * as React from 'react';
import { Crosshair, MapPin, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { POPULAR_CITIES } from '@/lib/discovery/cities';
import { useLocationContext } from '@/lib/location/location-context';

/**
 * The soft ask.
 *
 * `navigator.geolocation` is NEVER called on load — only when this button is
 * pressed, and the card explains what it's for first. A permission prompt fired
 * at page load is the fastest route to a permanent denial, and browsing works
 * perfectly well without it.
 *
 * Dismissing is sticky and the card says where to change it later, so "close /
 * don't change location" is a real exit, not a nag that returns next visit.
 */
export function LocationCard() {
  const { city, status, ready, dismissed, detect, setCity, dismiss } = useLocationContext();

  // Nothing to ask once a city is known, or if the user closed it before.
  if (!ready || city || dismissed) return null;

  const locating = status === 'locating';
  const failed = status === 'denied' || status === 'unserved' || status === 'unsupported';

  return (
    <div className="relative flex flex-col gap-4 rounded-xl border border-border bg-surface p-card shadow-md sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3 pr-8 sm:pr-0">
        {/* Warm cream with dark ink — the quiet "you are here" tint. It was the
            old violet-100 medallion, and violet is wayfinding-only now. */}
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-nav-active text-nav-active-foreground">
          <MapPin className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-body font-semibold text-foreground">
            {failed ? 'Pick a city instead' : "See what's on near you"}
          </p>
          <p className="text-body-sm text-muted-foreground">
            {status === 'denied'
              ? 'Location permission was declined. Choose a city and we’ll sort by what’s close.'
              : status === 'unserved'
                ? "We don't have events near you yet — pick a city to browse."
                : status === 'unsupported'
                  ? "This browser can't share a location — pick a city to browse."
                  : 'Share your location once and we’ll put nearby events first. You can change it any time from the top nav.'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
        {!failed ? (
          <Button
            onClick={detect}
            loading={locating}
            leftIcon={locating ? undefined : <Crosshair className="size-4" aria-hidden />}
          >
            {locating ? 'Finding you…' : 'Use my location'}
          </Button>
        ) : null}
        <label className="sr-only" htmlFor="location-card-city">
          Choose a city
        </label>
        <select
          id="location-card-city"
          defaultValue=""
          onChange={(event) => {
            const next = POPULAR_CITIES.find((c) => c.slug === event.target.value);
            if (next) setCity(next);
          }}
          className="h-control rounded-full border border-input bg-surface px-4 text-body-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <option value="" disabled>
            Choose a city
          </option>
          {POPULAR_CITIES.map((option) => (
            <option key={option.slug} value={option.slug}>
              {option.name}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Close — don't change my location"
        className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:static sm:self-start"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
