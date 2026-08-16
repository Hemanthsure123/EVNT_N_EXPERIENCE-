'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Search, Star, Trash2, X } from 'lucide-react';
import {
  featureEvent,
  fetchAdminFeatured,
  reorderFeatured,
  unfeature,
  type AdminFeatured,
  type CollectionKey,
} from '@/lib/api/cms';
import { fetchEvents } from '@/lib/api/events';
import { ApiError } from '@/lib/api/errors';
import { useDebouncedValue } from '@/lib/utils/use-debounced-value';
import {
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
  StatusPill,
} from '@/components/organizer/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';

/**
 * Curation: which approved events appear on the homepage, and in what order.
 *
 * ── THE EVENT PICKER USES THE PUBLIC SEARCH, ON PURPOSE ───────────────────
 *
 * `GET /events` returns exactly the set that is eligible to be featured —
 * approved, upcoming, publicly visible. Building an admin-only event search
 * would have meant a second endpoint that could drift out of step with the
 * rule, and the first symptom would be an operator pinning something the
 * homepage then refuses to show. Reusing the public index makes "what you can
 * pick" and "what will render" the same query by construction.
 *
 * ── ORDER IS EDITED, THEN COMMITTED ───────────────────────────────────────
 *
 * Position changes go through one `reorder` call rather than one PATCH per
 * row: a half-applied reorder leaves two cards claiming the same slot, which
 * the read path then resolves arbitrarily. The backend wraps the whole list in
 * a transaction for the same reason.
 *
 * ── SCHEDULING IS OPTIONAL AND EXPLAINED ──────────────────────────────────
 *
 * Leaving both dates blank means "live now, until removed" — which is what an
 * operator wants nine times out of ten, so it is the default rather than
 * something to dismiss.
 *
 * ── THE COLLECTION TABS ARE A "YOU ARE HERE", NOT AN ACTION ───────────────
 *
 * The selected rail is the warm `--nav-active` pill, the same mark the console
 * uses for the nav item you are on and for an applied filter. It used to be a
 * violet-edged `--secondary` chip, which read as five buttons of which one was
 * pressed — a filter and a call to action wearing the same clothes is how an
 * operator ends up clicking the tab they are already on.
 */

const COLLECTIONS: { value: CollectionKey; label: string; hint: string }[] = [
  { value: 'featured', label: 'Featured', hint: 'The main homepage rail' },
  { value: 'trending', label: 'Trending', hint: 'Secondary rail' },
  { value: 'editors_pick', label: "Editor's pick", hint: 'Hand-picked' },
  { value: 'recommended', label: 'Recommended', hint: 'Suggested' },
  { value: 'new', label: 'New', hint: 'Just added' },
];

