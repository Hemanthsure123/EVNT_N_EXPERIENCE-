'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { SlidersHorizontal, X } from 'lucide-react';
import {
  OCCASION_LABELS,
  PERFORMER_TYPE_LABELS,
  fetchMarketplaceFacets,
  fetchPerformers,
  type Occasion,
  type PerformerType,
} from '@/lib/api/performers';
import { cursorFromNextLink } from '@/lib/api/events';
import {
  SceneNoResults,
  SceneNothingYet,
  SceneOffline,
} from '@/components/illustrations/scenes';
import { PerformerCard } from './performer-card';
import { cn } from '@/lib/utils/cn';

/**
 * The marketplace.
 *
 * ── FILTERS LIVE IN THE URL ───────────────────────────────────────────────
 *
 * `?type=&city=&budget_max=&genre=&language=&occasion=&min_experience=&verified=`.
 * A filtered search is shareable, reloadable, and the back button steps
 * through refinements rather than leaving the page — which matters more here
 * than on most surfaces, because "the four jazz bands in Pune under 50k" is
 * exactly the thing somebody sends to whoever else is deciding.
 *
 * ── THE FILTER OPTIONS ARE DERIVED, NOT DECLARED ──────────────────────────
 *
 * Cities, genres and languages come from `/performers/facets`, computed
 * server-side over LIVE performers. A hard-coded genre list would offer
 * filters that return nothing the moment the roster does not match it — and a
 * filter that always returns nothing teaches people the marketplace is empty.
 *
 * ── WHAT IS NOT FILTERABLE, AND WHY ───────────────────────────────────────
 *
 * **Ratings** — nothing stores a review, so there is no number to filter on.
 * **Availability** — a real calendar needs its own model with blocked dates;
 * today the honest signal is that a performer answers a brief for that date or
 * does not. Both are BACKLOG items rather than controls that quietly do
 * nothing.
 *
 * ── THE GRID IS 2-UP UNDER `sm` ───────────────────────────────────────────
 *
 * One card per row turned eight acts into eight screens. The card compacts
 * with it (see `performer-card.tsx`) rather than being squeezed at the same
 * type sizes, and every skeleton, empty state and control on this screen sits
 * on the same 44px touch floor — the `Select`s were 40px, which is under it.
 */

const TYPES: { value: PerformerType | ''; label: string }[] = [
  { value: '', label: 'All acts' },
  ...(Object.keys(PERFORMER_TYPE_LABELS) as PerformerType[]).map((value) => ({
    value,
    label: PERFORMER_TYPE_LABELS[value],
  })),
];

const OCCASIONS: { value: Occasion | ''; label: string }[] = [
  { value: '', label: 'Any occasion' },
  ...(Object.keys(OCCASION_LABELS) as Occasion[]).map((value) => ({
    value,
    label: OCCASION_LABELS[value],
  })),
];

/** Rupees, converted to minor units at the boundary. */
const BUDGETS = [
  { value: '', label: 'Any budget' },
  { value: '2500000', label: 'Under ₹25,000' },
  { value: '5000000', label: 'Under ₹50,000' },
  { value: '10000000', label: 'Under ₹1,00,000' },
  { value: '25000000', label: 'Under ₹2,50,000' },
];

const EXPERIENCE = [
  { value: '', label: 'Any experience' },
  { value: '2', label: '2+ years' },
  { value: '5', label: '5+ years' },
  { value: '10', label: '10+ years' },
];

type Filters = {
  q: string;
  type: string;
  city: string;
  budget_max: string;
  genre: string;
  language: string;
  occasion: string;
  min_experience: string;
  verified: string;
};

const EMPTY: Filters = {
  q: '',
  type: '',
  city: '',
  budget_max: '',
  genre: '',
  language: '',
  occasion: '',
  min_experience: '',
  verified: '',
};

