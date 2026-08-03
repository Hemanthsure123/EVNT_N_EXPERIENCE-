'use client';

import * as React from 'react';

/**
 * Loads the Maps JavaScript API, once per page.
 *
 * ── WHY A HAND-ROLLED LOADER ──────────────────────────────────────────────
 *
 * Google's own `@googlemaps/js-api-loader` is 12KB to append one script tag
 * and remember whether it already did. This app ships one third-party script
 * (Razorpay Checkout) and adds a dependency only when it earns its size.
 *
 * ── THE THING THAT MAKES THIS NON-TRIVIAL ─────────────────────────────────
 *
 * `google.maps` is a global. Two components mounting at once must not append
 * two script tags — Google logs "You have included the Google Maps JavaScript
 * API multiple times" and behaviour after that is undefined. So the promise
 * is module-scoped and shared: the second caller awaits the first caller's
 * load rather than starting its own.
 *
 * ── IT NEVER LOADS WITHOUT A KEY ──────────────────────────────────────────
 *
 * With `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` unset the state is `unavailable` and
 * nothing is appended. Loading Google's script without a key renders a grey
 * box with a "this page didn't load Google Maps correctly" watermark over it,
 * which looks like a broken site rather than a site without a map.
 */

export type MapsLoadState = 'unavailable' | 'loading' | 'ready' | 'error';

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
const SCRIPT_ID = 'google-maps-js';

/** Shared across every caller — see the note above about the global. */
let loadPromise: Promise<void> | null = null;

function loadScript(libraries: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('server'));
  if (loadPromise) return loadPromise;

  // Another bundle may already have loaded it (a hot reload, or a second
  // entry point). Adopt it rather than racing it.
  if ((window as { google?: { maps?: unknown } }).google?.maps) {
    loadPromise = Promise.resolve();
    return loadPromise;
  }

  loadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Google Maps failed to load')));
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    // `loading=async` is Google's own recommendation and silences their
    // console warning; `v=weekly` pins a channel rather than a version, which
    // is what they support for production.
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(API_KEY)}` +
      `&libraries=${encodeURIComponent(libraries)}&loading=async&v=weekly`;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () =>
      reject(new Error('Google Maps failed to load')),
    );
    document.head.appendChild(script);
  }).catch((error) => {
    // Reset so a later mount can retry. A permanently rejected shared promise
    // would mean one transient network blip disables maps until a reload.
    loadPromise = null;
    throw error;
  });

  return loadPromise;
}

export function useGoogleMaps(libraries = 'places'): MapsLoadState {
  const [state, setState] = React.useState<MapsLoadState>(
    API_KEY ? 'loading' : 'unavailable',
  );

  React.useEffect(() => {
    if (!API_KEY) return;
    let cancelled = false;

    loadScript(libraries)
      .then(() => {
        if (!cancelled) setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [libraries]);

  return state;
}

/** Whether a browser key exists at all. Safe on the server. */
export const mapsKeyConfigured = (): boolean => Boolean(API_KEY);
