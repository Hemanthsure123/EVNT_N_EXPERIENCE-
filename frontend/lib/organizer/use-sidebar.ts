'use client';

import * as React from 'react';

const STORAGE_KEY = 'ee-organizer-sidebar';

/**
 * Sidebar collapsed state, remembered across sessions.
 *
 * Starts EXPANDED on both server and first client render, then reads storage
 * in an effect. Reading `localStorage` during render would be a hydration
 * mismatch (the server has no storage); reading it in `useState`'s initialiser
 * has the same problem. The one frame of expanded-then-collapsed is invisible
 * because the transition is suppressed until after the first paint — see
 * `ready` below, which the shell uses to skip the width animation on load.
 *
 * An organizer who collapses this has decided they want the viewport for
 * tables. Forgetting that on every navigation is the kind of small betrayal
 * that makes software feel cheap.
 */
export function useSidebar(): {
  collapsed: boolean;
  ready: boolean;
  toggle: () => void;
  setCollapsed: (value: boolean) => void;
} {
  const [collapsed, setCollapsedState] = React.useState(false);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsedState(window.localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      // Private mode or a blocked origin — the default is fine.
    }
    setReady(true);
  }, []);

  const setCollapsed = React.useCallback((value: boolean) => {
    setCollapsedState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
    } catch {
      // Not being able to remember it is not a reason to refuse to do it.
    }
  }, []);

  const toggle = React.useCallback(
    () => setCollapsed(!collapsedRef.current),
    // `collapsedRef` keeps this callback stable so the toggle button never
    // re-renders the whole sidebar tree on each keystroke elsewhere.
    [setCollapsed],
  );

  const collapsedRef = React.useRef(collapsed);
  collapsedRef.current = collapsed;

  return { collapsed, ready, toggle, setCollapsed };
}