export function FeaturedManager() {
  const client = useQueryClient();
  const [collection, setCollection] = React.useState<CollectionKey>('featured');
  const [error, setError] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'featured'],
    queryFn: fetchAdminFeatured,
    staleTime: 0,
  });

  const refresh = () => void client.invalidateQueries({ queryKey: ['admin'] });

  const add = useMutation({
    mutationFn: (eventId: string) => featureEvent({ event_id: eventId, collection }),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (thrown) =>
      setError(
        thrown instanceof ApiError ? thrown.message : 'Could not add that event to the rail.',
      ),
  });
  const remove = useMutation({ mutationFn: unfeature, onSuccess: refresh });
  const reorder = useMutation({ mutationFn: reorderFeatured, onSuccess: refresh });

  const rows = (query.data?.data ?? []).filter((row) => row.collection === collection);

  return (
    <Panel title="Featured events" subtitle="What appears on the homepage, and in what order">
      <div className="flex flex-col gap-block p-card">
        <div role="tablist" aria-label="Collection" className="flex flex-wrap gap-1.5">
          {COLLECTIONS.map((entry) => {
            const count = (query.data?.data ?? []).filter(
              (row) => row.collection === entry.value,
            ).length;
            const selected = collection === entry.value;
            return (
              <button
                key={entry.value}
                role="tab"
                type="button"
                aria-selected={selected}
                title={entry.hint}
                onClick={() => setCollection(entry.value)}
                className={cn(
                  'inline-flex h-control-sm items-center gap-1.5 rounded-full border px-pill text-label transition-colors duration-fast',
                  'motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected
                    ? 'border-nav-active bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
                    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {entry.label}
                {count > 0 ? (
                  <span
                    className={cn(
                      'tabular-nums',
                      selected ? 'text-nav-active-foreground' : 'text-foreground-subtle',
                    )}
                  >
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive-subtle bg-destructive-subtle px-card py-2 text-body-sm text-destructive-subtle-foreground"
          >
            {error}
          </p>
        ) : null}

        <EventPicker onPick={(id) => add.mutate(id)} busy={add.isPending} />

        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} className="px-0" />
        ) : query.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Star}
            title={`Nothing in ${COLLECTIONS.find((c) => c.value === collection)?.label}`}
            body="Search above and add an event. Only approved, upcoming events can be featured."
          />
        ) : (
          <ol className="flex flex-col divide-y divide-border rounded-xl border border-border">
            {rows.map((row, index) => (
              <FeaturedRow
                key={row.id}
                row={row}
                index={index}
                total={rows.length}
                onMove={(direction) => {
                  const next = [...rows];
                  const target = index + direction;
                  if (target < 0 || target >= next.length) return;
                  [next[index], next[target]] = [next[target], next[index]];
                  reorder.mutate(next.map((entry, position) => ({ id: entry.id, position })));
                }}
                onRemove={() => remove.mutate(row.id)}
                busy={remove.isPending || reorder.isPending}
              />
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}

function FeaturedRow({
  row,
  index,
  total,
  onMove,
  onRemove,
  busy,
}: {
  row: AdminFeatured;
  index: number;
  total: number;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const scheduled = row.starts_at || row.ends_at;
  const live = row.event_status === 'live';

  return (
    <li
      className={cn('flex flex-wrap items-center gap-stack px-card py-2', busy && 'opacity-60')}
      aria-busy={busy || undefined}
    >
      <span className="w-6 shrink-0 text-right text-caption tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm font-medium text-foreground">
          {row.event_title}
        </span>
        <span className="block truncate text-caption text-muted-foreground">
          {new Date(row.event_starts_at).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
          {row.city ? ` · ${row.city} only` : ''}
          {scheduled
            ? ` · ${row.starts_at ? `from ${new Date(row.starts_at).toLocaleDateString('en-IN')}` : ''}${
                row.ends_at ? ` until ${new Date(row.ends_at).toLocaleDateString('en-IN')}` : ''
              }`
            : ''}
        </span>
      </span>

      {/* A pinned event that is no longer live still shows here, and says so
          — the homepage already hides it, but an operator needs to know why
          their rail looks short. */}
      {!live ? <StatusPill tone="warning">Hidden — {row.event_status}</StatusPill> : null}

      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onMove(-1)}
          disabled={index === 0 || busy}
          aria-label={`Move ${row.event_title} up`}
          title={`Move ${row.event_title} up`}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowUp className="size-4" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onMove(1)}
          disabled={index === total - 1 || busy}
          aria-label={`Move ${row.event_title} down`}
          title={`Move ${row.event_title} down`}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowDown className="size-4" aria-hidden />
        </Button>

        {/* Reordering is reversible; pulling a card off the homepage is the
            one thing here that is not. It gets its own side of the rule. */}
        <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={busy}
          aria-label={`Remove ${row.event_title} from this rail`}
          title={`Remove ${row.event_title} from this rail`}
          className="text-muted-foreground hover:bg-destructive-subtle hover:text-destructive-subtle-foreground"
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </span>
    </li>
  );
}

/** Searches the PUBLIC index — the same set that is eligible to be featured. */
function EventPicker({ onPick, busy }: { onPick: (eventId: string) => void; busy: boolean }) {
  const [term, setTerm] = React.useState('');
  const debounced = useDebouncedValue(term.trim(), 250);

  // ── BROWSE FIRST, TYPE TO NARROW ────────────────────────────────────────
  //
  // This was `enabled: debounced.length >= 2`, so the panel showed NOTHING
  // until two characters were typed. An operator curating a front page is
  // usually choosing from what is on sale, not recalling a title they already
  // know — and the console's other event chooser (Event analytics) opens with
  // the list, so the same job behaved two different ways in one product.
  //
  // The query now always runs and the term simply narrows it.
  const query = useQuery({
    queryKey: ['admin', 'event-search', debounced],
    queryFn: () => fetchEvents(debounced ? { q: debounced } : {}),
    staleTime: 30_000,
  });

  const results = query.data?.data ?? [];

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        {/* Violet's sanctioned job: a leading icon. The one accent on the
            screen, and it marks the control an operator starts from. */}
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary"
          aria-hidden
        />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Filter by title, venue or city"
          aria-label="Search events to feature"
          className="pl-9 pr-control text-body-sm"
        />
        {term ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setTerm('')}
            aria-label="Clear search"
            className="absolute right-0 top-1/2 -translate-y-1/2 text-muted-foreground hover:bg-transparent hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </Button>
        ) : null}
      </div>

      {query.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : results.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          {debounced
            ? `Nothing approved matches “${debounced}”. Only live, upcoming events can be featured.`
            : 'No approved, upcoming events yet. Only those can be featured.'}
        </p>
      ) : (
          <ul className="flex max-h-48 flex-col divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {/* The list scrolls (`max-h-48`), so a browse-first panel can show
                more than a search's shortlist without taking the page over. */}
            {results.slice(0, 25).map((event) => (
              <li key={event.id} className="flex items-center gap-stack px-card py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm text-foreground">{event.title}</span>
                  <span className="block truncate text-caption text-muted-foreground">
                    {event.city} ·{' '}
                    {new Date(event.starts_at).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  loading={busy}
                  onClick={() => onPick(event.id)}
                  leftIcon={<Plus className="size-4" aria-hidden />}
                  className="shrink-0"
                >
                  Add
                </Button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
