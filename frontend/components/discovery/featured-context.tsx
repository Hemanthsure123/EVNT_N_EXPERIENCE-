'use client';

import * as React from 'react';
import type { EventCard } from '@/lib/api/types';

/**
 * Shared state between the hero carousel and the floating island.
 *
 * The island is the SAME carousel in a different form factor, so it must show
 * the same event at the same moment, and moving one has to move the other. That
 * only works with a single owner of the index — two independent timers would
 * drift apart within seconds and destroy the illusion that one thing became the
 * other.
 *
 * `userTookOver` lives here for the same reason: choosing a slide in the hero
 * has to stop the island advancing too, or the thing the user just picked would
 * be replaced by the island a few seconds later.
 */

type FeaturedState = {
  events: EventCard[];
  index: number;
  /** True while the carousel is actually advancing (drives both progress bars). */
  autoplaying: boolean;
  userTookOver: boolean;
  /** Autoplay tick — advances one slide, wrapping. */
  advance: () => void;
  /** Manual selection: moves to a slide AND stops autoplay for good. */
  goTo: (index: number) => void;
  setAutoplaying: (autoplaying: boolean) => void;
};

const FeaturedContext = React.createContext<FeaturedState | null>(null);

export function FeaturedProvider({
  events,
  children,
}: {
  events: EventCard[];
  children: React.ReactNode;
}) {
  const count = events.length;
  const [index, setIndex] = React.useState(0);
  const [autoplaying, setAutoplaying] = React.useState(false);
  const [userTookOver, setUserTookOver] = React.useState(false);

  const advance = React.useCallback(() => {
    setIndex((i) => (count ? (i + 1) % count : 0));
  }, [count]);

  const goTo = React.useCallback(
    (next: number) => {
      if (!count) return;
      setUserTookOver(true);
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  const value = React.useMemo<FeaturedState>(
    () => ({ events, index, autoplaying, userTookOver, advance, goTo, setAutoplaying }),
    [events, index, autoplaying, userTookOver, advance, goTo],
  );

  return <FeaturedContext.Provider value={value}>{children}</FeaturedContext.Provider>;
}

/** Null outside a provider, so a consumer can simply not render. */
export function useFeatured(): FeaturedState | null {
  return React.useContext(FeaturedContext);
}
