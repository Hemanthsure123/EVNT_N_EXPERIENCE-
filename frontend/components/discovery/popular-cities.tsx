import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { SpotCity } from '@/components/illustrations/spots';
import { POPULAR_CITIES } from '@/lib/discovery/cities';
import { cn } from '@/lib/utils/cn';

/**
 * Popular cities — the second entry point into browse, after categories.
 *
 * White card, hairline, soft shadow, neutral hover edge. The one violet left is
 * on the ARROW, which is wayfinding — it points at where the press goes — and
 * not on the card's border, where it was a brand colour used as a generic
 * "something is hoverable here" signal.
 *
 * ── A CHIP ON A PHONE, A CARD FROM `sm` ───────────────────────────────────
 *
 * Ten cities two-up with `p-card` and a two-line blurb was ~108px a tile and
 * ~590px of scroll for a strip whose entire job is "jump to a city". The blurb
 * is the height: "Arena tours & comedy clubs" wraps to two or three lines at
 * 173px, and none of it changes which city somebody taps.
 *
 * Below `sm` the tile is a 56px CHIP — the spot illustration, the name, and
 * nothing else. The blurb and the arrow return at `sm`, where there is room for
 * them to be read rather than stepped over. 10 chips are ~328px, down from
 * ~588px, and every one is still well past the 44px touch floor.
 *
 * The illustration is `SpotCity` rather than a lucide pin: at 32px a line icon
 * beside a city name reads as a form field's adornment, and the spot carries a
 * little texture at a size where a clay object would be mud.
 */
export function PopularCities({ className }: { className?: string }) {
  return (
    <ul
      className={cn('grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5', className)}
    >
      {POPULAR_CITIES.map((city) => (
        <li key={city.slug}>
          <Link
            href={`/cities/${city.slug}`}
            className={cn(
              'group flex h-full flex-col justify-between gap-2 rounded-xl border border-border bg-surface p-3 shadow-sm transition duration-base ease-spring',
              'sm:gap-3 sm:p-card',
              'hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lg',
              'active:translate-y-0 active:scale-[0.98] active:duration-fast',
              'motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <span className="flex items-center gap-2.5">
              {/* Decorative: the city NAME is the accessible content, and a
                  second "city" announcement before it would be noise. */}
              <span className="shrink-0" aria-hidden>
                <SpotCity className="size-8 lg:size-9" />
              </span>
              <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-foreground sm:text-body">
                {city.name}
              </span>
              {/* The arrow leaves in the direction it points — up and to the
                  right, matching the glyph rather than the generic slide the
                  forward CTAs use. Hidden on the chip: at ~100px of name width
                  it is competing with the city for the row. */}
              <ArrowUpRight
                className={cn(
                  'hidden size-4 shrink-0 text-muted-foreground transition-[color,transform] duration-base ease-spring sm:block',
                  'group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary',
                  'motion-reduce:transition-none motion-reduce:group-hover:transform-none',
                )}
                aria-hidden
              />
            </span>
            <span className="hidden text-caption text-muted-foreground sm:block">{city.blurb}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
