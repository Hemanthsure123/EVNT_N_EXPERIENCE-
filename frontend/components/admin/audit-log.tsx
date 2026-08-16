'use client';

import * as React from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { fetchAuditLog, type AuditEntry } from '@/lib/api/admin';
import { cursorFromNextLink } from '@/lib/api/events';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, Panel, Skeleton } from '@/components/organizer/primitives';
import { cn } from '@/lib/utils/cn';

/**
 * The audit log: who did what.
 *
 * Distinct from the activity feed, which reads the OUTBOX. The outbox records
 * what the domain did ("a booking was confirmed"); this records what a person
 * did ("an operator approved this event"). Merging them would make the second
 * — the one that matters in a dispute — impossible to find among the first.
 *
 * Append-only by construction: `core.record_audit` only ever inserts, and
 * there is no write endpoint here. The filters are prefixes over the action
 * name, which is why actions are namespaced (`event.approved`,
 * `organization.verification_decided`) rather than free text.
 *
 * ── THE ROWS STAY TIGHT ───────────────────────────────────────────────────
 *
 * This is the one screen in the console read as a STREAM rather than searched
 * as a table: an operator scans down it asking "what happened, and did anyone
 * do something unexpected". So the rows keep their compact vertical rhythm
 * rather than taking card padding — the more of the trail that fits on one
 * screen the fewer scrolls it takes to answer that, and there is no per-row
 * action here whose target size the padding would have to protect.
 */

const FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Everything' },
  { value: 'event.', label: 'Events' },
  { value: 'organization.', label: 'Organisations' },
];

/** Verbs, so a row reads as a sentence rather than as a key. */
const ACTIONS: Record<string, string> = {
  'event.submitted_for_review': 'submitted an event for review',
  'event.approved': 'approved an event',
  'event.rejected': 'sent an event back for changes',
  'event.unpublished': 'took an event off sale',
  'event.published': 'published an event',
  'event.created': 'created an event',
  'event.updated': 'edited an event',
};

/**
 * The filter pill. Butter (`--nav-active`) when applied — the console's one
 * "you are here" fill, shared with the sidebar and every other filter row.
 * 44px on a phone, 36px from `sm` up.
 */
const tabClass = (active: boolean) =>
  cn(
    'inline-flex h-control items-center rounded-full border px-pill text-label sm:h-control-sm',
    'transition-colors duration-fast motion-reduce:transition-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? 'border-transparent bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
  );

export function AuditLog() {
  const [action, setAction] = React.useState('');

  const query = useInfiniteQuery({
    queryKey: ['admin', 'audit', action],
    queryFn: ({ pageParam }) =>
      fetchAuditLog({ action: action || undefined, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    staleTime: 0,
  });

  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="flex flex-col gap-stack">
      <div role="tablist" aria-label="Filter the audit log" className="flex flex-wrap gap-1.5">
        {FILTERS.map((filter) => (
          <button
            key={filter.value || 'all'}
            role="tab"
            type="button"
            aria-selected={action === filter.value}
            onClick={() => setAction(filter.value)}
            className={tabClass(action === filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <Panel title="Audit log" subtitle="Every administrative action. Append-only.">
        {query.isError ? (
          <ErrorState
            message="Could not load the audit log."
            onRetry={() => void query.refetch()}
          />
        ) : query.isPending ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={History}
            title="Nothing recorded yet"
            body="Approvals, rejections and verification decisions appear here the moment they happen."
          />
        ) : (
          <ol className="divide-y divide-border">
            {rows.map((entry) => (
              <Row key={entry.id} entry={entry} />
            ))}
          </ol>
        )}

        {query.hasNextPage ? (
          <div className="border-t border-border p-3 text-center">
            <Button
              variant="outline"
              onClick={() => void query.fetchNextPage()}
              loading={query.isFetchingNextPage}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

/**
 * Did this actor id ever name a user account?
 *
 * `User.id` is a UUID. `AuditLog.actor_id` is a free string so the trail can
 * survive the account being deleted — which also means it holds non-user
 * actors like `system`. Only the UUID-shaped ones can have been a person.
 */
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUserId = (actorId: string) => USER_ID.test(actorId.trim());


function Row({ entry }: { entry: AuditEntry }) {
  const note = typeof entry.metadata?.note === 'string' ? entry.metadata.note : '';
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-2.5 transition-colors duration-fast hover:bg-sunken motion-reduce:transition-none">
      <span className="text-body-sm font-medium text-foreground">
        {/* ── A NON-UUID ACTOR IS THE PLATFORM, NOT A DELETED PERSON ──────
            This read `actor_id ? 'a deleted account' : 'the system'`, so
            anything with a non-empty actor that did not resolve to an email
            was reported as a deleted account. System actors are non-empty —
            they are words like `system` — so the sweeper expiring a hold and
            the webhook confirming a payment were both attributed to somebody
            who had closed their account. On the one screen whose job is
            saying who did what, that is the worst possible error.

            The trail stores `actor_id` as a plain string precisely so it
            outlives the account. A UUID that no longer resolves IS a deleted
            person; anything that was never a user id never was one. */}
        {entry.actor_email || (isUserId(entry.actor_id) ? 'a deleted account' : 'the platform')}
      </span>
      <span className="text-body-sm text-muted-foreground">
        {ACTIONS[entry.action] ?? entry.action.replace(/[._]/g, ' ')}
      </span>
      <time
        dateTime={entry.created_at}
        className="ml-auto shrink-0 text-caption tabular-nums text-muted-foreground"
      >
        {new Date(entry.created_at).toLocaleString('en-IN', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </time>
      {note ? <p className="w-full text-caption text-muted-foreground">“{note}”</p> : null}
      {entry.target_id ? (
        <p className="w-full truncate font-mono text-caption text-muted-foreground">
          {entry.target_type}:{entry.target_id}
        </p>
      ) : null}
    </li>
  );
}
