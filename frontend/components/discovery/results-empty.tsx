'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, MapPin, Search } from 'lucide-react';
import { SceneNoResults, SceneOffline } from '@/components/illustrations/scenes';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { useOnline } from '@/lib/utils/use-online';
import { CATEGORIES } from '@/lib/discovery/categories';
import { POPULAR_CITIES } from '@/lib/discovery/cities';
import {
  type DiscoveryFilters,
  EMPTY_FILTERS,
  WHEN_LABELS,
  browseHref,
  categoryLabel,
  hasAnyFilter,
} from '@/lib/discovery/filters';
import { cn } from '@/lib/utils/cn';

/**
 * The no-results screen — a route out, not a dead end.
 *
 * The failure it's designed around: someone stacks four filters, gets nothing,
 * and has no idea WHICH one is responsible. So the first thing offered isn't
 * "clear everything" (that throws away all their intent) — it's the single
 * filter most likely to be the culprit, named, with one tap to drop it. Dates
 * first, because a date window is the filter that most often empties a list,
 * and it's the one people care least about keeping.
 *
 * Below that, three ways sideways that always work because they're LINKS to
 * known-populated pages rather than more filter combinations: other categories,
 * other cities, and a handful of searches. Nothing here can produce a second
 * empty screen from a dead control.
 *
 * The illustration is drawn from the icon set and the tokens rather than
 * shipped as an asset — it themes correctly in light and dark, costs no
 * request, and can never be the thing that fails to load on the one screen
 * whose job is to reassure.
 */

/** Query strings that reliably match something in a live catalogue. */
const POPULAR_SEARCHES = ['comedy night', 'live music', 'weekend workshop', 'food festival'];

