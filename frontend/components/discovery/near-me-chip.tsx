'use client';

import * as React from 'react';
import Link from 'next/link';
import { Crosshair, Loader2, Navigation } from 'lucide-react';
import { browseHref } from '@/lib/discovery/filters';
import { useLocationContext } from '@/lib/location/location-context';
import { cn } from '@/lib/utils/cn';

/** Kept in lockstep with `quick-filters.tsx` — these sit in one row and any
 *  difference between them reads as a rendering bug rather than as a variant. */
const CHIP_CLASS = cn(
  'inline-flex h-control items-center gap-2 rounded-full border border-border bg-surface px-pill text-label text-foreground shadow-sm',
  'transition duration-fast ease-spring hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md',
  'motion-reduce:hover:translate-y-0',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
);

/**
 * "Near me" — the one quick filter that can't be a plain link.
 *
 * With a city already chosen it IS a link, and behaves exactly like its
 * neighbours. Without one it's a button that asks for location on the spot: a
 * soft ask at the moment the user expressed the intent, which is the only time
 * a permission prompt is reasonable.
 *
 * It's a separate client island so the other four chips stay server-rendered
 * with zero JS.
 *
 * ── A NEAREST-MATCH SAYS SO, EVEN HERE ────────────────────────────────────
 *
 * When the city came from the bundled nearest-match rather than a lookup, the
 * chip says "Near <city>" instead of "<city>". One word, and it is the
 * difference between a claim and an approximation — the chip is often the only
 * place a detected city is visible on a narrow viewport, so it cannot be the
 * one surface that rounds a guess up to a fact.
 */
export function NearMeChip() {
  const { city, status, precision, ready, detect } = useLocationContext();

  if (ready && city) {
    const approximate = precision === 'approximate';
    return (
      <Link
        href={browseHref({ city: city.name })}
        className={CHIP_CLASS}
        title={approximate ? `Nearest city we list to your location` : undefined}
      >
        <Navigation className="size-3.5 text-primary" aria-hidden />
        {approximate ? `Near ${city.name}` : city.name}
      </Link>
    );
  }

  const locating = status === 'locating';
  return (
    <button type="button" onClick={detect} disabled={locating} className={CHIP_CLASS}>
      {locating ? (
        <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
      ) : (
        <Crosshair className="size-3.5 text-primary" aria-hidden />
      )}
      {locating ? 'Finding you…' : 'Near me'}
    </button>
  );
}
