'use client';

import * as React from 'react';
import type { EventCard as EventCardData } from '@/lib/api/types';

/**
 * The least a caller can know and still open an event.
 *
 * ── WHY A PARTIAL SEED IS ENOUGH ──────────────────────────────────────────
 *
 * The deck fetches the event itself (`useEventWidgetData` -> `GET /events/{id}`)
 * the moment it opens. The card handed to `openDeck` is only used for two
 * things: the very first frame, before that request lands, and the peeking
 * neighbours either side. So a caller that genuinely has nothing but an id and
 * a title — the ratings prompt, a ticket in the account area, an organiser's
 * "more from" list — can open the widget without inventing data it does not
 * have.
 *
 * The unknown fields are filled with the SAME values the type already uses for
 * "not known": `''` for an uncategorised event, `null` for an unknown price.
 * They are not placeholders standing in for real values; they are the honest
 * empties, and they are replaced within one request.
 */
export type EventSeed = Pick<EventCardData, 'id' | 'title'> & Partial<EventCardData>;

/**
 * How the deck was opened, which decides how it enters and how it leaves.
 *
 * `feed` — a card was tapped on a page that stays underneath. The deck slides
 * in, the poster flies from that card, and closing reveals the page again.
 *
 * `route` — the reader ARRIVED on /events/{slug}-{uuid} directly (a shared
 * link, a bookmark, a search result). There is no card on the page to fly
 * from and no feed to reveal on close: the deck is the page, so it opens
 * already expanded with no entrance, and closing has to GO somewhere.
 */
export type DeckOrigin = 'feed' | 'route';

export type OpenDeckOptions = {
  /** Land at the expanded snap with no entrance animation. */
  expanded?: boolean;
  origin?: DeckOrigin;
};

interface EventDeckContextType {
  isOpen: boolean;
  events: EventCardData[];
  currentIndex: number;
  /** Set by the most recent `openDeck`; reset on close. */
  openOptions: OpenDeckOptions;
  openDeck: (eventsList: EventCardData[], initialIndex?: number, options?: OpenDeckOptions) => void;
  /**
   * Open one event from whatever the caller happens to know about it.
   *
   * This is what makes the widget the event page EVERYWHERE rather than only
   * on the surfaces that happen to hold a full `EventCard` — which was the
   * whole reason a tap in the account area still landed on the standalone
   * page.
   */
  openEvent: (seed: EventSeed) => void;
  closeDeck: () => void;
  setCurrentIndex: (index: number) => void;
}

/** Fill a partial seed out to the shape the deck's first frame reads. */
export function seedToCard(seed: EventSeed): EventCardData {
  return {
    venue: '',
    city: '',
    category: '',
    starts_at: '',
    poster_url: '',
    from_price: null,
    tickets_available: null,
    organization_id: '',
    organization_name: '',
    ...seed,
  };
}

const EventDeckContext = React.createContext<EventDeckContextType>({
  isOpen: false,
  events: [],
  currentIndex: 0,
  openOptions: {},
  openDeck: () => {},
  openEvent: () => {},
  closeDeck: () => {},
  setCurrentIndex: () => {},
});

export function EventDeckProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [events, setEvents] = React.useState<EventCardData[]>([]);
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [openOptions, setOpenOptions] = React.useState<OpenDeckOptions>({});

  const openDeck = React.useCallback(
    (eventsList: EventCardData[], initialIndex = 0, options: OpenDeckOptions = {}) => {
      if (!eventsList || eventsList.length === 0) return;
      setEvents(eventsList);
      setCurrentIndex(Math.max(0, Math.min(initialIndex, eventsList.length - 1)));
      setOpenOptions(options);
      setIsOpen(true);
    },
    [],
  );

  const openEvent = React.useCallback(
    (seed: EventSeed) => {
      openDeck([seedToCard(seed)], 0);
    },
    [openDeck],
  );

  const closeDeck = React.useCallback(() => {
    setIsOpen(false);
    setOpenOptions({});
  }, []);

  const handleSetCurrentIndex = React.useCallback(
    (index: number) => {
      if (events.length === 0) return;
      const clamped = Math.max(0, Math.min(index, events.length - 1));
      setCurrentIndex(clamped);
    },
    [events.length],
  );

  return (
    <EventDeckContext.Provider
      value={{
        isOpen,
        events,
        currentIndex,
        openOptions,
        openDeck,
        openEvent,
        closeDeck,
        setCurrentIndex: handleSetCurrentIndex,
      }}
    >
      {children}
    </EventDeckContext.Provider>
  );
}

export function useEventDeck() {
  return React.useContext(EventDeckContext);
}
