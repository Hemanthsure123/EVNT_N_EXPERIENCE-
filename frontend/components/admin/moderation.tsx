'use client';

import * as React from 'react';
import Image from 'next/image';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ExternalLink, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';
import {
  fetchModerationQueue,
  moderateEvent,
  type ModerationEntry,
  type ModerationStatus,
} from '@/lib/api/admin';
import { cursorFromNextLink } from '@/lib/api/events';
import { ApiError } from '@/lib/api/errors';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
  StatusPill,
} from '@/components/organizer/primitives';
import { cn } from '@/lib/utils/cn';

/**
 * The event moderation queue.
 *
 * ── WHY THE WHOLE EVENT IS ON THE ROW ─────────────────────────────────────
 *
 * An operator working a queue is scanning for the obvious rejections — a
 * placeholder title, a stolen poster, a venue that is a home address. Making
 * them open each one to find that out is what turns a five-minute queue into
 * an hour. So the row carries the poster, the description, the venue, the date
 * and the organisation's verification level, and the decision is made in
 * place.
 *
 * ── APPROVE AND SEND BACK ARE NOT LOOKALIKES ──────────────────────────────
 *
 * They were: a green filled button beside an outlined one of the same height,
 * the same width and the same icon size. On a queue worked at speed that is a
 * misclick waiting to happen, and the misclick publishes an event or emails a
 * rejection to an organiser. They are now separated by a rule and drawn at
 * different weights — Approve is the ONE filled pill (`--cta`, the shared
 * primary action), Send back is a quiet ghost that only picks up the
 * destructive tint on hover. Colour alone would not be enough; weight, spacing
 * and a divider are.
 *
 * Green is reserved for STATUS here, never for an action. A filled green
 * button and a green "approved" pill on the same row is two meanings for one
 * colour.
 *
 * ── REJECTION REQUIRES A REASON, AND THE UI ENFORCES IT FIRST ─────────────
 *
 * The backend refuses a reasonless rejection with `invalid_input`. Rather than
 * let an operator discover that from a red banner, Reject opens an inline
 * composer and the confirm button stays disabled until something is typed. The
 * server check remains the real one — this just means nobody meets it by
 * accident.
 *
 * ── NO BROWSER DIALOGS ────────────────────────────────────────────────────
 *
 * Confirmation is an inline bar on the row itself, per the brief. A
 * `window.confirm` would also block the event loop and lose the note.
 *
 * ── OPTIMISTIC, BUT ONLY FOR REMOVAL ──────────────────────────────────────
 *
 * A decided row disappears immediately, because the operator has just made the
 * decision and watching a spinner on a queue of forty is miserable. What is
 * NOT optimistic is the outcome: if the server refuses (someone else decided it
 * first — the backend's conditional UPDATE makes that a real race), the row
 * comes back with the error attached.
 *
 * ── BULK APPROVE, BUT NEVER BULK REJECT ───────────────────────────────────
 *
 * Approving twenty events from one trusted organiser in one action is a real
 * time saving and each approval is identical. A REJECTION carries a reason the
 * organiser reads, and one reason pasted across twenty different events is a
 * reason that fits none of them — which is worse than not offering it, because
 * the organiser then has to guess what is actually wrong. So bulk is
 * approve-only, and rejection stays per row with its own composer.
 *
 * ── TABS ARE THE SAME ENDPOINT WITH A STATUS ──────────────────────────────
 *
 * `?status=` on the queue. Pending is FIFO — oldest wait first, because that
 * is the organiser who most deserves an answer. Every decided tab is
 * newest-first, because "what did we just do" is the question being asked.
 * `draft` is deliberately unreachable: an unsubmitted draft is an organiser's
 * private workspace, and the server falls back to pending rather than
 * honouring it.
 */

