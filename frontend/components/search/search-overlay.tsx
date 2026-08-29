'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Building2, Clock, CornerDownLeft, Loader2, MapPin, Search, Ticket, X } from 'lucide-react';
import { Modal, ModalContent, ModalTitle } from '@/components/ui/modal';
import { CATEGORIES } from '@/lib/discovery/categories';
import { browseHref } from '@/lib/discovery/filters';
import { useSearchOverlay } from './search-context';
import {
  type RecentSearch,
  clearRecentSearches,
  pushRecentSearch,
  readRecentSearches,
} from '@/lib/search/recent-searches';
import { derivedSuggestions } from '@/lib/search/suggestions';
import type { Suggestion, SuggestionType } from '@/lib/search/types';
import { useDebouncedValue } from '@/lib/utils/use-debounced-value';
import { trapTab, useBackgroundInert } from '@/lib/utils/focus-trap';
import { ClayIcon } from '@/components/illustrations/clay';
import { cn } from '@/lib/utils/cn';
import { placeAnchoredPanel } from './anchored-position';
import { RollingHint, useRollingTerm } from './rolling-placeholder';
import { SceneNoResults } from '@/components/illustrations/scenes';

/**
 * Deep search — a command-palette overlay.
 *
 * Type-ahead is DEBOUNCED (250ms) and in-flight requests are aborted via
 * TanStack Query's signal, so a fast typist issues one request rather than one
 * per keystroke; while the next query is in flight the previous groups stay on
 * screen instead of blanking.
 *
 * Accessibility is the WAI-ARIA combobox pattern, not a div soup: the input
 * owns `role="combobox"` + `aria-activedescendant`, the results are a
 * `listbox` of `option`s grouped by type, and Up/Down/Home/End/Enter/Escape
 * all work. Anything that ISN'T an option (the category shortcuts, the empty
 * state's CTA) lives outside the listbox, where a button is legal.
 *
 * WHY `modal={false}`: Radix's modal mode sets `pointer-events: none` on
 * <body> and injects a scroll-lock stylesheet. Both are global, so opening the
 * palette invalidated style + layout for the entire document — profiled at
 * ~1.7s for a single interaction on a 4x-throttled CPU, by far the worst number
 * in the app, on its most-used control. Non-modal costs ~0.2s.
 *
 * What that gives up, and how it's put back, is one shared argument in
 * lib/utils/focus-trap.ts — `trapTab` for the Tab cycle and `useBackgroundInert`
 * for the a11y tree, both used here and by the filter panel on /events.
 *
 * ── THE SURFACE, IN THE LIGHT-FIRST LANGUAGE ──────────────────────────────
 *
 * `ModalContent` gives it `bg-elevated` + `border-border` + `shadow-xl`, and in
 * light all three of background/surface/elevated are pure white — so the
 * hairline and the shadow, not a value step, are what lift this panel off the
 * page. That is deliberate and is the same recipe every card uses; see the
 * elevation note in styles/tokens.css.
 *
 * Three things inside it changed with the language: the leading magnifier is
 * the wayfinding violet, the empty state's one action is the black pill, and
 * the keyboard-hint strip is a SOLID `bg-sunken` rather than `bg-muted/40` —
 * an alpha tint under 12px text has no contrast ratio you can compute, and this
 * surface is inside an axe-scanned page.
 *
 * ── THE POPULAR-SEARCHES GROUP IS GONE FROM THE LIST ──────────────────────
 *
 * It is the rolling hint in the FIELD now (components/search/rolling-
 * placeholder.tsx), and it was previously drawn twice on the home page — once
 * as a chip strip under the hero and once as a group in here. The operator's
 * curation still drives it: the same `popular_searches` rows feed the roll, and
 * Enter on an empty box runs whichever one is showing. What went is the second
 * rendering of the same six links, not the links.
 */

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

const TYPE_ICON: Record<SuggestionType, typeof Ticket> = {
  event: Ticket,
  artist: Search,
  venue: MapPin,
  organizer: Building2,
  city: MapPin,
};

/**
 * Where the panel sits, recomputed from the anchor's viewport rect.
 *
 * ── WHY NOT A POPOVER LIBRARY ────────────────────────────────────────────
 *
 * Radix Popover would bring collision detection and a portal we already have.
 * What it would NOT do is share the dialog's focus trap, its Escape handling
 * and its `aria-modal` semantics with the centred palette — so the two shapes
 * would diverge into two components with two sets of keyboard bugs. Anchoring
 * a dialog is ~20 lines; keeping two search surfaces honest is forever.
 */
