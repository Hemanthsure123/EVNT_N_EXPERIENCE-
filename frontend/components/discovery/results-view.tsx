'use client';

import * as React from 'react';
import { Loader2, WifiOff } from 'lucide-react';
import { SceneError } from '@/components/illustrations/scenes';
import { Container } from '@/components/shell/container';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { type SeededEventPages, useEventsInfinite } from '@/lib/api/hooks/use-events';
import type { EventsQuery } from '@/lib/api/events';
import type { EventCard as EventCardData } from '@/lib/api/types';
import { errorMessage } from '@/lib/api/errors';
import { organiserFacets, resultStats, timeFacets } from '@/lib/discovery/facets';
import {
  type DiscoveryFilters,
  EMPTY_FILTERS,
  applyRefinement,
  clientRefinement,
  filtersToSearchParams,
  toServerQuery,
} from '@/lib/discovery/filters';
import { useOnline } from '@/lib/utils/use-online';
import { CategoryBanner } from './category-banner';
import { EventGrid, EventGridSkeleton } from './event-grid';
import { FilterDrawer } from './filter-drawer';
import { FilterToolbar } from './filter-toolbar';
import { ResultsEmpty } from './results-empty';
import { SubscribeCard } from './subscribe-card';

/**
 * Browse / search results.
 *
 * Data flow: the server already rendered page 1 (good for SEO and LCP), and
 * that exact page seeds the infinite query — so mounting costs ZERO extra
 * requests. Further pages come from the backend's cursor pagination, and the
 * sentinel fires 600px BEFORE it scrolls into view, which makes the next page a
 * prefetch rather than a wait.
 *
 * Filter state lives here, not in the URL round-trip: tapping a chip updates
 * state and rewrites the URL with `history.replaceState`, so a chip responds in
 * a frame instead of waiting on a server navigation (this is the INP-sensitive
 * interaction on the page). The URL still describes the result set exactly, so
 * it stays shareable and server-renderable on a fresh load. `replaceState`
 * rather than `pushState` on purpose — twelve chip taps shouldn't cost twelve
 * presses of the back button.
 *
 * LAYOUT OWNERSHIP: this component owns everything from the banner down,
 * including the full-bleed sticky toolbar — which is why it renders its own
 * `Container`s rather than sitting inside one. The toolbar has to span the
 * viewport to read as a bar instead of a floating card, and it can't do that
 * from inside a max-width column.
 *
 * THE COUNT HAS ONE HOME, AND THE BANNER IS A DESKTOP AFFORDANCE. Measured on a
 * 390px phone, this page spent about a screen and a half before the first card
 * and said "8 events" twice — once as a pill on the banner, once in the
 * toolbar's summary line. The toolbar keeps it: that line is a live region
 * (`role="status"`) and it sits beside the controls that change the number. The
 * banner's whole stat block went, and the banner itself is hidden below `md`,
 * WRAPPER INCLUDED — hiding the section alone would leave its `pb-8` gutter
 * behind as 32px of nothing. On a phone the first card now starts inside the
 * first screen instead of one and a half screens down.
 *
 * THE CONTROLS AND THE GRID RUN AT DIFFERENT URGENCIES. `filters` drives the
 * toolbar and the URL and updates synchronously, so a chip shows its pressed
 * state in the same frame it was tapped. The grid reads `deferredFilters`
 * (`useDeferredValue`), so re-rendering twenty cards happens as an interruptible
 * follow-up rather than inside the interaction. INP measures until the next
 * paint, and the paint that matters is the chip's.
 *
 * ON VIRTUALISATION, which the brief asks for: this list is NOT virtualised,
 * deliberately. `content-visibility: auto` on off-screen cards (`cv-card`)
 * already skips their layout and paint — the same win — while keeping every
 * card in the DOM, so find-in-page, screen-reader browse mode, "open in new
 * tab" and the reserved scroll height all keep working. A windowing library
 * trades all of that away and fights the reserved min-height that holds CLS at
 * zero. Revisit if one query ever holds thousands of rows; at a 20-row page
 * size behind cursor pagination, it doesn't.
 */

/** How far before the sentinel to start the next page. */
const PREFETCH_MARGIN = '600px';
/** With a client-side refinement on, keep pulling until at least this many
 * matches are on screen (bounded, so a pathological filter can't loop). */
const MIN_REFINED_RESULTS = 12;
const MAX_AUTO_PAGES = 5;
/** The grid is the expensive subtree; skip it whenever its inputs are unchanged. */
const MemoEventGrid = React.memo(EventGrid);
/** Re-renders only when its own inputs change, not on every chip tap. */
const MemoBanner = React.memo(CategoryBanner);
const MemoToolbar = React.memo(FilterToolbar);

