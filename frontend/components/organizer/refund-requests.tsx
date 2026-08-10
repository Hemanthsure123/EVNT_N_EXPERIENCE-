'use client';

import * as React from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock } from 'lucide-react';
import {
  REFUND_REQUEST_LABELS,
  decideRefundRequest,
  fetchAdminRefundRequests,
  fetchOrganizerRefundRequests,
  type RefundRequest,
  type RefundRequestStatus,
} from '@/lib/api/refund-requests';
import { cursorFromNextLink } from '@/lib/api/events';
import { formatMoney } from '@/lib/discovery/format';
import { SpotRefund } from '@/components/illustrations/spots';
import { EmptyState, ErrorState, StatusPill } from '@/components/organizer/primitives';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils/cn';

/**
 * ── THE REFUND REQUEST QUEUE ──────────────────────────────────────────────
 *
 * The decision surface for the money path's one human step. Used by BOTH the
 * organizer (`/dashboard/refunds`) and the operator console
 * (`/admin/refund-requests`) — one component, because it is the same row, the
 * same decision and the same rule, and two copies is how the operator's view
 * ends up more permissive than the organizer's.
 *
 * ── WHY A QUEUE OF CARDS AND NOT A TABLE ──────────────────────────────────
 *
 * Every other list in this console is a table, and this one deliberately is
 * not. A table is for scanning many rows to find one; this is for READING one
 * row properly before deciding it. The customer's own words are the substance
 * of the decision and they do not fit in a cell — truncating somebody's reason
 * to 40 characters and then asking an organizer to refuse them is how a queue
 * gets worked without being read.
 *
 * ── APPROVED IS NOT REFUNDED, AND THE COPY NEVER SAYS IT IS ───────────────
 *
 * Approving ENQUEUES the vendor call. The money arriving is a separate fact
 * the customer is emailed about separately. Every label here comes from
 * `REFUND_REQUEST_LABELS` so the wording cannot drift between this screen, the
 * customer's own list and the emails.
 *
 * `failed` is the state most likely to be forgotten — approved, but the money
 * did not move. It renders as an ALARM, not as a quiet fourth tab.
 *
 * ── A REJECTION CANNOT BE SUBMITTED WITHOUT A REASON ──────────────────────
 *
 * The backend refuses one (`refund_decision_note_required`) because a refusal
 * with no reason is what turns a declined refund into a chargeback. The button
 * is disabled until there is a note rather than letting somebody discover the
 * rule from a 422 — but the server rule is the one that holds.
 *
 * ── AND A 409 IS AN OUTCOME, NOT AN ERROR ─────────────────────────────────
 *
 * Two people work this queue. `refund_request_already_decided` means somebody
 * else got there first, and the loser must be TOLD that rather than left
 * believing they rejected something already approved and refunded.
 */

type Scope = 'organizer' | 'admin';

const TABS: { value: RefundRequestStatus | ''; label: string }[] = [
  { value: 'pending', label: 'Awaiting decision' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Declined' },
  { value: 'failed', label: 'Failed' },
  { value: '', label: 'All' },
];

const tabClass = (active: boolean) =>
  cn(
    'inline-flex h-control items-center rounded-full border px-pill text-label sm:h-control-sm',
    'transition-colors duration-fast motion-reduce:transition-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? 'border-transparent bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
  );

const TONE_TO_PILL: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  pending: 'warning',
  positive: 'success',
  neutral: 'neutral',
  negative: 'danger',
};

