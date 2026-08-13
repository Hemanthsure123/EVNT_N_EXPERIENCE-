'use client';

import * as React from 'react';
import Link from 'next/link';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { useEventRows, useReviews } from '@/lib/organizer/queries';
import { ErrorState, Panel, Skeleton } from './primitives';
import { TableToolbar } from './data-table';
import { SelectFilter } from './filters';

/**
 * What people said about the organizer's events.
 *
 * ── THE AVERAGE IS COMPUTED FROM WHAT IS LOADED, AND SAYS SO ──────────────
 *
 * The API is cursor-paginated with no aggregate, so a rating average here can
 * only describe the reviews currently on screen. Presenting that as "your
 * rating" would be the invented number this codebase refuses elsewhere — a
 * figure that changes as you scroll, from an endpoint that never claimed it.
 * So it is labelled as covering the loaded rows, exactly like the events
 * table's "24+ events" floors.
 *
 * ── NO REPLY CONTROL ──────────────────────────────────────────────────────
 *
 * There is no reply, dispute or takedown model in the backend. A button that
 * silently does nothing is worse than its absence, so this screen reads.
 */
export function Reviews() {
  const [eventId, setEventId] = React.useState('');
  const query = useReviews(eventId);
  const eventsQuery = useEventRows({});

  const events = React.useMemo(
    () => eventsQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [eventsQuery.data],
  );
  const rows = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );

  const average = rows.length
    ? rows.reduce((sum, row) => sum + row.rating, 0) / rows.length
    : null;

  return (
    <div className="flex flex-col gap-block">
      <TableToolbar>
        <SelectFilter
          value={eventId}
          onChange={setEventId}
          options={[
            { value: '', label: 'All events' },
            ...events.map((event) => ({ value: event.id, label: event.title })),
          ]}
          label="Filter by event"
        />

        {average !== null ? (
          <div className="ml-auto flex items-baseline gap-2">
            <Stars value={Math.round(average)} />
            <span className="tabular-nums text-body-sm text-foreground">{average.toFixed(1)}</span>
            <span className="text-caption text-muted-foreground">
              across {rows.length} loaded
            </span>
          </div>
        ) : null}
      </TableToolbar>

      <Panel title="Reviews" className="overflow-hidden">
        {query.isError ? (
          <ErrorState
            message="Could not load your reviews."
            onRetry={() => void query.refetch()}
          />
        ) : query.isPending ? (
          <div className="flex flex-col gap-2 p-card">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-20 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="p-card text-body-sm text-muted-foreground">
            {eventId
              ? 'No reviews for that event yet.'
              : 'No reviews yet. They appear once an attendee rates an event they went to.'}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-1.5 p-card">
                <div className="flex flex-wrap items-center gap-2">
                  <Stars value={row.rating} />
                  <span className="text-body-sm font-medium text-foreground">
                    {row.reviewer_name}
                  </span>
                  {row.verified_attendee ? (
                    // Frozen at write time from the ticket, so it is a fact
                    // about this review rather than a live lookup — and it is
                    // the one signal that separates a review from an opinion.
                    <span className="rounded-full bg-success-subtle px-2 py-0.5 text-caption text-success-subtle-foreground">
                      Attended
                    </span>
                  ) : null}
                  <time
                    dateTime={row.created_at}
                    className="ml-auto text-caption text-muted-foreground"
                  >
                    {new Date(row.created_at).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </time>
                </div>

                {row.body ? (
                  <p className="text-body-sm text-foreground">{row.body}</p>
                ) : (
                  <p className="text-body-sm italic text-muted-foreground">
                    Rated without a comment.
                  </p>
                )}

                <Link
                  href={`/dashboard/events?event=${row.event_id}`}
                  className="text-caption text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {row.event_title}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {query.hasNextPage ? (
          <div className="flex justify-center border-t border-border py-4">
            <Button
              variant="outline"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((position) => (
        <Star
          key={position}
          aria-hidden
          className={cn(
            'size-3.5',
            position <= value ? 'fill-warning text-warning' : 'text-border',
          )}
        />
      ))}
    </span>
  );
}