export function Marketplace() {
  const router = useRouter();
  const params = useSearchParams();
  const [panelOpen, setPanelOpen] = React.useState(false);
  // Debounced into the URL rather than written per keystroke — thirty history
  // entries for one search, and thirty requests, is the alternative.
  const searchTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(searchTimer.current), []);

  const filters = React.useMemo<Filters>(() => {
    const next = { ...EMPTY };
    for (const key of Object.keys(EMPTY) as (keyof Filters)[]) {
      next[key] = params?.get(key) ?? '';
    }
    return next;
  }, [params]);

  const set = React.useCallback(
    (patch: Partial<Filters>) => {
      const next = new URLSearchParams(params?.toString() ?? '');
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      const encoded = next.toString();
      // `replace`, not `push` — a filter change refines the same view. Pushing
      // would make the back button walk through every keystroke of a search.
      router.replace(encoded ? `/hire?${encoded}` : '/hire', { scroll: false });
    },
    [params, router],
  );

  const facets = useQuery({
    queryKey: ['marketplace', 'facets'],
    queryFn: () => fetchMarketplaceFacets(),
    staleTime: 300_000,
  });

  const query = useInfiniteQuery({
    queryKey: ['marketplace', 'performers', filters],
    queryFn: ({ pageParam }) =>
      fetchPerformers({
        ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)),
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    staleTime: 30_000,
  });

  const performers = query.data?.pages.flatMap((page) => page.data) ?? [];
  const active = Object.entries(filters).filter(([, value]) => value);

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      {/* Below `sm` the search takes its own row and the filter button shares
          the next one with the count — three controls squeezed onto one 360px
          line left the search box about wide enough for "jaz". */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="relative w-full min-w-0 sm:w-auto sm:max-w-md sm:flex-1">
          <label htmlFor="performer-search" className="sr-only">
            Search performers
          </label>
          <input
            id="performer-search"
            type="search"
            defaultValue={filters.q}
            onChange={(event) => {
              const value = event.target.value;
              window.clearTimeout(searchTimer.current);
              searchTimer.current = window.setTimeout(() => set({ q: value }), 300);
            }}
            placeholder="Search by name, genre or style"
            className="h-12 w-full rounded-xl border border-border bg-surface px-4 text-body-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <button
          type="button"
          onClick={() => setPanelOpen((open) => !open)}
          aria-expanded={panelOpen}
          className="inline-flex h-12 items-center gap-2 rounded-xl border border-border px-4 text-label transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          Filters
          {active.length ? (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-caption tabular-nums text-primary-foreground">
              {active.length}
            </span>
          ) : null}
        </button>

        <p role="status" className="ml-auto text-caption text-muted-foreground">
          {query.isPending
            ? 'Loading…'
            : /* A FLOOR, not a total. The list is cursor-paginated and there is
                 no count endpoint, so "24+" is the honest form. */
              `${performers.length}${query.hasNextPage ? '+' : ''} act${
                performers.length === 1 ? '' : 's'
              }`}
        </p>
      </div>

      {panelOpen ? (
        <div className="grid gap-3 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Type"
            value={filters.type}
            onChange={(type) => set({ type })}
            options={TYPES}
          />
          <Select
            label="City"
            value={filters.city}
            onChange={(city) => set({ city })}
            options={[
              { value: '', label: 'Any city' },
              ...(facets.data?.cities ?? []).map((city) => ({ value: city, label: city })),
            ]}
          />
          <Select
            label="Budget"
            value={filters.budget_max}
            onChange={(budget_max) => set({ budget_max })}
            options={BUDGETS}
          />
          <Select
            label="Occasion"
            value={filters.occasion}
            onChange={(occasion) => set({ occasion })}
            options={OCCASIONS}
          />
          <Select
            label="Genre"
            value={filters.genre}
            onChange={(genre) => set({ genre })}
            options={[
              { value: '', label: 'Any genre' },
              ...(facets.data?.genres ?? []).map((genre) => ({ value: genre, label: genre })),
            ]}
          />
          <Select
            label="Language"
            value={filters.language}
            onChange={(language) => set({ language })}
            options={[
              { value: '', label: 'Any language' },
              ...(facets.data?.languages ?? []).map((language) => ({
                value: language,
                label: language,
              })),
            ]}
          />
          <Select
            label="Experience"
            value={filters.min_experience}
            onChange={(min_experience) => set({ min_experience })}
            options={EXPERIENCE}
          />
          {/* `min-h-control` on the LABEL, so the whole 44px row toggles the
              box rather than only the 16px box itself. */}
          <label className="flex min-h-control cursor-pointer items-center gap-2 sm:items-end sm:pb-2">
            <input
              type="checkbox"
              checked={filters.verified === 'true'}
              onChange={(event) => set({ verified: event.target.checked ? 'true' : '' })}
              className="size-4 accent-primary"
            />
            <span className="text-body-sm">Verified organisers only</span>
          </label>
        </div>
      ) : null}

      {active.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {/* 44px tall on a phone, 28px from `sm` up. A filter chip's remove
              button was a 20px circle — the smallest target on the screen, on
              the control somebody reaches for precisely because the results
              are wrong. */}
          {active.map(([key, value]) => (
            <span
              key={key}
              className="inline-flex min-h-control items-center gap-1 rounded-full border border-border bg-secondary pl-3 pr-1 text-caption text-secondary-foreground sm:h-7 sm:min-h-0"
            >
              {chipLabel(key as keyof Filters, value)}
              <button
                type="button"
                onClick={() => set({ [key]: '' })}
                aria-label={`Remove filter: ${chipLabel(key as keyof Filters, value)}`}
                className="inline-flex size-8 items-center justify-center rounded-full transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-5"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => router.replace('/hire', { scroll: false })}
            className="inline-flex min-h-control items-center px-1 text-caption text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
          >
            Clear all
          </button>
        </div>
      ) : null}

      {query.isError ? (
        <MarketplaceState
          role="alert"
          scene={<SceneOffline className="h-24 sm:h-28" />}
          title="Could not load performers"
          body="The connection dropped on the way to the marketplace. Nothing about your filters is wrong — they are still in the URL."
          action={
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="inline-flex h-control items-center rounded-full border border-border bg-surface px-pill text-label transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Try again
            </button>
          }
        />
      ) : query.isPending ? (
        <ul className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <li key={index} className="skeleton aspect-portrait rounded-2xl" aria-hidden />
          ))}
        </ul>
      ) : performers.length === 0 ? (
        /* Two different pictures for two different situations. "Nothing
           matched" and "nothing here yet" have different next actions, and an
           empty state that draws the same thing for both teaches people to
           ignore it — the rule `scenes.tsx` states and the reason both scenes
           exist. */
        <MarketplaceState
          scene={
            active.length ? (
              <SceneNoResults className="h-24 sm:h-28" />
            ) : (
              <SceneNothingYet className="h-24 sm:h-28" />
            )
          }
          title={active.length ? 'No acts match those filters' : 'No performers yet'}
          body={
            active.length
              ? 'Try widening the budget or clearing a filter — the chips above show which are active.'
              : 'Every act here is reviewed before it is listed, so the marketplace fills as profiles are approved.'
          }
          action={
            active.length ? (
              <button
                type="button"
                onClick={() => router.replace('/hire', { scroll: false })}
                className="inline-flex h-control items-center rounded-full border border-border bg-surface px-pill text-label transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Clear filters
              </button>
            ) : (
              <Link
                href="/hire/new"
                className="inline-flex h-control items-center rounded-full bg-cta px-pill text-label text-cta-foreground transition-colors hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Post a brief instead
              </Link>
            )
          }
        />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
            {performers.map((performer, index) => (
              <li key={performer.id}>
                {/* The first ROW only. Two-up on a phone means two cards are
                    above the fold, not four — eager-loading four there would
                    fetch two images nobody has scrolled to yet. */}
                <PerformerCard performer={performer} priority={index < 2} />
              </li>
            ))}
          </ul>

          {query.hasNextPage ? (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
                className="inline-flex h-control items-center rounded-full border border-border px-6 text-label transition-colors hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {query.isFetchingNextPage ? 'Loading…' : 'Show more acts'}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * The one shape every "there is nothing in the grid" screen takes.
 *
 * `bg-sunken` rather than a card: in the light theme the only value step
 * available runs DOWNWARD, and an absent result set is a recessed well, not
 * something that lifts off the page. (A dashed hairline on a white block over
 * a white page was two invisible things stacked — the same fix
 * `discovery/results-empty.tsx` documents.)
 */
function MarketplaceState({
  scene,
  title,
  body,
  action,
  role,
}: {
  scene: React.ReactNode;
  title: string;
  body: string;
  action: React.ReactNode;
  role?: 'alert';
}) {
  return (
    <div
      role={role}
      className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-strong bg-sunken px-4 py-10 text-center sm:px-6 sm:py-14"
    >
      {scene}
      <p className="text-body font-medium">{title}</p>
      <p className="max-w-sm text-body-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-caption font-medium text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          // `h-control` (44px), not 40 — this panel is opened by thumb and a
          // native `<select>` is the one control on the screen you cannot
          // reasonably miss and recover from.
          'h-control rounded-lg border bg-background px-2.5 text-body-sm outline-none transition-colors',
          'focus-visible:ring-2 focus-visible:ring-ring',
          // An active filter looks active. A control identical whether or not
          // it is filtering is how somebody spends five minutes wondering
          // where their results went.
          value ? 'border-primary text-foreground' : 'border-border text-muted-foreground',
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function chipLabel(key: keyof Filters, value: string): string {
  if (key === 'q') return `“${value}”`;
  if (key === 'type') return PERFORMER_TYPE_LABELS[value as PerformerType] ?? value;
  if (key === 'occasion') return OCCASION_LABELS[value as Occasion] ?? value;
  if (key === 'budget_max') {
    return BUDGETS.find((option) => option.value === value)?.label ?? value;
  }
  if (key === 'min_experience') {
    return EXPERIENCE.find((option) => option.value === value)?.label ?? value;
  }
  if (key === 'verified') return 'Verified only';
  return value;
}