function useAnchoredPosition(anchor: HTMLElement | null, open: boolean) {
  const [style, setStyle] = React.useState<React.CSSProperties | null>(null);

  React.useLayoutEffect(() => {
    if (!open || !anchor) {
      setStyle(null);
      return;
    }

    const place = () => {
      const { top, left, width, maxHeight } = placeAnchoredPanel(anchor.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      // `transform: none` cancels the centring translate the modal applies by
      // default — without it the panel is positioned correctly and then moved
      // half its own size away from the trigger.
      setStyle({ position: 'fixed', top, left, width, maxHeight, transform: 'none' });
    };

    place();
    // `true` captures scrolls in ANY container, not just the window — a
    // trigger can sit inside a scrollable region.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor, open]);

  return style;
}

export type SearchOverlayProps = {
  open: boolean;
  /** Element to hang beneath; null opens the centred palette. */
  anchor?: HTMLElement | null;
  initialQuery: string;
  onOpenChange: (open: boolean) => void;
};

export function SearchOverlay({ open, initialQuery, anchor, onOpenChange }: SearchOverlayProps) {
  const { terms } = useSearchOverlay();
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  // Whatever had focus before we opened, so we can hand it back on close
  // ourselves — see the `preventScroll` note on onOpenAutoFocus.
  const returnFocusRef = React.useRef<HTMLElement | null>(null);
  /** True once the user has arrowed to a choice for the current query. */
  const userMovedRef = React.useRef(false);
  const anchored = useAnchoredPosition(anchor ?? null, open);
  const [query, setQuery] = React.useState(initialQuery);
  // -1 = nothing highlighted. Only suggestions that MATCH THE CURRENT QUERY may
  // auto-highlight; see the note on `Enter` below.
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [recents, setRecents] = React.useState<RecentSearch[]>([]);
  const [focused, setFocused] = React.useState(false);

  /*
   * The operator's suggested searches, from CONTEXT — server-rendered in the
   * site layout and shared with the header bar.
   *
   * This replaces a client `useQuery` for `GET /homepage` fired every time the
   * panel opened. Two things were wrong with it and only one was the request:
   * the header bar and this panel were reading the same list through two
   * different paths, so on a cold open the bar showed the operator's terms
   * while the panel showed the bundled defaults until the fetch landed. One
   * source means they cannot disagree, and it costs no round trip at all.
   */
  const popular = terms;

  /**
   * The suggestion the field is offering, and what Enter on an empty box runs.
   *
   * The roll is FROZEN while the field has focus or any text — which, since the
   * palette focuses its input on open, means it opens showing whatever the hero
   * bar was showing when it was pressed (the clock is shared) and then holds
   * still. Nobody should watch words move while they type.
   */
  const rolling = useRollingTerm(popular, !focused && !query);
  const suggestion = rolling.item;
  const hintTerms = React.useMemo(() => popular.map((entry) => entry.label), [popular]);
  /**
   * The input's own `placeholder`. It is the STABLE sentence — the moving
   * suggestions are painted over it and never touch this attribute, because a
   * field with no visible label is named by its placeholder and an accessible
   * name that changes every three seconds cannot be read out or acted on.
   *
   * It was `hero.search_placeholder` from the CMS. That field went with the
   * hero it belonged to; a one-line placeholder was never worth an editor, and
   * the suggestions rolling over it are the part an operator actually curates.
   */
  const placeholder = 'Search events, artists, venues, cities…';
  /** No hint once anything is typed — the field is the user's now. */
  const showHint = !query && hintTerms.length > 0;

  const debouncedQuery = useDebouncedValue(query.trim(), DEBOUNCE_MS);
  const isSearching = debouncedQuery.length >= MIN_QUERY_LENGTH;

  React.useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;
    setQuery(initialQuery);
    setActiveIndex(-1);
    setRecents(readRecentSearches());
  }, [open, initialQuery]);

  // Hide the page behind the palette from assistive tech. Focus lives in the
  // portaled dialog (a sibling of the shell), so nothing focused is hidden.
  useBackgroundInert(open);

  const suggestions = useQuery({
    queryKey: ['search-suggestions', debouncedQuery],
    queryFn: ({ signal }) => derivedSuggestions(debouncedQuery, { signal }),
    enabled: open && isSearching,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });

  const suggestionData = suggestions.data;
  const groups = React.useMemo(
    () => (isSearching ? (suggestionData ?? []) : []),
    [isSearching, suggestionData],
  );

  /**
   * The idle listbox is the user's OWN history now — the curated suggestions
   * live in the field, not in the list. Nothing else may go in here: everything
   * in the listbox is reachable with the arrow keys, and padding it with links
   * pushes the recents somebody actually wants further from the caret.
   */
  const idleOptions = React.useMemo<Suggestion[]>(
    () =>
      recents.map((entry) => ({
        id: `recent:${entry.query}`,
        type: 'event' as const,
        label: entry.query,
        href: browseHref({ q: entry.query }),
      })),
    [recents],
  );

  /** Every keyboard-navigable option, flattened in visual order. */
  const options = React.useMemo<Suggestion[]>(
    () => (isSearching ? groups.flatMap((group) => group.items) : idleOptions),
    [isSearching, groups, idleOptions],
  );

  /**
   * Highlight management. Two rules, both of them about not moving the target
   * under the user's finger:
   *
   * 1. Auto-highlight the first suggestion ONLY once results for the CURRENT
   *    query have arrived. Otherwise a fast typist gets burned: type "comedy",
   *    hit Enter before the 250ms debounce lands, and the highlighted row is
   *    still the first *popular* search from the idle list — Enter would then
   *    navigate somewhere they never asked for. With nothing highlighted, Enter
   *    falls through to a plain free-text search, which is always safe.
   * 2. Once the user has arrowed to a choice, it STICKS until the query itself
   *    changes. A background refetch re-running the auto-highlight would silently
   *    move the selection between their arrow key and their Enter.
   */
  const settled = isSearching && !suggestions.isFetching;

  React.useEffect(() => {
    userMovedRef.current = false;
    setActiveIndex(-1);
  }, [debouncedQuery, isSearching]);

  React.useEffect(() => {
    if (!settled || !groups.length || userMovedRef.current) return;
    setActiveIndex(0);
  }, [settled, groups]);

  const activeOption = activeIndex >= 0 ? options[activeIndex] : undefined;

  const go = React.useCallback(
    (href: string, record?: string) => {
      if (record) setRecents(pushRecentSearch(record));
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router],
  );

  /**
   * Enter with nothing typed runs the suggestion the field is showing.
   *
   * This is what stops the rolling hint being decoration: the phrase in the box
   * is the phrase Enter searches. It is deliberately NOT recorded as a recent
   * search — a curated entry can point at a category or a filtered browse URL
   * rather than a free-text query, and replaying it as text would search for
   * something the user never typed.
   */
  const submitFreeText = React.useCallback(() => {
    const trimmed = query.trim();
    if (trimmed) {
      go(browseHref({ q: trimmed }), trimmed);
      return;
    }
    if (suggestion) go(suggestion.href);
  }, [go, query, suggestion]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (activeOption) go(activeOption.href, isSearching ? query.trim() : undefined);
      else submitFreeText();
      return;
    }
    if (!options.length) return;
    // Anything below is an explicit choice — stop auto-highlighting over it.
    userMovedRef.current = true;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % options.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        // From "nothing highlighted", Up wraps to the LAST option.
        setActiveIndex((i) =>
          i < 0 ? options.length - 1 : (i - 1 + options.length) % options.length,
        );
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      default:
        break;
    }
  };

  // Keep the highlighted option in view while arrowing through a long list.
  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: 'nearest',
    });
  }, [activeIndex]);

  let flatIndex = -1;
  const nextIndex = () => {
    flatIndex += 1;
    return flatIndex;
  };

  const showEmpty = isSearching && !groups.length && !suggestions.isFetching;

  return (
    <Modal open={open} onOpenChange={onOpenChange} modal={false}>
      {/* Radix only renders its own overlay in modal mode, so the scrim is ours.
          Dim without a backdrop-filter: blurring a full viewport is a real paint
          cost on the low-end devices this interaction was tuned for. */}
      {/* The scrim belongs to the PALETTE only. Anchored, the panel is a
          dropdown attached to a field — dimming the page behind it would make
          it read as a modal and hide the very context the user is searching
          within. Clicking outside still closes it either way (Radix). */}
      {open && !anchored ? (
        <div className="fixed inset-0 z-modal bg-overlay/70 backdrop-blur-sm animate-in fade-in-0" aria-hidden />
      ) : null}
      {/* NO `onPointerDownOutside` GUARD, deliberately.
          One lived here, suppressing the dismissal when a press landed on the
          panel's own trigger. It did not reliably win — Dialog has more than
          one route to dismissal — and it is no longer needed: the trigger
          decides in the CAPTURE phase, before any of this runs, so the
          dismissal that follows closes an already-closed panel. One mechanism
          rather than two racing ones. See `triggerProps` in
          search-context.tsx. */}
      <ModalContent
        ref={contentRef}
        hideClose
        style={anchored ?? undefined}
        className={cn(
          'gap-0 overflow-hidden p-0',
          // Anchored, the inline style owns position and size, so the centring
          // transform and the max-width must both be off — otherwise the panel
          // is placed correctly and then translated away from the trigger.
          anchored
            ? cn(
                'max-w-none translate-x-0 translate-y-0',
                // ── THE ANCHORED PANEL DROPS FROM ITS TRIGGER ──────────────
                //
                // `ModalContent`'s default is `zoom-in-95` / `zoom-out-95`:
                // a scale about the element's own CENTRE. That is right for a
                // dialog, which has no origin on the page, and wrong for a
                // dropdown, which has one — the panel appeared to inflate out
                // of its own middle and, on close, to collapse into itself
                // somewhere below the field that opened it. It read as a
                // glitch rather than as a dismissal.
                //
                // Overridden here rather than in `ModalContent` because the
                // CENTRED palette still wants the dialog behaviour: this is a
                // difference between two shapes of the same overlay, not a
                // mistake in the primitive.
                //
                // `origin-top` + a short slide is what every dropdown does,
                // and the reason it is the convention: the panel grows out of
                // the edge it is attached to and retracts into it. Closing is
                // FASTER than opening (`duration-fast` vs `duration-base`) —
                // an exit that takes as long as an entrance feels like the UI
                // is arguing about whether to go.
                // ── THE DROPDOWN CURVE ─────────────────────────────────────
                //
                // Grows from the edge it is attached to and retracts into it.
                // Three things make it read as one object rather than a box
                // that appeared:
                //
                //   origin-top      the scale pivots at the field, not the
                //                   panel's own middle
                //   zoom-in-[0.98]  a 2% scale, not 5% — at this size a larger
                //                   one reads as a bounce, which is a modal's
                //                   gesture, not a menu's
                //   slide-*-1       4px of travel. Enough to feel attached,
                //                   little enough that it never looks like the
                //                   panel is being thrown
                //
                // Out is FASTER than in (`duration-fast` vs `duration-base`):
                // an exit that takes as long as an entrance reads as the UI
                // hesitating about whether to go.
                'origin-top zoom-in-[0.98] duration-base ease-out slide-in-from-top-1',
                'data-[state=closed]:zoom-out-[0.98] data-[state=closed]:duration-fast',
                'data-[state=closed]:ease-in data-[state=closed]:slide-out-to-top-1',
              )
            : // TRUE vertical centring, at every breakpoint.
              //
              // This was `sm:top-1/3`, which put the panel's midpoint a third
              // of the way down — so on a desktop the palette opened hard
              // against the top of the viewport, reading as if it belonged to
              // the browser chrome rather than to the page. A summoned overlay
              // with no on-screen origin has only one honest resting place,
              // and it is the middle.
              //
              // `max-h` keeps a long result list from growing past the
              // viewport once it is centred: at 1/3 the overflow fell off the
              // bottom, where centring would push it off BOTH ends.
              'top-1/2 max-h-[min(38rem,calc(100dvh-4rem))] max-w-2xl',
        )}
        aria-describedby={undefined}
        onKeyDown={(event) => trapTab(event, contentRef.current)}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          // `preventScroll` so focusing can't also trigger a scroll-into-view
          // calculation. (It is NOT sufficient on its own — see the module note
          // on `modal={false}` for the change that actually moved the number.)
          inputRef.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          // Closing is an interaction too — restore focus ourselves, cheaply.
          event.preventDefault();
          returnFocusRef.current?.focus({ preventScroll: true });
        }}
      >
        <VisuallyHidden.Root>
          <ModalTitle>Search events, artists, venues, organizers and cities</ModalTitle>
        </VisuallyHidden.Root>

        <div className="flex items-center gap-3 border-b border-border px-4">
          {/* Violet: the wayfinding accent, spent on the one glyph that says
              what this surface is. */}
          <Search className="size-5 shrink-0 text-primary" aria-hidden />
          {/* The field and its hint share one box: the hint is painted OVER the
              input's own placeholder, which stays on the element (stable,
              meaningful, and part of what assistive tech has to work with)
              rather than being swapped out every few seconds. It is hidden
              visually — `placeholder:text-transparent` — only while the hint
              has something to show. */}
          <div className="relative flex h-14 min-w-0 flex-1 items-center">
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded
              aria-controls="search-results"
              aria-activedescendant={activeOption ? `search-option-${activeOption.id}` : undefined}
              aria-autocomplete="list"
              aria-label="Search events, artists, venues, organizers and cities"
              placeholder={placeholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              autoComplete="off"
              className={cn(
                'h-14 w-full bg-transparent text-body-lg text-foreground outline-none',
                showHint ? 'placeholder:text-transparent' : 'placeholder:text-muted-foreground',
              )}
            />
            {showHint ? (
              // `inset-0`, so the hint is bounded by the field and truncates
              // inside it rather than running under the spinner and the clear
              // button. `h-7 leading-7` matches `text-body-lg`'s 28px line box —
              // the clip has to be the line box, or a descender is sheared off.
              <span className="pointer-events-none absolute inset-0 flex items-center text-body-lg text-muted-foreground">
                <span className="shrink-0">Try&nbsp;</span>
                <RollingHint
                  terms={hintTerms}
                  index={rolling.index}
                  className="h-7 min-w-0 flex-1 leading-7"
                />
              </span>
            ) : null}
          </div>
          {suggestions.isFetching ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          ) : null}
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus({ preventScroll: true });
              }}
              aria-label="Clear search"
              className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>

        {/*
          A FIXED height, and NO scrolling.
          Fixed, because suggestions arriving asynchronously would otherwise
          push the footer down and register as layout shift. Not scrollable,
          because a scrollbar inside a search palette is both visual noise and a
          worse affordance than simply showing everything: the group sizes are
          capped (5 events, 2 per facet) and laid out in two columns from `sm`,
          so the full result set always fits the frame.
        */}
        <div
          className={cn(
            'overflow-hidden p-2',
            // The FIXED height is a defence against async layout shift, so it
            // applies while results are arriving and not before: with the
            // popular-searches group moved into the field, the idle panel is
            // entirely synchronous (recents from storage, categories bundled)
            // and holding it at 27rem would reserve a third of a phone's
            // viewport for whitespace.
            isSearching ? 'h-80 sm:h-[27rem]' : 'min-h-[13rem]',
          )}
          ref={listRef}
        >
          <div
            id="search-results"
            role="listbox"
            aria-label="Search suggestions"
            className={cn(isSearching && 'sm:grid sm:grid-cols-[1.15fr_1fr] sm:gap-x-4')}
          >
            {isSearching
              ? groups.map((group, groupIndex) => (
                  <OptionGroup
                    key={group.type}
                    label={group.label}
                    // Events lead the left column; the facets stack on the right.
                    className={groupIndex === 0 ? 'sm:row-span-3' : undefined}
                  >
                    {group.items.map((item) => {
                      const index = nextIndex();
                      return (
                        <Option
                          key={item.id}
                          item={item}
                          active={index === activeIndex}
                          onHover={() => setActiveIndex(index)}
                          onSelect={() => go(item.href, query.trim())}
                        />
                      );
                    })}
                  </OptionGroup>
                ))
              : null}

            {!isSearching && recents.length ? (
              <OptionGroup
                label="Recent"
                action={
                  <button
                    type="button"
                    onClick={() => setRecents(clearRecentSearches())}
                    className="rounded-sm text-caption text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Clear
                  </button>
                }
              >
                {recents.map((entry) => {
                  const index = nextIndex();
                  const item = idleOptions[index];
                  return (
                    <Option
                      key={entry.query}
                      item={item}
                      icon={Clock}
                      active={index === activeIndex}
                      onHover={() => setActiveIndex(index)}
                      onSelect={() => go(item.href)}
                    />
                  );
                })}
              </OptionGroup>
            ) : null}
          </div>

          {/* Not options — so deliberately OUTSIDE the listbox. */}
          {!isSearching ? (
            <div className="px-3 pb-2 pt-3">
              <p className="pb-2 text-label uppercase tracking-wide text-foreground-subtle">
                Browse by category
              </p>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((category) => (
                  <button
                    key={category.slug}
                    type="button"
                    onClick={() => go(browseHref({ category: category.slug }))}
                    // Transparent, not `bg-surface`: the panel is `bg-elevated`,
                    // which in dark is one rung ABOVE surface — a surface-filled
                    // chip on it reads as a hole rather than a chip.
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-transparent px-3 py-2 text-label text-foreground transition-colors duration-fast ease-out hover:border-border-strong hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {/* The clay artwork, not the lucide glyph the chip used
                        to carry. Every other category affordance in the
                        product — the home tiles, the landing banner — is this
                        illustration, and a line icon here made the search
                        panel the one surface with a second visual language
                        for the same eight things. */}
                    <ClayIcon slug={category.slug} className="size-6" />
                    {category.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {showEmpty ? (
            <div className="flex flex-col items-center px-3 py-8 text-center">
              {/* The same picture the browse page draws for a search that
                  found nothing, so the two surfaces answer one situation the
                  same way. Small here: this is a panel a few hundred pixels
                  tall, and the scene has to leave room for the way out below
                  it. */}
              <SceneNoResults className="mb-stack h-20 w-auto" />
              <p className="text-body text-foreground">
                Nothing matched &ldquo;{debouncedQuery}&rdquo;
              </p>
              <p className="mt-1 text-body-sm text-muted-foreground">
                Try a shorter term, an artist name, or a city.
              </p>
              {/* The one action on an otherwise dead-end screen, so it is the
                  black pill (near-white in dark) rather than the quiet neutral
                  chip it used to be. */}
              <button
                type="button"
                onClick={submitFreeText}
                className="mt-stack-lg inline-flex h-control items-center gap-2 rounded-full bg-cta px-pill text-label text-cta-foreground transition-colors duration-fast ease-out hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-elevated active:bg-cta-active"
              >
                Search all events
                <CornerDownLeft className="size-4" aria-hidden />
              </button>
            </div>
          ) : null}

          {suggestions.isError ? (
            <p role="status" className="px-3 py-6 text-center text-body-sm text-destructive">
              Search is unavailable right now. Check your connection and try again.
            </p>
          ) : null}
        </div>

        {/* `bg-sunken`, not `bg-muted/40`. A 40%-alpha tint under 12px grey
            text has no computable contrast ratio — it depends on whatever
            happens to be behind the panel — and this strip is inside an
            axe-scanned surface. Solid, it is a measured 7.14:1. */}
        <div className="flex items-center justify-between gap-4 border-t border-border bg-sunken px-4 py-2.5 text-caption text-muted-foreground">
          <span className="hidden sm:inline">
            <kbd className="font-sans">↑</kbd> <kbd className="font-sans">↓</kbd> navigate ·{' '}
            <kbd className="font-sans">Enter</kbd> open · <kbd className="font-sans">Esc</kbd> close
          </span>
          <span className="sm:hidden">Tap a suggestion to open it</span>
        </div>
      </ModalContent>
    </Modal>
  );
}

function OptionGroup({
  label,
  children,
  className,
  action,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  /**
   * A control that belongs to THIS group, on its heading row.
   *
   * "Clear recent searches" used to sit on the CATEGORIES heading, because
   * that is where there happened to be room — so the button that empties one
   * list was captioned by another. A group's action goes on that group's
   * heading; anything else is a mis-labelled control.
   */
  action?: React.ReactNode;
}) {
  return (
    <div className={cn('py-1', className)} role="group" aria-label={label}>
      {/* `text-label` (13/600) rather than `text-caption` (12/500): the group
          heading has to out-rank the option labels beneath it, and at the old
          weight the two read as one flat list. */}
      <div className="flex items-center justify-between gap-3 px-3 py-1.5">
        <p className="text-label uppercase tracking-wide text-foreground-subtle">{label}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function Option({
  item,
  active,
  icon,
  onHover,
  onSelect,
}: {
  item: Suggestion;
  active: boolean;
  icon?: typeof Ticket;
  onHover: () => void;
  onSelect: () => void;
}) {
  const Icon = icon ?? TYPE_ICON[item.type];
  return (
    <div
      id={`search-option-${item.id}`}
      role="option"
      aria-selected={active}
      data-active={active}
      onMouseMove={onHover}
      onClick={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 transition-colors',
        active ? 'bg-muted' : 'bg-transparent',
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm text-foreground">{item.label}</span>
        {item.sublabel ? (
          <span className="block truncate text-caption text-muted-foreground">{item.sublabel}</span>
        ) : null}
      </span>
      {active ? (
        <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
    </div>
  );
}
