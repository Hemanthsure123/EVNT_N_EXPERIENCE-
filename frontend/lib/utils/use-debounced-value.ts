'use client';

import * as React from 'react';

/**
 * Debounce a fast-changing value (search-as-you-type). Keystrokes stay
 * instant in the input; only the derived value — and therefore the network
 * request — settles.
 */
export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    if (value === debounced) return;
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
    // `debounced` intentionally excluded: including it would restart the timer
    // on every settle and never converge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, delayMs]);

  return debounced;
}
