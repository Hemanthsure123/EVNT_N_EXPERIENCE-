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

interface EventDeckContextType {
  isOpen: boolean;
  events: EventCardData[];
  currentIndex: number;
  openDeck: (eventsList: EventCardData[], initialIndex?: number) => void;
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
  openDeck: () => {},
  openEvent: () => {},
  closeDeck: () => {},
  setCurrentIndex: () => {},
});

export function EventDeckProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [events, setEvents] = React.useState<EventCardData[]>([]);
  const [currentIndex, setCurrentIndex] = React.useState(0);

  const openDeck = React.useCallback((eventsList: EventCardData[], initialIndex = 0) => {
    if (!eventsList || eventsList.length === 0) return;
    setEvents(eventsList);
    setCurrentIndex(Math.max(0, Math.min(initialIndex, eventsList.length - 1)));
    setIsOpen(true);
  }, []);

  const openEvent = React.useCallback(
    (seed: EventSeed) => {
      openDeck([seedToCard(seed)], 0);
    },
    [openDeck],
  );

  const closeDeck = React.useCallback(() => {
    setIsOpen(false);
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
