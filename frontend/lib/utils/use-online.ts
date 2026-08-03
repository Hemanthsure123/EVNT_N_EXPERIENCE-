'use client';

import * as React from 'react';

/**
 * Connectivity, for the offline state. Starts optimistic (`true`) so the server
 * render and the first client render agree — `navigator.onLine` doesn't exist
 * during SSR, and assuming "offline" would flash an offline banner at everyone.
 */
export function useOnline(): boolean {
  const [online, setOnline] = React.useState(true);

  React.useEffect(() => {
    const sync = () => setOnline(window.navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  return online;
}
