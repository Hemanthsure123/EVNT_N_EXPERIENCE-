'use client';

import * as React from 'react';

/**
 * Cookie/storage consent.
 *
 * The discovery layer itself only uses first-party localStorage for things the
 * user asked for (theme, chosen city, recent searches), so the banner is an
 * explicit, honest choice rather than a dark pattern: "Accept" and "Essential
 * only" are equally prominent, and declining is remembered the same way as
 * accepting. Analytics/marketing storage — which is what the choice actually
 * gates — arrives with the analytics module; `preference` is the flag it reads.
 */

const STORAGE_KEY = 'ee-cookie-consent';

export type ConsentPreference = 'all' | 'essential';

export type CookieConsentState = {
  preference: ConsentPreference | null;
  /** Read from storage yet? Gates rendering so the banner never flashes. */
  ready: boolean;
  accept: (preference: ConsentPreference) => void;
};

export function useCookieConsent(): CookieConsentState {
  const [preference, setPreference] = React.useState<ConsentPreference | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'all' || stored === 'essential') setPreference(stored);
    } catch {
      /* storage blocked — show the banner, it just won't persist */
    }
    setReady(true);
  }, []);

  const accept = React.useCallback((next: ConsentPreference) => {
    setPreference(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  return { preference, ready, accept };
}
