'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';

/**
 * One search overlay for the whole app — the header trigger, the hero trigger
 * and the ⌘K/Ctrl+K shortcut all drive the same instance.
 *
 * The overlay is CODE-SPLIT out of the initial bundle — but it is mounted
 * (closed, so it renders nothing) as soon as the browser goes IDLE, and any
 * trigger hover/focus pulls that forward. That combination is deliberate:
 * shipping it eagerly costs parse time on every page load, while splitting it
 * without warming makes the FIRST tap pay for a network round-trip — measured
 * at ~3.5s INP on a throttled phone, an order of magnitude over budget. Warming
 * on idle costs nothing on the critical path and makes the first open a plain
 * render.
 */

const SearchOverlay = dynamic(() => import('./search-overlay').then((mod) => mod.SearchOverlay), {
  ssr: false,
});

type SearchContextValue = {
  open: boolean;
  initialQuery: string;
  /**
   * The element the panel should hang beneath, or null for the centred
   * palette.
   *
   * ── WHY BOTH SHAPES EXIST ────────────────────────────────────────────
   *
   * Pressing a search FIELD should open a panel attached to that field: the
   * eye is already there, and a box that jumps to the middle of the screen
   * breaks the connection between the control and its results. That is the
   * Airbnb shape, and it is what the header and hero triggers get.
   *
   * Invoking by KEYBOARD (⌘K, /) has no anchor — the user was not looking
   * anywhere in particular — so it opens centred, which is the Raycast shape
   * and what the reflex expects.
   *
   * One component renders both. Two would be two search experiences to keep
   * in step.
   */
  anchor: HTMLElement | null;
  openSearch: (initialQuery?: string, anchor?: HTMLElement | null) => void;
  closeSearch: () => void;
  /** Warm the overlay chunk before it's needed (pointer/focus on a trigger). */
  preload: () => void;
};

const SearchContext = React.createContext<SearchContextValue | null>(null);

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [initialQuery, setInitialQuery] = React.useState('');
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);

  const preload = React.useCallback(() => setMounted(true), []);

  const openSearch = React.useCallback((query = '', anchorElement: HTMLElement | null = null) => {
    setInitialQuery(query);
    setAnchor(anchorElement);
    setMounted(true);
    setOpen(true);
  }, []);

  const closeSearch = React.useCallback(() => setOpen(false), []);

  // Warm the overlay once the main thread is free.
  React.useEffect(() => {
    const idle = window.requestIdleCallback;
    if (idle) {
      const handle = idle(() => setMounted(true), { timeout: 3000 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(() => setMounted(true), 1500);
    return () => window.clearTimeout(timer);
  }, []);

  React.useEffect(() => {
    // `/` is the discoverable shortcut (it's the one shown in the header);
    // ⌘K/Ctrl+K stays because it's what people reach for reflexively. `/` must
    // never fire while the user is typing into something.
    const isTyping = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        target.getAttribute('role') === 'combobox'
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const isPaletteShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      const isSlash = event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!isPaletteShortcut && !isSlash) return;
      if (isSlash && isTyping(event.target)) return;
      event.preventDefault();
      // No anchor: a keyboard invocation opens the centred palette.
      openSearch();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openSearch]);

  const value = React.useMemo<SearchContextValue>(
    () => ({ open, initialQuery, anchor, openSearch, closeSearch, preload }),
    [open, initialQuery, anchor, openSearch, closeSearch, preload],
  );

  return (
    <SearchContext.Provider value={value}>
      {children}
      {mounted ? (
        <SearchOverlay
          open={open}
          initialQuery={initialQuery}
          anchor={anchor}
          onOpenChange={setOpen}
        />
      ) : null}
    </SearchContext.Provider>
  );
}

export function useSearchOverlay(): SearchContextValue {
  const ctx = React.useContext(SearchContext);
  if (!ctx) throw new Error('useSearchOverlay must be used within a SearchProvider');
  return ctx;
}
