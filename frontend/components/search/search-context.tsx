'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { POPULAR_SEARCHES, type PopularSearch } from '@/lib/search/popular-searches';

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
  /**
   * The operator's suggested searches (`cms.PopularSearch`), read ONCE in the
   * site layout and shared.
   *
   * They used to be fetched by the hero for its own bar, while the panel fell
   * back to a bundled constant — one list rendered in two places that agreed
   * only when both happened to be the default. The bar and the panel are now
   * the same list by construction, which is what makes the panel able to open
   * on whichever term the bar was showing.
   */
  terms: PopularSearch[];
  openSearch: (initialQuery?: string, anchor?: HTMLElement | null) => void;
  closeSearch: () => void;
  /**
   * Handlers a trigger spreads onto itself. Use this, never a bare `onClick`.
   *
   * See `useSearchTrigger` for why the decision has to happen in the CAPTURE
   * phase.
   */
  triggerProps: (anchor: () => HTMLElement | null) => {
    onPointerDownCapture: (event: React.PointerEvent) => void;
    onClick: (event: React.MouseEvent) => void;
  };
  /** Warm the overlay chunk before it's needed (pointer/focus on a trigger). */
  preload: () => void;
};

const SearchContext = React.createContext<SearchContextValue | null>(null);

export function SearchProvider({
  children,
  terms,
}: {
  children: React.ReactNode;
  /** Server-fetched in the site layout. Falls back to the bundled list. */
  terms?: PopularSearch[];
}) {
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [initialQuery, setInitialQuery] = React.useState('');
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);

  const preload = React.useCallback(() => setMounted(true), []);

  // Read by `toggleSearch`, which must see the CURRENT values without taking
  // them as dependencies — see the note there.
  const openRef = React.useRef(open);
  const anchorRef = React.useRef(anchor);
  openRef.current = open;
  anchorRef.current = anchor;

  const openSearch = React.useCallback((query = '', anchorElement: HTMLElement | null = null) => {
    setInitialQuery(query);
    setAnchor(anchorElement);
    setMounted(true);
    setOpen(true);
  }, []);

  const closeSearch = React.useCallback(() => setOpen(false), []);

  /**
   * Set when a trigger press has ALREADY closed the panel, so the `click` that
   * follows the same press must do nothing.
   */
  const handledByPointerDown = React.useRef(false);

  /**
   * ── WHY THE DECISION HAPPENS ON POINTERDOWN, IN THE CAPTURE PHASE ────────
   *
   * Measured ordering for one press on an open panel's own trigger:
   *
   *     pointerdown (capture)  ->  pointerdown (bubble)  ->  click
   *                                 ^ Radix dismisses here
   *                                                          ^ trigger ran here
   *
   * So a trigger that toggles on `click` always reads state Radix has already
   * changed: it sees "closed" and opens again. The panel blinks shut and back,
   * which is precisely the reported bug.
   *
   * An earlier attempt suppressed the dismissal instead, via
   * `onPointerDownOutside` + `preventDefault`. It did not hold — Dialog has
   * more than one path to dismissal and only one of them was guarded — and
   * more importantly it was the wrong SHAPE: it made correctness depend on
   * winning a race inside a library's internals, where a version bump can
   * change the order without changing our code.
   *
   * Capture runs BEFORE any of it, on the way down. Deciding there means the
   * trigger reads the true state, acts once, and marks the press handled. The
   * dismissal that follows closes an already-closed panel, which is a no-op —
   * so the two agree no matter which order they run in. That is the property
   * worth having, not the guard.
   */
  const triggerProps = React.useCallback(
    (anchor: () => HTMLElement | null) => ({
      onPointerDownCapture: () => {
        const element = anchor();
        if (openRef.current && anchorRef.current === element) {
          setOpen(false);
          handledByPointerDown.current = true;
        }
      },
      onClick: () => {
        if (handledByPointerDown.current) {
          handledByPointerDown.current = false;
          return;
        }
        openSearch('', anchor());
      },
    }),
    [openSearch],
  );

  const resolvedTerms = terms?.length ? terms : POPULAR_SEARCHES;

  const value = React.useMemo<SearchContextValue>(
    () => ({
      open,
      initialQuery,
      anchor,
      terms: resolvedTerms,
      openSearch,
      triggerProps,
      closeSearch,
      preload,
    }),
    [
      open,
      initialQuery,
      anchor,
      resolvedTerms,
      openSearch,
      triggerProps,
      closeSearch,
      preload,
    ],
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