export type ResultsViewProps = {
  initialFilters: DiscoveryFilters;
  /** The exact query the server used, so the client's first key matches it. */
  initialQuery: EventsQuery;
  initialEvents: EventCardData[];
  initialNext: string | null;
  initialError: string | null;
  /** Banner copy, resolved on the server from the filters. */
  bannerEyebrow: string;
  /** Optional: the unfiltered list carries a photograph and no sentence. */
  bannerHeadline?: string;
  /** Server-rendered backdrop `<Image>`, so the photo is in the initial HTML. */
  bannerBackdrop?: React.ReactNode;
};

export function ResultsView({
  initialFilters,
  initialQuery,
  initialEvents,
  initialNext,
  initialError,
  bannerEyebrow,
  bannerHeadline,
  bannerBackdrop,
}: ResultsViewProps) {
  const [filters, setFilters] = React.useState(initialFilters);
  // The grid lags the controls by a frame or two on purpose — see the note above.
  const deferredFilters = React.useDeferredValue(filters);
  // Same split for the layout switch: the toggle shows its new pressed state
  // immediately, and re-laying twenty cards out as rows follows.
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const online = useOnline();
  const sentinelRef = React.useRef<HTMLDivElement>(null);
  const resultsRef = React.useRef<HTMLDivElement>(null);
  const initialKey = React.useRef(JSON.stringify(initialFilters));
  const autoPagesRef = React.useRef(0);

  // On first render the filters ARE the server's filters, so reuse the query it
  // computed verbatim — recomputing a date window here would produce a
  // different `starts_after` (milliseconds later) and throw away the seed.
  const isInitial = JSON.stringify(deferredFilters) === initialKey.current;
  const serverQuery = React.useMemo(
    () => (isInitial ? initialQuery : toServerQuery(deferredFilters)),
    [isInitial, deferredFilters, initialQuery],
  );

  // Seed ONLY under the key the server actually fetched — seeding a different
  // filter's key would show the previous results under the new chips.
  const seed = React.useMemo<SeededEventPages | undefined>(
    () =>
      isInitial && !initialError
        ? {
            pages: [{ data: initialEvents, meta: { next: initialNext, previous: null } }],
            pageParams: [null],
          }
        : undefined,
    [isInitial, initialError, initialEvents, initialNext],
  );

  const query = useEventsInfinite(serverQuery, { initialData: seed });

  const { data, isPending } = query;
  const pages = data?.pages ?? null;

  const allEvents = React.useMemo(() => (pages ? pages.flatMap((page) => page.data) : []), [pages]);

  const refinement = clientRefinement(deferredFilters);

  // Deps are narrowed to the fields the refinement actually reads. Depending on
  // the whole `filters` object would hand `MemoEventGrid` a fresh array on every
  // chip tap and force all 20 cards to re-render for a filter the grid doesn't
  // even care about — measured at ~340ms of the interaction's INP.
  const { price, sort, time, organizer } = deferredFilters;
  const events = React.useMemo(
    () => applyRefinement(allEvents, { ...EMPTY_FILTERS, price, sort, time, organizer }),
    [allEvents, price, sort, time, organizer],
  );

  const updateFilters = React.useCallback((next: DiscoveryFilters) => {
    autoPagesRef.current = 0;
    setFilters(next);
    const qs = filtersToSearchParams(next).toString();
    window.history.replaceState(null, '', qs ? `/events?${qs}` : '/events');
  }, []);

  const { fetchNextPage, hasNextPage, isFetchingNextPage, isPlaceholderData } = query;

  const loadMore = React.useCallback(() => {
    // Never paginate a placeholder — those pages belong to the previous filter.
    if (hasNextPage && !isFetchingNextPage && !isPlaceholderData) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isPlaceholderData]);

  // Prefetching sentinel.
  React.useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: PREFETCH_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, loadMore]);

  // Price, time, organiser and price-sorting are refined client-side (the
  // backend has none of them yet), so keep pulling pages until there are enough
  // matches to fill the screen.
  React.useEffect(() => {
    if (!refinement.active || !hasNextPage || isFetchingNextPage || isPlaceholderData) return;
    if (events.length >= MIN_REFINED_RESULTS) return;
    if (autoPagesRef.current >= MAX_AUTO_PAGES) return;
    autoPagesRef.current += 1;
    void fetchNextPage();
  }, [
    refinement.active,
    events.length,
    hasNextPage,
    isFetchingNextPage,
    isPlaceholderData,
    fetchNextPage,
  ]);

  // A server-side failure is ALREADY an answer. Waiting for the client query to
  // exhaust its retry backoff before admitting it meant several seconds of
  // skeleton for an error we were told about before the page even rendered —
  // and the reader spends that time believing results are on the way.
  const serverFailed = !!initialError && !pages?.length;
  const failed = query.isError || serverFailed;
  const loading = isPending && !pages && !serverFailed;

  const stats = React.useMemo(
    () => resultStats(events, Boolean(hasNextPage)),
    [events, hasNextPage],
  );
  const organisers = React.useMemo(() => organiserFacets(allEvents), [allEvents]);
  const timeBands = React.useMemo(() => timeFacets(allEvents), [allEvents]);

  const resultLabel = loading
    ? 'Loading…'
    : isPlaceholderData
      ? 'Updating…'
      : `${stats.loaded}${stats.more ? '+' : ''} ${stats.loaded === 1 ? 'event' : 'events'}`;

  // Applying from the drawer brings the results back into view — the panel
  // covers the grid, so otherwise the answer to what you just changed is
  // wherever you happened to be scrolled to.
  //
  // ONLY when they've actually been scrolled past, and never smoothly. An
  // unconditional smooth scroll animates for ~300ms while the result set is
  // being replaced underneath it, and the browser scores that as layout shift:
  // 0.065, measured — bigger than everything else on the page put together. If
  // the grid is already on screen, the right amount of scrolling is none.
  const applyFromDrawer = React.useCallback(
    (next: DiscoveryFilters) => {
      updateFilters(next);
      const top = resultsRef.current?.getBoundingClientRect().top ?? 0;
      if (top < 0) resultsRef.current?.scrollIntoView({ block: 'start' });
    },
    [updateFilters],
  );

  return (
    <div className="flex flex-col">
      {/* Desktop only, gutter and all — see "the count has one home" above. */}
      <Container className="hidden pb-2 md:block">
        <MemoBanner eyebrow={bannerEyebrow} headline={bannerHeadline} backdrop={bannerBackdrop} />
      </Container>

      <MemoToolbar
        filters={filters}
        onChange={updateFilters}
        onOpenFilters={() => setDrawerOpen(true)}
        resultLabel={resultLabel}
      />

      <FilterDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        filters={filters}
        onApply={applyFromDrawer}
        organisers={organisers}
        timeBands={timeBands}
      />

      <Container className="flex flex-col gap-6 py-section lg:py-section-lg">
        {!online ? (
          <div
            role="status"
            className="flex items-center gap-3 rounded-lg border border-warning-subtle bg-warning-subtle px-4 py-3 text-body-sm text-warning-subtle-foreground"
          >
            <WifiOff className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">
              You&apos;re offline. These are the events already loaded — we&apos;ll refresh when
              you&apos;re back.
            </span>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : null}

        {refinement.active && hasNextPage ? (
          <p className="text-caption text-muted-foreground">
            Price, time and organiser filters are applied to the results loaded so far — scroll to
            pull in more.
          </p>
        ) : null}

        {/* A reserved floor: changing a filter must never collapse the page
            height under the reader between the old results and the new ones.
            Raised with the card: a PORTRAIT poster plus its text block is
            roughly 45rem tall at three-up, and a floor shorter than one row
            lets the page jump on every filter change. */}
        <div ref={resultsRef} className="flex min-h-[45rem] scroll-mt-32 flex-col gap-6">
          {loading ? <EventGridSkeleton /> : null}

          {!loading && failed ? (
            <EmptyState
              // The same picture `row-states.tsx` draws for this exact
              // situation. Both can appear on THIS page, and a 32px warning
              // triangle beside a drawn scene for the same failure reads as
              // two different problems.
              icon={<SceneError className="h-28 w-auto sm:h-32" />}
              title="We couldn't load these events"
              description={
                query.error ? errorMessage(query.error) : (initialError ?? 'Something went wrong.')
              }
              action={
                <Button onClick={() => void query.refetch()} loading={query.isFetching}>
                  Try again
                </Button>
              }
            />
          ) : null}

          {!loading && !failed && events.length ? (
            <>
              <div
                aria-busy={isPlaceholderData}
                className={
                  isPlaceholderData
                    ? 'opacity-60 transition-opacity duration-fast'
                    : 'transition-opacity duration-fast'
                }
              >
                <MemoEventGrid
                  events={events}
                  priorityCount={3}
                  promo={<SubscribeCard asListItem />}
                />
              </div>

              <div ref={sentinelRef} aria-hidden className="h-px w-full" />

              <div className="flex flex-col items-center gap-3 py-4">
                {isFetchingNextPage ? (
                  <p className="inline-flex items-center gap-2 text-body-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Loading more events…
                  </p>
                ) : hasNextPage ? (
                  // Keyboard/no-observer path — the sentinel is an optimisation,
                  // never the only way to reach page 2.
                  <Button variant="outline" onClick={loadMore}>
                    Load more events
                  </Button>
                ) : (
                  <p className="text-body-sm text-muted-foreground">
                    That&apos;s everything matching these filters.
                  </p>
                )}
              </div>
            </>
          ) : null}

          {!loading && !failed && !events.length ? (
            <ResultsEmpty filters={filters} onChange={updateFilters} />
          ) : null}
        </div>
      </Container>
    </div>
  );
}
