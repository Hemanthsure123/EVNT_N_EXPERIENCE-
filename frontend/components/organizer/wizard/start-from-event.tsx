'use client';

import * as React from 'react';
import { CopyPlus, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/discovery/format';
import type { EventRow } from '@/lib/api/organizer';
import { useEventRows } from '@/lib/organizer/queries';
import { CLONE_HINT, describeClone, useCloneEvent } from '@/lib/organizer/clone';
import { cn } from '@/lib/utils/cn';
import { Poster } from '../primitives';

/**
 * "Running this again?" — starting a new event from one that already exists.
 *
 * ── WHY THIS IS ON THE CREATE SCREEN AND NOT ONLY IN THE EVENTS TABLE ─────
 *
 * Duplicate lived in two places, and both of them were on the events LIST:
 * the bulk bar and the row side panel. Both require an organizer to already
 * be thinking "copy" — but somebody running the same night monthly does not
 * arrive thinking that. They arrive thinking "new event", press the one filled
 * button on the dashboard, and land on an empty eight-step form with a blank
 * title. Every field they are about to retype already exists on last month's
 * row, one screen away, and nothing on the screen they are looking at says so.
 *
 * So the offer is made where the cost is about to be paid. It is the second
 * thing on the page, above the title field, and it disappears the moment the
 * draft stops being empty — an organizer who has started typing has answered
 * the question, and a panel that stayed would be a permanent invitation to
 * throw away the work in progress.
 *
 * ── IT IS NOT A PREFILL, IT IS A SERVER COPY ──────────────────────────────
 *
 * Pressing Copy navigates to `/dashboard/events/new?from={id}` and the wizard
 * fills a NEW draft from that event. It writes NOTHING until the organizer
 * saves.
 *
 * THIS PARAGRAPH USED TO ARGUE THE OPPOSITE, and the argument was correct when
 * it was written: the collections that make a copy worth having — tiers and
 * their sale phases, sessions, FAQs, the running order, the lineup — live in
 * their own tables, and a client prefill could carry only the scalar columns
 * the draft model held, silently dropping all of them. That was true until
 * those collections became STAGED draft state, flushed on first save exactly
 * as tiers always were. They all come across now, and the server-side copy
 * that used to justify itself this way was creating a "Copy of ..." row on
 * every press — see `lib/organizer/clone.ts`.
 *
 * ── WHAT IS LISTED ────────────────────────────────────────────────────────
 *
 * The organizer's own events, newest first, ALL statuses. A past finished
 * event is the single most likely thing to copy (it is the residency that just
 * happened), a draft is the second (a half-built event somebody wants two
 * of), and filtering either out would hide the main use case. The search box
 * is the same server-side `q` the events table uses, so a promoter with three
 * hundred events is not scrolling.
 */

/** How many rows to show before asking the organizer to search. */
const VISIBLE = 4;

export function StartFromEvent({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false);

  /**
   * The panel is a SEPARATE component, not a branch inside this one, because
   * `useEventRows` has no `enabled` option — mounting it at all issues the
   * request. On the common path (somebody genuinely creating a new event from
   * scratch) this costs zero requests, which is the whole reason the closed
   * state is the default.
   */
  if (!open) {
    return (
      <div
        className={cn(
          'flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border bg-subtle px-4 py-3',
          className,
        )}
      >
        <CopyPlus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="min-w-0 flex-1 text-body-sm text-muted-foreground">
          Running this again? Copy a previous event instead of retyping it.
        </p>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Copy a previous event
        </Button>
      </div>
    );
  }

  return <ClonePanel className={className} onDismiss={() => setOpen(false)} />;
}

function ClonePanel({ className, onDismiss }: { className?: string; onDismiss: () => void }) {
  const [q, setQ] = React.useState('');
  const { clone, cloning } = useCloneEvent();

  const query = useEventRows({ q: q || undefined });
  const rows: EventRow[] = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );

  return (
    <section
      aria-label="Copy a previous event"
      className={cn('flex flex-col gap-stack rounded-lg border border-border bg-subtle p-4', className)}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-body-sm font-semibold">Copy a previous event</h3>
          <p className="text-caption text-muted-foreground">{describeClone()}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Start from scratch
        </Button>
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search your events"
          aria-label="Search your events"
          className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {query.isPending ? (
        <p className="text-body-sm text-muted-foreground">Loading your events…</p>
      ) : query.isError ? (
        <p className="text-body-sm text-destructive">
          Could not load your events.{' '}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Try again
          </button>
        </p>
      ) : rows.length === 0 ? (
        /* Absent, not empty: an account with no events has nothing to copy,
           and the honest answer is to say so and get out of the way rather
           than render a search box over a permanent void. */
        <p className="text-body-sm text-muted-foreground">
          {q
            ? `No events match “${q}”.`
            : 'You have no events to copy yet — this is your first one.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.slice(0, VISIBLE).map((row) => (
            <li key={row.id}>
              <button
                type="button"
                disabled={cloning}
                onClick={() => void clone(row.id)}
                title={CLONE_HINT}
                className="flex w-full items-center gap-3 rounded-md border border-border bg-background p-2 text-left transition hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <Poster url={row.poster_url} alt="" className="size-10 shrink-0 rounded" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-medium">{row.title}</span>
                  <span className="block truncate text-caption text-muted-foreground">
                    {row.venue}, {row.city} ·{' '}
                    {new Date(row.starts_at).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                    {row.revenue_minor ? ` · ${formatMoney(row.revenue_minor)}` : ''}
                  </span>
                </span>
                {cloning ? (
                  <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                ) : (
                  <CopyPlus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {rows.length > VISIBLE ? (
        <p className="text-caption text-muted-foreground">
          Showing {VISIBLE} of your most recent. Search to narrow it down.
        </p>
      ) : null}
    </section>
  );
}
