'use client';

import * as React from 'react';
import Link from 'next/link';
import { Activity, QrCode, Receipt, Send, Undo2, Wallet, type LucideIcon } from 'lucide-react';
import { formatMoney } from '@/lib/discovery/format';
import { useFeed } from '@/lib/organizer/queries';
import type { ActivityKind, ActivitySeverity, FeedEntry } from '@/lib/api/organizer';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, Skeleton } from './primitives';
import { cn } from '@/lib/utils/cn';

/**
 * The unified activity timeline.
 *
 * ── ONE FEED, FIVE SOURCES, SERVER-ORDERED ────────────────────────────────
 *
 * `GET /organizer/feed` merges bookings, refunds, admissions, payouts and
 * publishing decisions and sorts them by time. Merging them here instead would
 * mean five paginated queries whose pages cannot be interleaved correctly —
 * the newest row of a source you have not paged into is invisible, so the
 * timeline would silently omit things.
 *
 * ── SEVERITY COMES FROM THE SERVER ────────────────────────────────────────
 *
 * Not re-derived here by matching on `type`. A feed where a failed payout
 * renders like a ticket sale buries the one entry that needed a human, and
 * deciding that in two places is how the two eventually disagree.
 *
 * Severity is the ONLY colour in this component. The medallion carries the
 * semantic tint for the entry's severity, the kind is carried by its icon, and
 * every other pixel is neutral ink — a timeline where five kinds each had a
 * hue would make a failed payout compete with a ticket sale for attention
 * instead of outranking it.
 *
 * ── FILTERS ARE STATE, NOT ACTIONS ────────────────────────────────────────
 *
 * The kind chips wear the warm "you are here" pill when applied. There is no
 * filled button anywhere in this component: nothing here does anything, it is
 * a record of things that already happened.
 *
 * ── WHAT IS NOT IN IT ─────────────────────────────────────────────────────
 *
 * Content edits, media uploads and announcements are absent. The outbox
 * records the first two platform-wide but has no owner column, so filtering it
 * per organizer would mean scanning every event on the platform; announcements
 * are a platform surface with no organizer scope at all. Both are named in
 * BACKLOG "Owner-scoped activity log" rather than approximated.
 */

const ICON: Record<ActivityKind, LucideIcon> = {
  booking: Receipt,
  refund: Undo2,
  checkin: QrCode,
  payout: Wallet,
  publishing: Send,
};

const SEVERITY: Record<ActivitySeverity, string> = {
  info: 'bg-muted text-muted-foreground',
  success: 'bg-success-subtle text-success-subtle-foreground',
  warning: 'bg-warning-subtle text-warning-subtle-foreground',
  critical: 'bg-destructive-subtle text-destructive-subtle-foreground',
};

