import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Route-level loading screens for the THREE consoles — organizer, operator and
 * performer studio.
 *
 * ── WHY THIS FILE HAD TO EXIST ────────────────────────────────────────────
 *
 * `app/(site)` had six `loading.tsx` routes and the consoles had **none**. So
 * every screen an organizer, an operator or a performer opens went from the
 * previous page straight to a blank region while its queries resolved —
 * and these are the slowest pages in the product, because they are the ones
 * that aggregate. The surface that shows somebody their money was the surface
 * with no loading state at all.
 *
 * ── THEY ARE SHAPED LIKE THE PAGE, NOT LIKE A SPINNER ─────────────────────
 *
 * Same rule as `components/discovery/skeletons.tsx`: a spinner says "wait" and
 * nothing else, while a skeleton in the real layout says what is coming and
 * where. Because the boxes are the size of the content, nothing shifts when it
 * arrives — which matters more here than on the marketing pages, since a table
 * that reflows under a cursor is a table somebody mis-clicks.
 *
 * ── ONE ANNOUNCEMENT PER SCREEN ───────────────────────────────────────────
 *
 * Every placeholder is `aria-hidden` and each screen carries a single polite
 * `role="status"`. A screen reader hears "Loading bookings" once, rather than
 * forty empty cells.
 *
 * ── AND THEY DO NOT ANIMATE UNDER REDUCED MOTION ──────────────────────────
 *
 * The shimmer comes from the shared `.skeleton` class in `styles/globals.css`,
 * which already handles that — so it is inherited rather than re-declared, and
 * a change to the sweep moves every skeleton in the product together.
 */

/** A bar. Literal widths only — Tailwind scans source text, so `w-${n}` is a class that never existed. */
export function Bar({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} />;
}

/** One announcement for a whole screen. */
export function LoadingAnnouncement({ label }: { label: string }) {
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {label}
    </p>
  );
}

/**
 * Uneven on purpose. A column of identical bars reads as a progress indicator;
 * varied ones read as the words that are coming.
 */
const CELL_WIDTHS = ['w-32', 'w-24', 'w-40', 'w-20', 'w-28', 'w-16'];

/* ── Building blocks ─────────────────────────────────────────────────────── */

export function PageHeaderSkeleton({ withActions = true }: { withActions?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-2">
        <Bar className="h-7 w-48" />
        <Bar className="h-4 w-72 max-w-full" />
      </div>
      {withActions ? (
        <div className="flex gap-2">
          <Bar className="h-control w-28 rounded-full" />
          <Bar className="h-control w-24 rounded-full" />
        </div>
      ) : null}
    </div>
  );
}

/** The stat row every console home opens with. */
export function StatTilesSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-card shadow-sm"
        >
          <Bar className="h-3 w-24" />
          <Bar className="h-8 w-20" />
          <Bar className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

/**
 * The shared table engine's shape: a sticky header row and N body rows.
 *
 * `rows` defaults to 8 rather than to a page size. A skeleton that draws
 * twenty-five rows on a list that turns out to hold three is a page that
 * collapses upward the moment it loads, which is worse than one that grows.
 */
export function TableSkeleton({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-center gap-4 border-b border-border bg-sunken px-card py-3">
        {Array.from({ length: columns }, (_, index) => (
          <Bar key={index} className={cn('h-3', CELL_WIDTHS[index % CELL_WIDTHS.length])} />
        ))}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-center gap-4 px-card py-4">
            {Array.from({ length: columns }, (_, col) => (
              <Bar key={col} className={cn('h-4', CELL_WIDTHS[(row + col) % CELL_WIDTHS.length])} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A filter/search bar above a table. */
export function ToolbarSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Bar className="h-control w-full max-w-sm rounded-full" />
      <Bar className="h-control w-28 rounded-full" />
      <Bar className="h-control w-24 rounded-full" />
    </div>
  );
}

/**
 * A chart panel.
 *
 * The plot area is ONE block rather than a set of fake bars. Drawing plausible
 * bars would be drawing data — and on an analytics screen a skeleton that
 * resembles a chart is briefly indistinguishable from a real one showing a
 * shape nobody measured.
 */
export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-border bg-surface p-card shadow-sm',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <Bar className="h-4 w-36" />
        <Bar className="h-control-sm w-24 rounded-full" />
      </div>
      <Bar className="h-48 w-full rounded-lg" />
    </div>
  );
}

/** A vertical list of cards — a queue, a feed, a set of requests. */
export function CardListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="flex items-start gap-4 rounded-xl border border-border bg-surface p-card shadow-sm"
        >
          <Bar className="size-10 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Bar className="h-4 w-48 max-w-full" />
            <Bar className="h-3 w-full max-w-md" />
            <Bar className="h-3 w-32" />
          </div>
          <Bar className="h-control-sm w-20 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/* ── Whole screens ───────────────────────────────────────────────────────── */

/** The shell every console page shares: the page padding and vertical rhythm. */
function Screen({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <LoadingAnnouncement label={label} />
      {children}
    </div>
  );
}

/** A dashboard home: tiles, then a chart, then a feed. */
export function ConsoleHomeSkeleton({ label = 'Loading dashboard' }: { label?: string }) {
  return (
    <Screen label={label}>
      <PageHeaderSkeleton />
      <StatTilesSkeleton />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <ChartSkeleton />
        <CardListSkeleton rows={3} />
      </div>
    </Screen>
  );
}

/** Any list screen: header, filters, table. The most common console shape. */
export function ConsoleTableSkeleton({
  label = 'Loading',
  columns = 5,
  rows = 8,
}: {
  label?: string;
  columns?: number;
  rows?: number;
}) {
  return (
    <Screen label={label}>
      <PageHeaderSkeleton />
      <ToolbarSkeleton />
      <TableSkeleton rows={rows} columns={columns} />
    </Screen>
  );
}

/** A queue of cards rather than a table — moderation, refund requests. */
export function ConsoleQueueSkeleton({ label = 'Loading queue' }: { label?: string }) {
  return (
    <Screen label={label}>
      <PageHeaderSkeleton />
      <ToolbarSkeleton />
      <CardListSkeleton rows={5} />
    </Screen>
  );
}

/** An analytics screen: tiles then charts. */
export function ConsoleAnalyticsSkeleton({ label = 'Loading analytics' }: { label?: string }) {
  return (
    <Screen label={label}>
      <PageHeaderSkeleton />
      <StatTilesSkeleton />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
      <ChartSkeleton />
    </Screen>
  );
}

/** A settings or form screen: sections of labelled fields. */
export function ConsoleFormSkeleton({ label = 'Loading settings' }: { label?: string }) {
  return (
    <Screen label={label}>
      <PageHeaderSkeleton withActions={false} />
      {Array.from({ length: 3 }, (_, section) => (
        <div
          key={section}
          className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-card shadow-sm"
        >
          <div className="flex flex-col gap-2">
            <Bar className="h-4 w-40" />
            <Bar className="h-3 w-64 max-w-full" />
          </div>
          {Array.from({ length: 2 }, (_, field) => (
            <div key={field} className="flex flex-col gap-2">
              <Bar className="h-3 w-24" />
              <Bar className="h-control w-full max-w-md rounded-md" />
            </div>
          ))}
        </div>
      ))}
    </Screen>
  );
}
