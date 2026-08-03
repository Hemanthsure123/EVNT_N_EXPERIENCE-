'use client';

import * as React from 'react';
import { type City, cityByName } from '@/lib/discovery/cities';
import { type FixFailure, resolveCityFromFix } from './resolve-city';

/**
 * The viewer's chosen city — what powers "Trending near you".
 *
 * Four deliberate decisions:
 *
 * 1. **A permission prompt is never fired on load.** `getCurrentPosition` is
 *    called when the user presses a button — or, at most once per device, when
 *    the browser tells us the grant ALREADY exists (see `autoDetect` below).
 *    A prompt fired at page load is the fastest way to get permanently denied.
 * 2. **The city comes from a geocoder when one will answer us**, and from the
 *    bundled nearest-match otherwise — and the two are kept distinguishable all
 *    the way to the UI via `precision`. See lib/location/resolve-city.ts.
 * 3. **Coordinates are dropped immediately.** Only the city NAME is stored, and
 *    only on this device.
 * 4. **Stored client-side, not in a cookie.** A cookie would be readable during
 *    the server render, which would opt the home page out of static rendering
 *    and kill its edge cacheability. Instead the ISR'd page ships a global
 *    "Trending" row and the client swaps in the city-filtered one — see
 *    components/discovery/trending-near-you.tsx.
 */

const STORAGE_KEY = 'ee-city';
const DISMISS_KEY = 'ee-location-dismissed';
/** Set once we have attempted the silent first-visit detect — never repeated. */
const AUTO_KEY = 'ee-location-auto';

export type LocationStatus =
  | 'idle'
  | 'locating'
  | 'granted'
  | 'denied'
  | 'unsupported'
  /** A fix arrived but no city could be matched to it. */
  | 'unserved'
  /** The device could not produce a fix at all (timeout, no signal). */
  | 'unavailable';

/**
 * How much the current city is worth trusting.
 *
 * `approximate` means "the nearest city we know to where you are", not "where
 * you are". Every surface that shows a detected city has to say which it got,
 * because the failure mode this replaced — a confident wrong city — is
 * indistinguishable from success without it.
 */
export type LocationPrecision = 'exact' | 'approximate' | null;

export type LocationState = {
  city: City | null;
  status: LocationStatus;
  precision: LocationPrecision;
  /** Why we fell back to a nearest-match, when we did. */
  fallbackReason: FixFailure | null;
  /** True once the stored value has been read — avoids a hydration mismatch. */
  ready: boolean;
  dismissed: boolean;
  detect: () => void;
  setCity: (city: City | null) => void;
  dismiss: () => void;
};

function readStored(): City | null {
  if (typeof window === 'undefined') return null;
  try {
    return cityByName(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string) {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    /* storage blocked — the flag is an optimisation, not correctness */
  }
}

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 8000,
  maximumAge: 10 * 60 * 1000,
};

export function useLocation(): LocationState {
  const [city, setCityState] = React.useState<City | null>(null);
  const [status, setStatus] = React.useState<LocationStatus>('idle');
  const [precision, setPrecision] = React.useState<LocationPrecision>(null);
  const [fallbackReason, setFallbackReason] = React.useState<FixFailure | null>(null);
  const [ready, setReady] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  /** Guards against a second detect landing after the component unmounted. */
  const liveRef = React.useRef(true);

  React.useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  const setCity = React.useCallback((next: City | null) => {
    setCityState(next);
    setStatus(next ? 'granted' : 'idle');
    // A city the user PICKED is exact by definition — they know where they are.
    setPrecision(next ? 'exact' : null);
    setFallbackReason(null);
    try {
      if (next) window.localStorage.setItem(STORAGE_KEY, next.name);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore — the choice still applies for this session */
    }
  }, []);

  const dismiss = React.useCallback(() => {
    setDismissed(true);
    writeFlag(DISMISS_KEY);
  }, []);

  /**
   * Ask the device, then ask what that fix is called.
   *
   * `silent` is the automatic first-visit path: it applies only an EXACT
   * answer and leaves no message behind. An approximate guess is fine when
   * somebody pressed a button and can read the sentence explaining it; applied
   * silently it is just a wrong city appearing in the header, which is the bug
   * this whole module exists to remove.
   */
  const run = React.useCallback((silent: boolean) => {
    if (typeof window === 'undefined' || !('geolocation' in window.navigator)) {
      if (!silent) setStatus('unsupported');
      return;
    }
    if (!silent) setStatus('locating');

    window.navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        void resolveCityFromFix(latitude, longitude).then((fix) => {
          if (!liveRef.current) return;
          if (fix.kind === 'unknown') {
            if (!silent) setStatus('unserved');
            return;
          }
          if (fix.kind === 'approximate' && silent) return;

          setCityState(fix.city);
          setStatus('granted');
          setPrecision(fix.kind === 'exact' ? 'exact' : 'approximate');
          setFallbackReason(fix.kind === 'approximate' ? fix.because : null);
          try {
            window.localStorage.setItem(STORAGE_KEY, fix.city.name);
          } catch {
            /* ignore — the choice still applies for this session */
          }
        });
      },
      (error) => {
        if (silent || !liveRef.current) return;
        // PERMISSION_DENIED is a decision; the other two are a device that
        // could not answer, and telling them apart is the difference between
        // "you turned this off" and "try again".
        setStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      GEO_OPTIONS,
    );
  }, []);

  const detect = React.useCallback(() => run(false), [run]);

  React.useEffect(() => {
    const stored = readStored();
    if (stored) {
      setCityState(stored);
      setStatus('granted');
      setPrecision('exact');
    }
    setDismissed(readFlag(DISMISS_KEY));
    setReady(true);

    if (stored || readFlag(DISMISS_KEY) || readFlag(AUTO_KEY)) return;

    /**
     * FIRST VISIT ONLY, AND ONLY IF THE GRANT ALREADY EXISTS.
     *
     * The brief asked for auto-detection on a first visit. Firing
     * `getCurrentPosition` blind would put a permission prompt on the front
     * page's first paint, which this module has always refused (see decision 1
     * above) — so we ask the Permissions API first and proceed only when the
     * browser says the answer is already `granted`, i.e. no prompt can appear.
     * Where the API is missing, or the state is `prompt`, the soft-ask card and
     * the city sheet remain the way in. Attempted at most once per device.
     */
    const permissions = window.navigator.permissions;
    if (!permissions?.query) return;
    void permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((result) => {
        if (result.state !== 'granted' || !liveRef.current) return;
        writeFlag(AUTO_KEY);
        run(true);
      })
      .catch(() => {
        /* Firefox has thrown on unknown descriptors — never a reason to fail. */
      });
  }, [run]);

  return { city, status, precision, fallbackReason, ready, dismissed, detect, setCity, dismiss };
}