export function RefundRequestQueue({ scope = 'organizer' }: { scope?: Scope }) {
  const [status, setStatus] = React.useState<RefundRequestStatus | ''>('pending');
  const client = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: [scope, 'refund-requests', { status }],
    queryFn: ({ pageParam }) =>
      (scope === 'admin' ? fetchAdminRefundRequests : fetchOrganizerRefundRequests)({
        status: status || undefined,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    staleTime: 0,
  });

  const rows = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );

  const onDecided = React.useCallback(() => {
    // Both the list AND anything counting pending requests — an attention
    // panel that still says "3 waiting" after the last one is decided is the
    // thing that sends somebody back to an empty queue.
    void client.invalidateQueries({ queryKey: [scope, 'refund-requests'] });
    void client.invalidateQueries({ queryKey: [scope, 'attention'] });
  }, [client, scope]);

  return (
    <div className="flex flex-col gap-stack-lg">
      <div role="tablist" aria-label="Refund requests by status" className="flex flex-wrap gap-1.5">
        {TABS.map((tab) => (
          <button
            key={tab.value || 'all'}
            role="tab"
            type="button"
            aria-selected={status === tab.value}
            onClick={() => setStatus(tab.value)}
            className={tabClass(status === tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {query.isError ? (
        <ErrorState
          message="Could not load refund requests."
          onRetry={() => void query.refetch()}
        />
      ) : query.isPending ? (
        <QueueSkeleton />
      ) : rows.length === 0 ? (
        status === 'pending' ? (
          // "Nothing waiting" is genuinely good news on this screen, and it
          // deserves to read that way rather than as an absence.
          <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-surface px-card py-14 text-center">
            <SpotRefund className="size-24" />
            <div className="flex max-w-md flex-col gap-1.5">
              <h2 className="text-body font-semibold text-foreground">Nothing waiting on you</h2>
              <p className="text-body-sm text-muted-foreground">
                When a customer asks for a refund it appears here, with what they said, and you
                decide. They are emailed either way.
              </p>
            </div>
          </div>
        ) : (
          <EmptyState title="Nothing here" body="No refund requests with that status." />
        )
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((request) => (
            <li key={request.id}>
              <RequestCard request={request} onDecided={onDecided} />
            </li>
          ))}
        </ul>
      )}

      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void query.fetchNextPage()}
            loading={query.isFetchingNextPage}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function RequestCard({ request, onDecided }: { request: RefundRequest; onDecided: () => void }) {
  const [rejecting, setRejecting] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [conflict, setConflict] = React.useState(false);
  const meta = REFUND_REQUEST_LABELS[request.status];
  const decided = request.status !== 'pending';

  const mutation = useMutation({
    mutationFn: ({ approve }: { approve: boolean }) =>
      decideRefundRequest(request.id, approve, note),
    onSuccess: () => {
      setRejecting(false);
      setNote('');
      onDecided();
    },
    onError: (error: unknown) => {
      // A 409 is not a failure of this click — somebody else decided it first.
      // Surfaced as an explanation rather than a red error, and the list is
      // refreshed so the real state replaces the stale card.
      const code = (error as { code?: string })?.code;
      if (code === 'refund_request_already_decided') {
        setConflict(true);
        onDecided();
      }
    },
  });

  return (
    <article
      className={cn(
        'flex flex-col gap-4 rounded-xl border bg-surface p-card shadow-sm',
        request.status === 'failed' ? 'border-destructive-subtle' : 'border-border',
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="truncate text-body font-semibold text-foreground">
            {request.event_title}
          </h3>
          <p className="truncate text-body-sm text-muted-foreground">
            {request.requested_by_name || request.requested_by_email} ·{' '}
            <span className="tabular-nums">{formatMoney(request.booking_total_minor)}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill tone={TONE_TO_PILL[meta.tone]}>{meta.label}</StatusPill>
          {request.status === 'pending' ? (
            <span className="flex items-center gap-1 text-caption text-foreground-subtle">
              <Clock className="size-3.5" aria-hidden />
              {waitedFor(request.created_at)}
            </span>
          ) : null}
        </div>
      </header>

      {/* The customer's own words, in full and unedited. This is the substance
          of the decision, which is why this is a card and not a table row. */}
      <blockquote className="rounded-lg border-l-2 border-border-strong bg-sunken px-4 py-3 text-body-sm text-foreground">
        {request.reason}
      </blockquote>

      {request.status === 'failed' ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive-subtle bg-destructive-subtle p-3">
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-destructive-subtle-foreground"
            aria-hidden
          />
          <p className="text-body-sm text-destructive-subtle-foreground">
            This was approved but the refund did not go through. The customer has NOT been paid.
            {request.decision_note ? ` ${request.decision_note}` : ''}
          </p>
        </div>
      ) : decided && request.decision_note ? (
        <p className="text-body-sm text-muted-foreground">
          <span className="font-medium text-foreground">Your note:</span> {request.decision_note}
        </p>
      ) : null}

      {conflict ? (
        <p className="text-body-sm text-warning-subtle-foreground">
          Somebody else decided this first — the list has been refreshed.
        </p>
      ) : null}

      {request.status === 'pending' && !conflict ? (
        <div className="flex flex-col gap-3">
          {rejecting ? (
            <div className="flex flex-col gap-2">
              <label
                htmlFor={`note-${request.id}`}
                className="text-label uppercase tracking-wide text-foreground-subtle"
              >
                Why are you declining?
              </label>
              <Textarea
                id={`note-${request.id}`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                placeholder="The customer is shown this, so write it to them."
              />
              <p className="text-caption text-foreground-subtle">
                Required. A refusal with no reason is the most common cause of a chargeback.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {rejecting ? (
              <>
                <Button
                  variant="destructive"
                  disabled={note.trim().length === 0}
                  loading={mutation.isPending}
                  onClick={() => mutation.mutate({ approve: false })}
                >
                  Decline this request
                </Button>
                <Button variant="ghost" onClick={() => setRejecting(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="primary"
                  loading={mutation.isPending}
                  onClick={() => mutation.mutate({ approve: true })}
                >
                  Approve refund
                </Button>
                <Button variant="outline" onClick={() => setRejecting(true)}>
                  Decline
                </Button>
                {/* Said before the click, not after it. */}
                <span className="text-caption text-foreground-subtle">
                  Approving refunds {formatMoney(request.booking_total_minor)} in full and voids
                  their tickets.
                </span>
              </>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}

/** "waiting 3 days" — the number that decides what an organizer opens first. */
function waitedFor(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function QueueSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {Array.from({ length: 3 }, (_, index) => (
        <div
          key={index}
          className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-card"
        >
          <div className="skeleton h-4 w-48 rounded-md" />
          <div className="skeleton h-16 w-full rounded-lg" />
          <div className="flex gap-2">
            <div className="skeleton h-control w-32 rounded-full" />
            <div className="skeleton h-control w-24 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
