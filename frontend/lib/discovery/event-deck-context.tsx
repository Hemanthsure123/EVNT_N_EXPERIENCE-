'use client';

import * as React from 'react';
import type { EventCard as EventCardData } from '@/lib/api/types';

interface EventDeckContextType {
  isOpen: boolean;
  events: EventCardData[];
  currentIndex: number;
  openDeck: (eventsList: EventCardData[], initialIndex?: number) => void;
  closeDeck: () => void;
  setCurrentIndex: (index: number) => void;
}

const EventDeckContext = React.createContext<EventDeckContextType>({
  isOpen: false,
  events: [],
  currentIndex: 0,
  openDeck: () => {},
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
