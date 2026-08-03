'use client';

import * as React from 'react';
import { type LocationState, useLocation } from './use-location';

/** One shared location state: the header's city switcher, the soft-ask card and
 * the "Trending near you" row all read and write the same value. */
const LocationContext = React.createContext<LocationState | null>(null);

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const value = useLocation();
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocationContext(): LocationState {
  const ctx = React.useContext(LocationContext);
  if (!ctx) throw new Error('useLocationContext must be used within a LocationProvider');
  return ctx;
}
