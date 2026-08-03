import * as React from 'react';
import Link from 'next/link';
import { CalendarDays, CalendarRange, IndianRupee, Sparkles } from 'lucide-react';
import { browseHref } from '@/lib/discovery/filters';
import { cn } from '@/lib/utils/cn';
import { NearMeChip } from './near-me-chip';

/**
 * The hero's one-tap intents, sitting directly under the search.
 *
 * These are LINKS, not toggles — each is a real, shareable `/events` URL that
 * the server can render. That keeps the hero a Server Component (zero client JS
 * for five of the highest-intent taps on the page) and means the browse page
 * receives the filter already applied rather than reconstructing it.
 *
 * Five: date, price and place — the axes people actually decide on first. Four
 * are static links; "Near me" needs the location context, so it's a separate
 * client island (see near-me-chip.tsx) and the rest cost no JS.
 *
 * The row WRAPS, it never scrolls. A horizontal scroller in the hero hides
 * options behind a gesture and puts a scrollbar under the headline; wrapping
 * shows every chip at every width, which is the actual requirement.
 *
 * Each chip is an OPAQUE white pill with a hairline, at the 44px touch-target
 * floor. Only the leading icon is violet — the sanctioned wayfinding use — and
 * the hover edge is a neutral, because these are five equal shortcuts and not
 * five calls to action.
 */
const QUICK_FILTERS = [
  { label: 'Today', icon: CalendarDays, href: browseHref({ when: 'today' }) },
  { label: 'This weekend', icon: CalendarRange, href: browseHref({ when: 'weekend' }) },
  { label: 'Free', icon: Sparkles, href: browseHref({ price: 'free' }) },
  { label: 'Under ₹500', icon: IndianRupee, href: browseHref({ price: 'under-500' }) },
];

export function QuickFilters({ className }: { className?: string }) {
  return (
    <nav aria-label="Quick filters" className={className}>
      <ul className="flex flex-wrap gap-2">
        {QUICK_FILTERS.map((filter) => (
          <li key={filter.label}>
            <Link
              href={filter.href}
              className={cn(
                // OPAQUE, and 44px tall. The 80% surface existed to blend into
                // a dark hero that no longer exists; on a white page a
                // translucent white pill has nothing to blend with and no edge
                // of its own. `h-control` is the touch-target floor, named so
                // it cannot drift back below it.
                'group inline-flex h-control items-center gap-2 rounded-full border border-border bg-surface px-pill text-label text-foreground shadow-sm',
                'transition duration-base ease-spring hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md',
                'active:translate-y-0 active:scale-[0.98] active:duration-fast',
                'motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              )}
            >
              <filter.icon
                className="size-3.5 text-primary transition-transform duration-base ease-spring group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                aria-hidden
              />
              {filter.label}
            </Link>
          </li>
        ))}
        <li>
          <NearMeChip />
        </li>
      </ul>
    </nav>
  );
}
