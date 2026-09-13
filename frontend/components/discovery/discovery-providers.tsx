'use client';

import * as React from 'react';
import { SearchProvider } from '@/components/search/search-context';
import { LocationProvider } from '@/lib/location/location-context';
import { EventDeckProvider } from '@/lib/discovery/event-deck-context';
import { EventWidgetDeck } from '@/components/event/event-widget-deck';
import { SHELL_ID } from '@/lib/utils/focus-trap';

/**
 * EVERYTHING A DISCOVERY SURFACE NEEDS MOUNTED AROUND IT.
 *
 * Three providers and the mobile event deck, as one thing — because there are
 * two places that render the landing page now (the public `/` and the
 * organizer's `/dashboard/home`), and a second hand-assembled stack is how one
 * of them ends up missing a provider. That failure is not subtle when it
 * happens and it is invisible until it does: a card that opens the deck throws
 * "must be used within EventDeckProvider" on press, not on render.
 *
 * ── WHY IT OWNS `#site-shell` ────────────────────────────────────────────
 *
 * `useBackgroundInert` hides that subtree from assistive technology while the
 * search palette or the filter panel is open. It resolves the element by id and
 * OPTIONAL-CHAINS the result, so a page without the wrapper does not crash —
 * it silently loses the inerting, which is exactly the class of bug that ships.
 * The wrapper therefore comes with the providers rather than with the layout
 * that happened to have it first.
 *
 * `SkipToContent` is deliberately NOT inside it: the skip link has to stay
 * reachable while an overlay hides everything else.
 *
 * ── AND THE DECK IS INSIDE IT, NOT BESIDE IT ─────────────────────────────
 *
 * Where the site layout has always had it. Opening the search palette over an
 * open event deck should hide the deck from a screen reader too — it is part
 * of the page behind the overlay, not a peer of it.
 */
export function DiscoveryProviders({
  terms,
  children,
}: {
  /** Operator-curated popular searches, for the search overlay's empty state.
   *  Empty is a perfectly good value — the panel falls back to a bundled list
   *  on pages that never fetched the homepage payload. */
  terms: { label: string; href: string }[];
  children: React.ReactNode;
}) {
  return (
    <LocationProvider>
      <SearchProvider terms={terms}>
        <EventDeckProvider>
          <div id={SHELL_ID}>
            {children}
            <EventWidgetDeck />
          </div>
        </EventDeckProvider>
      </SearchProvider>
    </LocationProvider>
  );
}