export function ResultsEmpty({
  filters,
  onChange,
  onRetry,
}: {
  filters: DiscoveryFilters;
  onChange: (next: DiscoveryFilters) => void;
  /** A real refetch, if the caller has one. See `ResultsOffline` for why this
   *  is optional rather than a button that reloads the document. */
  onRetry?: () => void;
}) {
  const online = useOnline();

  // OFFLINE IS NOT AN EMPTY RESULT SET, and this panel is the wrong answer to
  // it in a specific way: every single control below — the suspect-filter
  // button, "Start over", the category chips, the city chips, the popular
  // searches — triggers a fetch. Offering somebody with no connection eleven
  // things to press, each of which fails, is worse than offering nothing, and
  // the headline "Nothing matched all of that" blames their filters for a
  // problem their filters did not cause.
  if (!online) {
    return <ResultsOffline onRetry={onRetry} />;
  }

  // The filter most likely to be the reason, in the order worth relaxing.
  const suspect: { label: string; next: DiscoveryFilters } | null = filters.when
    ? {
        label: `Any date instead of ${WHEN_LABELS[filters.when].toLowerCase()}`,
        next: { ...filters, when: null },
      }
    : filters.time
      ? { label: 'Any time of day', next: { ...filters, time: null } }
      : filters.price
        ? { label: 'Any price', next: { ...filters, price: null } }
        : filters.organizer
          ? { label: 'All organisers', next: { ...filters, organizer: null } }
          : filters.city
            ? { label: `Everywhere, not just ${filters.city}`, next: { ...filters, city: null } }
            : filters.category
              ? {
                  label: `All categories, not just ${categoryLabel(filters.category)}`,
                  next: { ...filters, category: null },
                }
              : filters.q
                ? // Last, because a typed query is the most deliberate thing on
                  // the page — everything else gets relaxed before it does.
                  { label: 'Search everything instead', next: { ...filters, q: '' } }
                : null;

  const nearby = POPULAR_CITIES.filter((city) => city.name !== filters.city).slice(0, 6);
  const otherCategories = CATEGORIES.filter((category) => category.slug !== filters.category).slice(
    0,
    6,
  );

  return (
    // `bg-sunken`: the one value step available in light theme runs DOWNWARD,
    // and an empty result set is a recessed well rather than a card that lifts.
    // A dashed hairline on a white block over a white page was two invisible
    // things stacked.
    <div className="flex flex-col items-center gap-10 rounded-2xl border border-dashed border-border-strong bg-sunken px-6 py-12 text-center">
      <div className="flex flex-col items-center gap-4">
        <Illustration />
        <div className="flex max-w-md flex-col gap-2">
          <h2 className="text-h4">Nothing matched all of that</h2>
          <p className="text-body-sm text-muted-foreground">
            {hasAnyFilter(filters)
              ? 'Every filter narrows the list — dropping one usually brings it back.'
              : 'There are no upcoming events to show right now. New ones go live every week.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {suspect ? <Button onClick={() => onChange(suspect.next)}>{suspect.label}</Button> : null}
          {hasAnyFilter(filters) ? (
            <Button
              variant={suspect ? 'outline' : 'primary'}
              onClick={() => onChange(EMPTY_FILTERS)}
            >
              {/* A FULL reset, query included — unlike the toolbar's "Clear
                  all", which keeps the query because the search box is still
                  on screen there. Here, keeping it would make the button a
                  no-op on exactly the screen where nothing else is left. */}
              Start over
            </Button>
          ) : (
            <Button asChild>
              <Link href="/">
                Back to home
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid w-full max-w-3xl gap-8 text-left sm:grid-cols-2">
        <Suggestions title="Try another category">
          {otherCategories.map((category) => (
            <Chip
              key={category.slug}
              onClick={() => onChange({ ...EMPTY_FILTERS, category: category.slug })}
            >
              <category.icon className="size-3.5" aria-hidden />
              {category.label}
            </Chip>
          ))}
        </Suggestions>

        <Suggestions title={filters.city ? 'Nearby cities' : 'Popular cities'}>
          {nearby.map((city) => (
            <Chip key={city.slug} onClick={() => onChange({ ...EMPTY_FILTERS, city: city.name })}>
              <MapPin className="size-3.5" aria-hidden />
              {city.name}
            </Chip>
          ))}
        </Suggestions>

        <Suggestions title="Popular searches" className="sm:col-span-2">
          {POPULAR_SEARCHES.map((term) => (
            <Link
              key={term}
              href={browseHref({ q: term })}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-label text-foreground',
                'transition-colors duration-fast hover:bg-muted',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              )}
            >
              <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              {term}
            </Link>
          ))}
        </Suggestions>
      </div>
    </div>
  );
}

/**
 * THE RESULTS SURFACE, WITH NO CONNECTION.
 *
 * Exported so the results view can use it for a FAILED fetch as well as for an
 * empty one. Those are two different code paths — a rejected request renders
 * the error state, an empty page renders `ResultsEmpty` — but offline they are
 * the same situation and must not produce two different explanations of it.
 *
 * ── WHY THE RETRY BUTTON IS CONDITIONAL ──────────────────────────────────
 *
 * `onRetry` is whatever refetch the caller already owns. When it is absent this
 * renders NO retry control, and specifically does not fall back to
 * `location.reload()`: a full document reload while offline replaces a page
 * that still has content on it with the browser's own network error page. The
 * empty branch reaches this without a retry today, and that is fine — the
 * results view shows its own offline banner with a working Retry above it, so
 * the reader is not without a control.
 *
 * ── AND WHY NO "WE'LL RETRY AUTOMATICALLY" ───────────────────────────────
 *
 * Nothing here subscribes to the `online` event to refire the query; the hook
 * only re-renders. Promising an automatic retry we do not perform is the same
 * class of lie as a spinner with no request behind it.
 */
export function ResultsOffline({ onRetry }: { onRetry?: () => void }) {
  return (
    <div
      // Same recessed well as the empty state, so the two read as one surface
      // in two moods rather than as two components.
      className="flex flex-col items-center gap-6 rounded-2xl border border-dashed border-border-strong bg-sunken px-6 py-12 text-center"
      role="status"
    >
      <SceneOffline className="h-32 w-auto sm:h-40" />
      <div className="flex max-w-md flex-col gap-2">
        <h2 className="text-h4">You&rsquo;re offline</h2>
        <p className="text-body-sm text-muted-foreground">
          We couldn&rsquo;t reach Curatix to load these events. Check your connection — your filters
          are still set, so this picks up where you left off.
        </p>
      </div>
      {onRetry ? <Button onClick={onRetry}>Try again</Button> : null}
    </div>
  );
}

function Suggestions({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-3', className)} aria-label={title}>
      <h3 className="text-label uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

/**
 * A character who looked and came back with nothing.
 *
 * This was a `CalendarX2` glyph inside a bordered square with a blurred
 * gradient behind it — a competent placeholder that said "error" more than it
 * said "no matches". The scene reads as an attempt that did not find
 * anything, which is what actually happened, and it is the same illustration
 * language as the clay category icons rather than a third visual idea.
 *
 * The soft halo is kept: it seats the artwork on the page. It is a NEUTRAL
 * now — it was a blurred brand gradient, which on a white page put a violet
 * bruise behind the one illustration whose job is to be reassuring.
 */
function Illustration() {
  return (
    <div className="relative flex items-center justify-center" aria-hidden>
      <div className="absolute inset-x-4 inset-y-2 rounded-full bg-muted blur-xl" />
      <SceneNoResults className="relative h-28" />
    </div>
  );
}