const TABS: { value: ModerationStatus; label: string; blurb: string }[] = [
  {
    value: 'pending_review',
    label: 'Pending',
    blurb: 'Oldest first. Nothing here is visible to attendees.',
  },
  { value: 'live', label: 'Approved', blurb: 'Approved and on sale. Newest decision first.' },
  {
    value: 'rejected',
    label: 'Sent back',
    blurb: 'Returned to the organiser with a reason. They can fix and resubmit.',
  },
  { value: 'archived', label: 'Archived', blurb: 'Retired by their organiser.' },
];

/**
 * The filter tab pill.
 *
 * The selected one is the BUTTER pill (`--nav-active`) — the design system's
 * one "you are here" signal, shared with the active nav item and every applied
 * filter. It is deliberately NOT the brand violet: a selected filter that is
 * filled with the accent reads as a button asking to be pressed, and on a
 * screen whose real actions publish events that ambiguity is expensive.
 *
 * 44px on a phone (the touch-target floor), 36px from `sm` up, where a mouse
 * does not need the extra 8px and a triage queue does.
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

export function ModerationQueue() {
  const client = useQueryClient();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<ModerationStatus>('pending_review');
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = React.useState(false);

  const query = useInfiniteQuery({
    queryKey: ['admin', 'moderation', { status }],
    queryFn: ({ pageParam }) => fetchModerationQueue({ status, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    staleTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const decide = useMutation({
    mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note: string }) =>
      moderateEvent(id, approve, note),
    onSuccess: () => {
      setError(null);
      void client.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (thrown) => {
      setError(
        thrown instanceof ApiError
          ? thrown.message
          : 'That decision did not go through. Nothing was changed.',
      );
      void client.invalidateQueries({ queryKey: ['admin', 'moderation'] });
    },
    onSettled: () => setBusyId(null),
  });

  const rows = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );
  const pending = status === 'pending_review';
  const tab = TABS.find((entry) => entry.value === status) ?? TABS[0];

  // Selection is pruned against the rows that still exist. Without this, a row
  // decided by a colleague stays ticked invisibly and the next bulk approve
  // fires at an event nobody on this screen can see.
  React.useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) return current;
      const live = new Set(rows.map((row) => row.id));
      const next = new Set([...current].filter((id) => live.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [rows]);

  /**
   * Bulk approve, one row at a time.
   *
   * Sequential rather than `Promise.all`: each approval publishes an event and
   * emails an organiser, and a burst of twenty parallel state transitions
   * makes the failure modes much harder to reason about for no meaningful
   * latency win. Failures are COUNTED and reported — "approved 17 of 20" is
   * the truth; a silent success on a partial failure is not.
   */
  const approveSelected = async () => {
    setBulkBusy(true);
    setError(null);
    const targets = rows.filter((row) => selected.has(row.id));
    let done = 0;
    let firstError: string | null = null;

    for (const row of targets) {
      try {
        await moderateEvent(row.id, true, '');
        done += 1;
      } catch (thrown) {
        if (!firstError) {
          firstError = thrown instanceof ApiError ? thrown.message : 'That decision failed.';
        }
      }
    }

    setSelected(new Set());
    setBulkBusy(false);
    void client.invalidateQueries({ queryKey: ['admin'] });
    if (done < targets.length) {
      setError(`Approved ${done} of ${targets.length}. ${firstError ?? ''}`.trim());
    }
  };

  return (
    <div className="flex flex-col gap-stack">
      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-destructive-subtle px-3 py-2 text-body-sm text-destructive-subtle-foreground"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <div role="tablist" aria-label="Moderation status" className="flex flex-wrap gap-1.5">
        {TABS.map((entry) => (
          <button
            key={entry.value}
            role="tab"
            type="button"
            aria-selected={status === entry.value}
            onClick={() => {
              setStatus(entry.value);
              setSelected(new Set());
            }}
            className={tabClass(status === entry.value)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <Panel title={`${tab.label} events`} subtitle={tab.blurb}>
        {query.isError ? (
          <ErrorState message="Could not load the queue." onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <div className="flex flex-col gap-stack p-card">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-32 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={pending ? 'Nothing waiting' : `No ${tab.label.toLowerCase()} events`}
            body={
              pending
                ? 'Every submitted event has been reviewed. New submissions appear here within 30 seconds.'
                : 'Decisions you make appear here, newest first.'
            }
          />
        ) : (
          <>
            {pending ? (
              <div className="flex items-center gap-3 border-b border-border bg-sunken px-card py-2">
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-caption text-muted-foreground sm:min-h-0">
                  <input
                    type="checkbox"
                    checked={selected.size === rows.length && rows.length > 0}
                    ref={(node) => {
                      // Indeterminate is a DOM property, not an attribute —
                      // React cannot set it declaratively.
                      if (node) node.indeterminate = selected.size > 0 && selected.size < rows.length;
                    }}
                    onChange={() =>
                      setSelected(
                        selected.size === rows.length
                          ? new Set()
                          : new Set(rows.map((row) => row.id)),
                      )
                    }
                    className="size-4 accent-primary"
                  />
                  Select all loaded
                </label>
                {selected.size ? (
                  <span aria-live="polite" className="text-caption tabular-nums text-foreground">
                    {selected.size} selected
                  </span>
                ) : null}
              </div>
            ) : null}

            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <ModerationRow
                  key={row.id}
                  row={row}
                  busy={busyId === row.id}
                  selectable={pending}
                  selected={selected.has(row.id)}
                  onSelect={() =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (!next.delete(row.id)) next.add(row.id);
                      return next;
                    })
                  }
                  onDecide={(approve, note) => {
                    setBusyId(row.id);
                    decide.mutate({ id: row.id, approve, note });
                  }}
                />
              ))}
            </ul>
          </>
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

      {/* Approve-only, for the reason in the docstring. Slides up rather than
          pushing the list down — a bar that reflows the rows you are ticking
          makes you lose your place mid-selection. */}
      {pending && selected.size > 0 ? (
        <div
          role="region"
          aria-label={`${selected.size} selected`}
          className={cn(
            'fixed inset-x-0 bottom-4 z-sticky mx-auto flex w-[calc(100%-2rem)] max-w-2xl items-center gap-3',
            'rounded-xl border border-border bg-surface px-card py-2.5 shadow-lg',
            'animate-in slide-in-from-bottom-2 fade-in-0 motion-reduce:animate-none',
          )}
        >
          <span className="text-body-sm font-medium tabular-nums">{selected.size} selected</span>
          <p className="hidden text-caption text-muted-foreground sm:block">
            Sending back needs a reason each, so it stays per event.
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              loading={bulkBusy}
              leftIcon={<Check className="size-3.5" aria-hidden />}
              onClick={() => void approveSelected()}
            >
              Approve {selected.size}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground"
              onClick={() => setSelected(new Set())}
              aria-label="Clear selection"
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModerationRow({
  row,
  busy,
  selectable,
  selected,
  onSelect,
  onDecide,
}: {
  row: ModerationEntry;
  busy: boolean;
  selectable: boolean;
  selected: boolean;
  onSelect: () => void;
  onDecide: (approve: boolean, note: string) => void;
}) {
  const [rejecting, setRejecting] = React.useState(false);
  const [note, setNote] = React.useState('');
  const noteRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (rejecting) noteRef.current?.focus();
  }, [rejecting]);

  const waiting = row.submitted_at
    ? Math.max(0, Math.round((Date.now() - new Date(row.submitted_at).getTime()) / 3_600_000))
    : null;

  const decided = row.status !== 'pending_review';

  return (
    <li
      className={cn(
        'flex flex-col gap-stack p-card transition-colors',
        busy && 'opacity-60',
        // The butter "selected" fill, the same token the active tab uses — one
        // selection language across the console rather than two.
        selected && 'bg-nav-active',
      )}
    >
      <div className="flex gap-stack-lg">
        {selectable ? (
          <label className="flex shrink-0 cursor-pointer items-start pt-1">
            <input
              type="checkbox"
              checked={selected}
              onChange={onSelect}
              aria-label={`Select ${row.title}`}
              className="size-4 accent-primary"
            />
          </label>
        ) : null}

        <div className="relative hidden aspect-card w-40 shrink-0 overflow-hidden rounded-lg bg-muted sm:block">
          {row.poster_url ? (
            <Image src={row.poster_url} alt="" fill sizes="160px" className="object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-caption text-muted-foreground">
              No cover
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate text-body font-semibold">{row.title}</h3>
            {/* The first event from an unverified organisation is the one
                worth reading properly — so the level is on the row, not
                behind a click. */}
            <StatusPill tone={row.verified_level === 'verified' ? 'success' : 'warning'}>
              {row.verified_level === 'verified' ? 'Verified organiser' : 'Unverified organiser'}
            </StatusPill>
            {waiting !== null ? (
              <span className="text-caption tabular-nums text-muted-foreground">
                waiting {waiting < 1 ? 'under an hour' : `${waiting}h`}
              </span>
            ) : null}
          </div>

          <p className="text-caption text-muted-foreground">
            {row.organization_name} · {row.venue}, {row.city} ·{' '}
            {new Date(row.starts_at).toLocaleString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>

          <p className="line-clamp-3 text-body-sm text-muted-foreground">
            {row.description || <span className="italic">No description provided.</span>}
          </p>

          {/* The organiser's own words, verbatim. Shown on a decided row
              because "why was this sent back" is the question asked of this
              tab, and making an operator remember is how the same event gets
              rejected twice for different reasons. */}
          {row.moderation_note ? (
            <p className="rounded-md border border-border bg-sunken px-2.5 py-1.5 text-caption text-muted-foreground">
              <span className="font-medium text-foreground">Reason given: </span>
              {row.moderation_note}
            </p>
          ) : null}

          {/* Only a LIVE event has a public page. Linking to one for a pending
              event would 404 — the public detail query filters on `live`, and
              previewing an unapproved event as an attendee needs a staff
              override the endpoint does not have (BACKLOG item 51). */}
          {row.status === 'live' ? (
            <Link
              href={`/events/${row.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1.5 text-caption text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              View the public page
              <ExternalLink className="size-3" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>

      {decided ? null : rejecting ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-sunken p-3">
          <label htmlFor={`note-${row.id}`} className="text-caption font-medium">
            Why is this being sent back? The organiser sees this exact text.
          </label>
          <Textarea
            id={`note-${row.id}`}
            ref={noteRef}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. The poster is unreadable at card size — please upload a landscape image at 1200×800 or larger."
            className="min-h-0 text-body-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="destructive"
              disabled={!note.trim() || busy}
              onClick={() => onDecide(false, note.trim())}
              leftIcon={<X className="size-3.5" aria-hidden />}
            >
              Send back
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setRejecting(false);
                setNote('');
              }}
            >
              Cancel
            </Button>
            {!note.trim() ? (
              <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
                <AlertTriangle className="size-3.5 shrink-0" aria-hidden />A reason is required —
                the server refuses a rejection without one.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        /* One filled action, one quiet one, and a rule between them — see the
           "not lookalikes" note at the top of this file. */
        <div className="flex flex-wrap items-center gap-2">
          <Button
            loading={busy}
            onClick={() => onDecide(true, '')}
            leftIcon={<Check className="size-3.5" aria-hidden />}
          >
            Approve and publish
          </Button>
          <span className="hidden h-6 w-px shrink-0 bg-border sm:block" aria-hidden />
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setRejecting(true)}
            className="text-muted-foreground hover:bg-destructive-subtle hover:text-destructive-subtle-foreground"
            leftIcon={<X className="size-3.5" aria-hidden />}
          >
            Send back for changes
          </Button>
        </div>
      )}
    </li>
  );
}
