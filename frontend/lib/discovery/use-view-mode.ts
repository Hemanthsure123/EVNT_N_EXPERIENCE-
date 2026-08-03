'use client';

import * as React from 'react';

/**
 * Grid or list, remembered per device.
 *
 * It reads from storage in an EFFECT rather than during the first render, on
 * purpose: this component is server-rendered, and a first render that depended
 * on `localStorage` would produce markup the server couldn't have produced. The
 * server's choice (grid) paints, then a stored preference applies. Nothing
 * shifts, because both layouts render into the same reserved region.
 */

export type ViewMode = 'grid' | 'list';

const STORAGE_KEY = 'ee-results-view';
const isViewMode = (value: string | null): value is ViewMode =>
  value === 'grid' || value === 'list';

export function useViewMode(initial: ViewMode = 'grid') {
  const [view, setView] = React.useState<ViewMode>(initial);

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isViewMode(stored)) setView(stored);
    } catch {
      /* storage blocked — the default is a perfectly good answer */
    }
  }, []);

  const choose = React.useCallback((next: ViewMode) => {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage blocked — the choice still applies for this session */
    }
  }, []);

  return [view, choose] as const;
}
