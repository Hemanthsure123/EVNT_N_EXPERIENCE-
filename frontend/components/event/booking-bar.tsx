'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchEventTiers } from '@/lib/api/events';
import type { TicketTier } from '@/lib/api/types';
import { formatFromPrice } from '@/lib/discovery/format';
import { availabilityLabel, isUrgent, summariseTiers } from '@/lib/discovery/tiers';
import { cn } from '@/lib/utils/cn';

/**
 * The mobile booking bar — price, availability, and one way to the tiers.
 *
 * It is NOT a second checkout entry point. The brief's "avoid duplicated CTAs"
 * is a real trap here: two buttons that both claim to start a booking make the
 * page feel like two pages. So the desktop rail owns tier selection, this bar
 * owns getting you there, and only one of them exists at any width
 * (`lg:hidden` here, `hidden lg:flex` on the rail).
 *
 * It is visible from ARRIVAL and yields only once the ticket panel is properly
 * in view — a bar pointing at a panel you are already reading is chrome over
 * content, but a page that opens with no price and no CTA is worse. See the
 * `rootMargin` note below for the six-pixel bug that made it the latter.
 *
 * It shares the panel's query key, so it reads the same live inventory from the
 * cache without issuing a second request.
 *
 * `.glass` is the one place this page earns a frosted surface: it is genuinely
 * floating chrome with content scrolling underneath it, which is the only thing
 * the recipe is allowed on. Its HAIRLINE carries the "there is a bar here"
 * signal, because on a white page a white-ish frost has no edge of its own.
 *
 * Its button is the same BLACK PILL as the panel's, so the mobile and desktop
 * paths to checkout look like the same action rather than two different ones.
 */

export function BookingBar({
  eventId,
  initialTiers,
}: {
  eventId: string;
  initialTiers: TicketTier[];
}) {
  const query = useQuery({
    queryKey: ['event-tiers', eventId],
    queryFn: () => fetchEventTiers(eventId),
    initialData: { data: initialTiers },
    staleTime: 0,
  });

  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const panel = document.getElementById('tickets');
    if (!panel) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!entry?.isIntersecting), {
      // `threshold: 0` alone meant ONE PIXEL of the panel counted as "the
      // panel is on screen", so the bar hid itself the instant the panel's
      // top edge touched the bottom of the viewport.
      //
      // Measured on a 844px phone: the panel's top sat at 838px on arrival —
      // six pixels in, entirely unreadable — and the bar dutifully vanished.
      // The result was a conversion page that opened with no price and no way
      // to book anywhere on the first screen, which is the one thing this bar
      // exists to prevent.
      //
      // The negative bottom margin shrinks the observed region to the upper
      // 45% of the viewport, so the bar only yields once the panel is somewhere
      // the reader is actually looking. Until then price and CTA stay pinned,
      // which is what every booking app does and what the rule was always
      // meant to express.
      rootMargin: '0px 0px -55% 0px',
      threshold: 0,
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  const { fromPrice, state } = summariseTiers(query.data?.data);
  const price = formatFromPrice(fromPrice);
  const label = availabilityLabel(state);
  const soldOut = state.kind === 'sold_out';

  return (
    <div
      className={cn(
        // Above the bottom nav, and only on viewports without the desktop rail.
        // `bottom-bottom-nav` is the nav's own height token rather than a
        // hard-coded 16 — the two were free to drift apart before.
        'glass fixed inset-x-0 bottom-bottom-nav z-sticky border-t px-4 py-3 shadow-xl lg:hidden',
        'transition-[opacity,transform] duration-base ease-spring',
        visible ? 'visible translate-y-0 opacity-100' : 'invisible translate-y-full opacity-0',
        'motion-reduce:transition-none',
      )}
    >
      <div className="flex items-center gap-4">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-body-lg font-semibold tabular-nums text-foreground">
            {price === 'Free' ? 'Free entry' : price ? `from ${price}` : 'Pricing soon'}
          </span>
          {label ? (
            <span
              className={cn(
                'truncate text-caption',
                soldOut
                  ? 'text-destructive-subtle-foreground'
                  : isUrgent(state)
                    ? 'text-warning-subtle-foreground'
                    : 'text-muted-foreground',
              )}
            >
              {label}
            </span>
          ) : null}
        </div>

        <a
          href={`/booking/${eventId}`}
          className={cn(
            'ml-auto inline-flex h-control shrink-0 items-center justify-center rounded-full px-pill text-label',
            soldOut
              ? 'border border-input text-muted-foreground'
              : 'bg-cta text-cta-foreground shadow-sm transition-colors duration-fast hover:bg-cta-hover active:bg-cta-active',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          )}
        >
          {soldOut ? 'See tiers' : 'Book tickets'}
        </a>
      </div>
    </div>
  );
}