export function ActivityFeed({ limit = 20 }: { limit?: number }) {
  const query = useFeed(limit);
  const entries = query.data?.data ?? [];

  if (query.isError) {
    return (
      <ErrorState
        message="Could not load activity."
        onRetry={() => void query.refetch()}
        className="rounded-xl border border-border bg-surface"
      />
    );
  }

  if (query.isPending) {
    return (
      <ul className="flex flex-col gap-2" aria-busy>
        {Array.from({ length: 4 }, (_, index) => (
          <li key={index} className="flex gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5 py-0.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <EmptyState
          icon={Activity}
          title="Nothing has happened yet"
          body="Bookings, refunds, gate scans and payouts appear here in the order they occur, newest first."
        />
      </div>
    );
  }

  return (
    <ol className="flex flex-col">
      {entries.map((entry, index) => (
        <li key={entry.id}>
          <FeedRow entry={entry} last={index === entries.length - 1} />
        </li>
      ))}
    </ol>
  );
}

function FeedRow({ entry, last }: { entry: FeedEntry; last: boolean }) {
  const Icon = ICON[entry.kind] ?? Activity;

  return (
    <Link
      href={`/dashboard/events?event=${entry.event_id}`}
      className="group flex gap-3 rounded-lg px-2 py-1.5 transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
    >
      <span className="flex flex-col items-center" aria-hidden>
        <span
          className={cn(
            'inline-flex size-8 shrink-0 items-center justify-center rounded-full',
            SEVERITY[entry.severity],
          )}
        >
          <Icon className="size-3.5" />
        </span>
        {/* The connector, not drawn under the last row — a line trailing into
            nothing reads as a truncated list. */}
        {last ? null : <span className="w-px flex-1 bg-border" />}
      </span>

      <span className={cn('flex min-w-0 flex-1 flex-col', last ? 'pb-1' : 'pb-4')}>
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-body-sm font-medium text-foreground">{entry.title}</span>
          {/* Money reads as a figure, in the foreground ink and in tabular
              digits — it was set in the same muted grey as the timestamp, which
              is the one number on the row nobody needs to read precisely. */}
          {entry.amount_minor > 0 ? (
            <span className="text-body-sm tabular-nums text-foreground">
              {formatMoney(entry.amount_minor)}
            </span>
          ) : null}
        </span>

        <span className="truncate text-caption text-muted-foreground">{entry.event_title}</span>

        {entry.detail ? (
          <span
            className={cn(
              'truncate text-caption',
              entry.severity === 'critical'
                ? 'text-destructive-subtle-foreground'
                : 'text-muted-foreground',
            )}
          >
            {entry.detail}
          </span>
        ) : null}

        <RelativeTime at={entry.at} />
      </span>
    </Link>
  );
}

/**
 * "3m ago", re-rendered on a timer.
 *
 * Rendered as `null` until mounted, then filled in. The server and the client
 * are never in the same minute, and a server-rendered "2m ago" that hydrates
 * to "3m ago" is a hydration mismatch — which React resolves by throwing away
 * the server HTML for this subtree.
 */
function RelativeTime({ at }: { at: string }) {
  const [, tick] = React.useReducer((count: number) => count + 1, 0);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const stamp = new Date(at);
  return (
    <time
      dateTime={at}
      title={stamp.toLocaleString('en-IN')}
      className="text-caption tabular-nums text-muted-foreground"
    >
      {mounted ? relative(stamp) : ' '}
    </time>
  );
}

function relative(when: Date): string {
  const seconds = Math.round((Date.now() - when.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** The severity-filtered variant used by the standalone Activity Centre. */
export function ActivityCentre() {
  const [kind, setKind] = React.useState<ActivityKind | ''>('');
  const query = useFeed(50);
  const all = query.data?.data ?? [];
  const entries = kind ? all.filter((entry) => entry.kind === kind) : all;

  const kinds: { value: ActivityKind | ''; label: string }[] = [
    { value: '', label: 'Everything' },
    { value: 'booking', label: 'Bookings' },
    { value: 'refund', label: 'Refunds' },
    { value: 'checkin', label: 'Check-ins' },
    { value: 'payout', label: 'Payouts' },
    { value: 'publishing', label: 'Publishing' },
  ];

  return (
    <div className="flex flex-col gap-stack-lg">
      {/* Filtering happens over the loaded page, and the count says so — the
          endpoint takes a limit, not a kind. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {kinds.map((option) => {
          const active = kind === option.value;
          const count = option.value
            ? all.filter((entry) => entry.kind === option.value).length
            : all.length;
          return (
            <Button
              key={option.value || 'all'}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setKind(option.value)}
              aria-pressed={active}
              className={cn(
                'gap-1.5 px-3',
                // The applied filter is the warm "you are here" pill, the same
                // shape the sidebar uses for the page you are on.
                active
                  ? 'border-transparent bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
              {/* Inherits the pill's ink when applied and drops to tertiary ink
                  when not — never an opacity, which produces a ratio that
                  changes with whatever is behind it. */}
              <span className={cn('tabular-nums', !active && 'text-foreground-subtle')}>
                {count}
              </span>
            </Button>
          );
        })}
      </div>

      {entries.length === 0 && !query.isPending && !query.isError ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            icon={Activity}
            title={kind ? 'Nothing of that kind recently' : 'Nothing has happened yet'}
            body={
              kind
                ? 'The timeline holds the 50 most recent entries across every kind; there are none of these in that window.'
                : 'Bookings, refunds, gate scans and payouts appear here as they occur.'
            }
          />
        </div>
      ) : (
        <FilteredList entries={entries} query={query} />
      )}
    </div>
  );
}

function FilteredList({
  entries,
  query,
}: {
  entries: FeedEntry[];
  query: ReturnType<typeof useFeed>;
}) {
  if (query.isError) {
    return (
      <ErrorState
        message="Could not load activity."
        onRetry={() => void query.refetch()}
        className="rounded-xl border border-border bg-surface"
      />
    );
  }
  if (query.isPending) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }
  return (
    <ol className="flex flex-col">
      {entries.map((entry, index) => (
        <li key={entry.id}>
          <FeedRow entry={entry} last={index === entries.length - 1} />
        </li>
      ))}
    </ol>
  );
}
