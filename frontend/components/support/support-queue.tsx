'use client';

import * as React from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquare } from 'lucide-react';
import { cursorFromNextLink } from '@/lib/api/events';
import {
  SUPPORT_STATUS_LABELS,
  fetchAdminSupportQueries,
  fetchOrganizerSupportQueries,
  fetchSupportQuery,
  replyToSupportQuery,
  setSupportQueryStatus,
  type SupportQuery,
  type SupportStatus,
} from '@/lib/api/support';
import { EmptyState, ErrorState, Skeleton, StatusPill } from '@/components/organizer/primitives';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils/cn';

/**
 * ── THE SUPPORT QUEUE ─────────────────────────────────────────────────────
 *
 * Used by BOTH the organizer (`/dashboard/support`) and the operator console
 * (`/admin/support`) — one component, because it is the same row, the same
 * reply and the same rule. Two copies is how the operator's view ends up more
 * permissive than the organizer's, which on a surface that shows customers'
 * own words about their payments is the wrong direction to drift.
 *
 * The `scope` prop changes only WHICH list is fetched. The server decides what
 * each caller may see; this component never filters for permission, because a
 * client-side permission filter is a disclosure with a stylesheet in front of
 * it.
 *
 * ── CARDS, NOT A TABLE ────────────────────────────────────────────────────
 *
 * Same reasoning as the refund queue beside it: a table is for scanning many
 * rows to find one, and this is for READING one properly before answering it.
 * The customer's own words are the substance and they do not fit in a cell.
 *
 * ── OPEN FIRST, BECAUSE THAT IS THE WORK ──────────────────────────────────
 *
 * The default filter is `open`. "Replied" means somebody is waiting on the
 * CUSTOMER, and a queue that opens on everything buries the four things that
 * need doing under forty that do not.
 */

const FILTERS: { value: SupportStatus | 'all'; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'answered', label: 'Replied' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

export function SupportQueue({ scope }: { scope: 'organizer' | 'admin' }) {
  const [filter, setFilter] = React.useState<SupportStatus | 'all'>('open');

  const query = useInfiniteQuery({
    queryKey: ['support', 'queue', scope, filter],
    queryFn: ({ pageParam }) => {
      const params = {
        status: filter === 'all' ? undefined : filter,
        cursor: (pageParam as string | undefined) ?? undefined,
      };
      return scope === 'admin'
        ? fetchAdminSupportQueries(params)
        : fetchOrganizerSupportQueries(params);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
  });

  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="flex flex-col gap-block">
      <div role="tablist" aria-label="Filter queries" className="flex flex-wrap gap-2">
        {FILTERS.map((entry) => (
          <button
            key={entry.value}
            role="tab"
            type="button"
            aria-selected={filter === entry.value}
            onClick={() => setFilter(entry.value)}
            className={cn(
              'inline-flex h-control items-center rounded-full border px-4 text-label transition-colors duration-fast',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              filter === entry.value
                ? 'border-transparent bg-nav-active text-nav-active-foreground'
                : 'border-border bg-surface text-muted-foreground hover:text-foreground',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {query.isPending ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : query.isError ? (
        <ErrorState message="Could not load the queue." onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            icon={MessageSquare}
            title="Nothing here"
            body={
              filter === 'open'
                ? 'No queries are waiting on a reply.'
                : 'No queries in this view.'
            }
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((row) => (
            <li key={row.id}>
              <QueryCard query={row} scope={scope} filter={filter} />
            </li>
          ))}
        </ul>
      )}

      {query.hasNextPage ? (
        <button
          type="button"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className="mx-auto inline-flex h-control items-center gap-2 rounded-full border border-border bg-surface px-pill text-label disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {query.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Load more
        </button>
      ) : null}
    </div>
  );
}

function QueryCard({
  query,
  scope,
  filter,
}: {
  query: SupportQuery;
  scope: 'organizer' | 'admin';
  filter: SupportStatus | 'all';
}) {
  const client = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [reply, setReply] = React.useState('');
  const state = SUPPORT_STATUS_LABELS[query.status];

  // Fetched only when somebody opens the card. A queue of twenty with every
  // message on every one of them is a payload that grows without bound and a
  // page nobody asked to read.
  const thread = useQuery({
    queryKey: ['support', 'thread', query.id],
    queryFn: () => fetchSupportQuery(query.id),
    enabled: open,
  });

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ['support', 'queue', scope, filter] });
    void client.invalidateQueries({ queryKey: ['support', 'thread', query.id] });
  };

  const send = useMutation({
    mutationFn: () => replyToSupportQuery(query.id, reply),
    onSuccess: () => {
      setReply('');
      invalidate();
    },
  });

  const resolve = useMutation({
    mutationFn: () => setSupportQueryStatus(query.id, 'resolved'),
    onSuccess: invalidate,
  });

  return (
    <article className="flex flex-col gap-stack rounded-xl border border-border bg-surface p-card shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-body-lg font-semibold text-foreground">{query.subject}</h3>
          <p className="text-caption text-muted-foreground">
            {query.asked_by_name || query.asked_by_email}
            {query.event_title ? ` · ${query.event_title}` : ''}
          </p>
        </div>
        <StatusPill tone={state.tone}>{state.label}</StatusPill>
      </header>

      {/* The customer's own words, in full. Truncating the reason and then
          asking somebody to answer it is how a queue gets worked without
          being read. */}
      <p className="whitespace-pre-wrap text-body-sm text-foreground">{query.body}</p>

      {open ? (
        thread.isPending ? (
          <Skeleton className="h-16 w-full rounded-lg" />
        ) : thread.data?.replies.length ? (
          <ol className="flex flex-col gap-2 border-t border-border pt-stack">
            {thread.data.replies.map((entry) => (
              <li key={entry.id} className="rounded-lg bg-sunken p-3">
                <p className="flex items-baseline justify-between gap-3 text-caption">
                  <span className="font-medium text-foreground">
                    {entry.is_staff_reply ? entry.author_name : query.asked_by_name}
                  </span>
                  <time className="text-foreground-subtle" dateTime={entry.created_at}>
                    {new Date(entry.created_at).toLocaleString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </time>
                </p>
                <p className="whitespace-pre-wrap text-body-sm text-foreground">{entry.body}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="border-t border-border pt-stack text-caption text-muted-foreground">
            No replies yet.
          </p>
        )
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-stack">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="inline-flex h-control items-center rounded-full border border-border bg-surface px-pill text-label transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? 'Hide thread' : 'Open thread'}
        </button>
        {query.status !== 'resolved' && query.status !== 'closed' ? (
          <button
            type="button"
            onClick={() => resolve.mutate()}
            disabled={resolve.isPending}
            className="inline-flex h-control items-center rounded-full border border-border bg-surface px-pill text-label transition-colors hover:bg-muted disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Mark resolved
          </button>
        ) : null}
      </div>

      {open && query.status !== 'closed' ? (
        <div className="flex flex-col gap-2">
          <label className="sr-only" htmlFor={`reply-${query.id}`}>
            Reply to {query.subject}
          </label>
          <Textarea
            id={`reply-${query.id}`}
            rows={3}
            value={reply}
            maxLength={4000}
            onChange={(event) => setReply(event.target.value)}
            placeholder="Answer them directly. They get this by email."
          />
          <button
            type="button"
            disabled={reply.trim().length < 2 || send.isPending}
            onClick={() => send.mutate()}
            className="inline-flex h-control w-fit items-center gap-2 rounded-full bg-cta px-pill text-label text-cta-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {send.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Send reply
          </button>
        </div>
      ) : null}
    </article>
  );
}
