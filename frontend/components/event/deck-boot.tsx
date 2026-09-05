'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useEventDeck } from '@/lib/discovery/event-deck-context';
import type { EventContent } from '@/lib/api/event-content';
import type { EventDetail } from '@/lib/api/types';
import { DeckShell } from './deck-skeleton';

/**
 * A SHARED LINK OPENS THE DECK, MAXIMIZED.
 *
 * ── THE PROBLEM THIS SOLVES ───────────────────────────────────────────────
 *
 * On a phone the deck IS the event page: every card on every surface opens it
 * and nothing links to the standalone route. But arrival was never covered —
 * and arrival is how most people meet an event, because the deck itself hands
 * out `/events/{slug}-{uuid}` through Share, the calendar file, the booking
 * emails and web push. Someone sent a link got the desktop page on a phone,
 * which is the one presentation the mobile work exists to replace.
 *
 * ── WHY THE ROUTE IS NOT DELETED, REDIRECTED OR HIDDEN ────────────────────
 *
 * That page is the platform's ONLY emitter of `Event` structured data, it
 * carries the canonical URL, and every entry in `sitemap.ts` points at it. It
 * has to keep server-rendering exactly as it does. A viewport-conditional
 * redirect in middleware would be cloaking (middleware has no viewport, only a
 * user agent), and hiding the body below `sm` would remove the content backing
 * the structured data from the render Googlebot Smartphone performs at ~412px.
 *
 * So the deck is an OPAQUE OVERLAY over an unchanged server render. The page
 * is still there, still complete, still exactly what a crawler reads.
 *
 * ── AND WHY THERE IS A COVER ──────────────────────────────────────────────
 *
 * The deck can only open after hydration. Between first paint and that moment
 * — a few hundred milliseconds on a mid-range phone — the desktop page is on
 * screen. That is the flash the brief rules out, so this component renders a
 * cover IN THE SERVER HTML, shaped like the deck's opening frame and carrying
 * the same artwork, and drops it in the same commit that opens the deck.
 *
 * Its geometry is IMPORTED, never copied. A cover with the poster height and
 * the snap written out as literals is correct until the next time either
 * moves, and then it is a visible jump at precisely the instant the swap is
 * supposed to be invisible.
 */
export function DeckBoot({ event, content }: { event: EventDetail; content: EventContent }) {
  const { isOpen, openDeck, closeDeck } = useEventDeck();
  const queryClient = useQueryClient();
  const [covered, setCovered] = React.useState(true);
  const booted = React.useRef(false);

  useIsomorphicLayoutEffect(() => {
    if (booted.current) return;
    booted.current = true;

    // 639.98 rather than 767: this is the exact complement of the deck root's
    // `sm:hidden`. Opening it at a width where it renders `display: none`
    // would lock the body scroll (`useScrollLock`) with nothing painted over
    // it — a blank, frozen page.
    if (!window.matchMedia('(max-width: 639.98px)').matches) {
      setCovered(false);
      return;
    }

    // The server already fetched both of these. Seeding them means the deck
    // paints its real content immediately instead of opening on the card data
    // and filling in a request later.
    //
    // TIERS ARE DELIBERATELY NOT SEEDED. Availability is the one number on this
    // page where stale costs money in both directions, and its query is
    // `staleTime: 0` for exactly that reason — see `use-event-widget-data`.
    queryClient.setQueryData(['event-widget', 'detail', event.id], event);
    queryClient.setQueryData(['event-widget', 'content', event.id], content);

    // `event`, not a seeded shape: `EventDetail` extends `EventCard`, so every
    // field the first frame reads is already real. Passing it through
    // `seedToCard` would blank fields the server has just rendered.
    openDeck([event], 0, { expanded: true, origin: 'route' });
  }, [content, event, openDeck, queryClient]);

  // The cover comes off only once the deck is actually up. Both state updates
  // are made in the same effect, so React commits them together and there is
  // no frame in between.
  React.useEffect(() => {
    if (isOpen) setCovered(false);
  }, [isOpen]);

  /**
   * Rotating to landscape puts the deck root at `display: none` while the body
   * is still scroll-locked — a blank page that does not scroll. Closing is the
   * honest answer: the page underneath is the real event page, and at that
   * width it is the right presentation anyway.
   */
  React.useEffect(() => {
    const query = window.matchMedia('(max-width: 639.98px)');
    const onChange = () => {
      if (!query.matches) closeDeck();
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [closeDeck]);

  if (!covered) return null;

  // The same shell the route's loading state paints, so the two frames either
  // side of hydration are one picture. It carries its own `<noscript>` escape.
  return <DeckShell posterUrl={event.poster_url} title={event.title} />;
}

/**
 * `useLayoutEffect` in the browser, `useEffect` on the server.
 *
 * The deck's position is written before paint, and the open has to happen in
 * the same phase or the first painted frame is the one this component exists
 * to prevent. React warns about `useLayoutEffect` during server rendering,
 * where it does nothing at all — this is the standard way to say "before
 * paint, when there is a paint".
 */
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;
