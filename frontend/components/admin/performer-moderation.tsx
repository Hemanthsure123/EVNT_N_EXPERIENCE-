'use client';

import * as React from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BadgeCheck, Check, ExternalLink, Music4, Star, X } from 'lucide-react';
import {
  OCCASION_LABELS,
  PERFORMER_TYPE_LABELS,
  fetchPerformerQueue,
  moderatePerformer,
  setPerformerFeatured,
  type OwnerPerformer,
  type PerformerStatus,
} from '@/lib/api/performers';
import { cursorFromNextLink } from '@/lib/api/events';
import { ApiError } from '@/lib/api/errors';
import { formatMoney } from '@/lib/discovery/format';
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
 * Performer moderation.
 *
 * Deliberately the SAME shape as event moderation — tabs, a FIFO pending
 * queue, an inline reject composer that requires a reason, and the decision
 * note shown on every decided row. An operator moving between the two queues
 * should not have to learn a second interaction; the only thing that differs
 * is what is being judged.
 *
 * That extends to the visual language: the same butter "you are here" tab, the
 * same one-filled-pill decision bar, and the same rule separating Approve from
 * Send back so the two can never be hit for each other. See the long note in
 * `moderation.tsx`.
 *
 * ── FEATURING IS SEPARATE FROM APPROVING ──────────────────────────────────
 *
 * Approving makes an act visible. Featuring puts it on the landing page, which
 * is an editorial decision about promotion rather than about acceptability —
 * so it is its own control, available only on already-approved profiles, and
 * it is an OUTLINE button rather than a filled one: promoting an act is not
 * the primary action of a moderation queue. The server refuses to feature
 * anything that is not live, which is what stops a draft appearing on the
 * front page while invisible everywhere else.
 *
 * ── WHAT THE BRIEF ASKED FOR THAT IS NOT HERE ─────────────────────────────
 *
 * **Reported performers** and **availability issues** — neither has a model.
 * There is no report object and nothing records a no-show, so both tabs could
 * only ever be empty while implying the platform is watching for something it
 * is not. **Suspensions** exist for the OWNER (account suspension in Users);
 * suspending one act rather than the whole organisation needs its own state.
 * BACKLOG items 64 and 65.
 */

const TABS: { value: PerformerStatus; label: string; blurb: string }[] = [
  {
    value: 'pending_review',
    label: 'Pending',
    blurb: 'Oldest first. None of these is visible in the marketplace.',
  },
  { value: 'live', label: 'Approved', blurb: 'Listed and taking briefs.' },
  {
    value: 'rejected',
    label: 'Sent back',
    blurb: 'Returned with a reason. They can fix and resubmit.',
  },
  { value: 'archived', label: 'Archived', blurb: 'Retired by their owner.' },
];

/** The same tab pill as the event queue — see the note in `moderation.tsx`. */
const tabClass = (active: boolean) =>
  cn(
    'inline-flex h-control items-center rounded-full border px-pill text-label sm:h-control-sm',
    'transition-colors duration-fast motion-reduce:transition-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? 'border-transparent bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
  );

export function PerformerModeration() {
  const client = useQueryClient();
  const [status, setStatus] = React.useState<PerformerStatus>('pending_review');
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['admin', 'performers', { status }],
    queryFn: ({ pageParam }) => fetchPerformerQueue({ status, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    staleTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const decide = useMutation({
    mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note: string }) =>
      moderatePerformer(id, approve, note),
    onSuccess: () => {
      setError(null);
      void client.invalidateQueries({ queryKey: ['admin', 'performers'] });
    },
    onError: (thrown) =>
      setError(
        thrown instanceof ApiError
          ? thrown.message
          : 'That decision did not go through. Nothing was changed.',
      ),
    onSettled: () => setBusyId(null),
  });

  const feature = useMutation({
    mutationFn: ({ id, featured }: { id: string; featured: boolean }) =>
      setPerformerFeatured(id, featured),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['admin', 'performers'] }),
    onError: (thrown) =>
      setError(thrown instanceof ApiError ? thrown.message : 'Could not change that.'),
    onSettled: () => setBusyId(null),
  });

  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];
  const tab = TABS.find((entry) => entry.value === status) ?? TABS[0];

  return (
    <div className="flex flex-col gap-stack">
      <header className="flex flex-col gap-1">
        <h1 className="text-h3">Performers</h1>
        <p className="text-body-sm text-muted-foreground">
          Every act is reviewed before it appears in the marketplace.
        </p>
      </header>

      <div role="tablist" aria-label="Performer status" className="flex flex-wrap gap-1.5">
        {TABS.map((entry) => (
          <button
            key={entry.value}
            role="tab"
            type="button"
            aria-selected={status === entry.value}
            onClick={() => setStatus(entry.value)}
            className={tabClass(status === entry.value)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-destructive-subtle px-3 py-2 text-body-sm text-destructive-subtle-foreground"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <Panel title={`${tab.label} performers`} subtitle={tab.blurb}>
        {query.isError ? (
          <ErrorState message="Could not load the queue." onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <div className="flex flex-col gap-stack p-card">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-28 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Music4}
            title={
              status === 'pending_review' ? 'Nothing waiting' : `No ${tab.label.toLowerCase()} acts`
            }
            body={
              status === 'pending_review'
                ? 'Every submitted profile has been reviewed. New submissions appear here within 30 seconds.'
                : 'Decisions you make appear here, newest first.'
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((performer) => (
              <li key={performer.id}>
                <PerformerRow
                  performer={performer}
                  busy={busyId === performer.id}
                  onDecide={(approve, note) => {
                    setBusyId(performer.id);
                    decide.mutate({ id: performer.id, approve, note });
                  }}
                  onFeature={(featured) => {
                    setBusyId(performer.id);
                    feature.mutate({ id: performer.id, featured });
                  }}
                />
              </li>
            ))}
          </ul>
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

function PerformerRow({
  performer,
  busy,
  onDecide,
  onFeature,
}: {
  performer: OwnerPerformer;
  busy: boolean;
  onDecide: (approve: boolean, note: string) => void;
  onFeature: (featured: boolean) => void;
}) {
  const [rejecting, setRejecting] = React.useState(false);
  const [note, setNote] = React.useState('');
  const noteRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (rejecting) noteRef.current?.focus();
  }, [rejecting]);

  const pending = performer.status === 'pending_review';
  const waiting = performer.submitted_at
    ? Math.max(
        0,
        Math.round((Date.now() - new Date(performer.submitted_at).getTime()) / 3_600_000),
      )
    : null;

  return (
    <div className={cn('flex flex-col gap-stack p-card transition-opacity', busy && 'opacity-60')}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="truncate text-body font-semibold">{performer.stage_name}</span>
            <StatusPill tone="neutral">
              {PERFORMER_TYPE_LABELS[performer.performer_type]}
            </StatusPill>
            {/* The first act from an unverified organisation is the one worth
                reading properly — so the level is on the row, not behind a
                click. */}
            <StatusPill
              tone={performer.verified_level === 'verified' ? 'success' : 'warning'}
              className="gap-1"
            >
              <BadgeCheck className="size-3" aria-hidden />
              {performer.verified_level === 'verified' ? 'Verified org' : 'Unverified org'}
            </StatusPill>
            {performer.is_featured ? (
              <StatusPill tone="info" className="gap-1">
                <Star className="size-3" aria-hidden />
                Featured
              </StatusPill>
            ) : null}
            {pending && waiting !== null ? (
              <span className="text-caption tabular-nums text-muted-foreground">
                waiting {waiting < 1 ? 'under an hour' : `${waiting}h`}
              </span>
            ) : null}
          </p>

          <p className="mt-0.5 text-caption text-muted-foreground">
            {performer.organization_name} · {performer.city}
            {performer.travel_radius_km > 0 ? ` (travels ${performer.travel_radius_km} km)` : ''}
            {performer.experience_years > 0 ? ` · ${performer.experience_years} yrs` : ''}
            {' · '}
            {performer.base_price_minor === null
              ? 'price on ask'
              : `from ${formatMoney(performer.base_price_minor)}`}
          </p>

          {performer.tagline ? (
            <p className="mt-1 text-body-sm text-muted-foreground">{performer.tagline}</p>
          ) : null}
          {performer.bio ? (
            <p className="mt-1 line-clamp-3 text-body-sm text-muted-foreground">{performer.bio}</p>
          ) : null}

          {performer.genres.length || performer.occasions.length ? (
            <ul className="mt-1.5 flex flex-wrap gap-1">
              {[...performer.genres, ...performer.occasions.map((o) => OCCASION_LABELS[o] ?? o)]
                .slice(0, 8)
                .map((tag) => (
                  <li
                    key={tag}
                    className="rounded-full border border-border px-2 py-0.5 text-caption text-muted-foreground"
                  >
                    {tag}
                  </li>
                ))}
            </ul>
          ) : null}

          {performer.moderation_note ? (
            <p className="mt-2 rounded-md border border-border bg-sunken px-2.5 py-1.5 text-caption text-muted-foreground">
              <span className="font-medium text-foreground">Reason given: </span>
              {performer.moderation_note}
            </p>
          ) : null}

          {/* Only a LIVE profile has a public page — linking to one for a
              pending act would 404, because the public query filters on live. */}
          {performer.status === 'live' ? (
            <Link
              href={`/hire/${performer.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex w-fit items-center gap-1.5 text-caption text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              View the public profile
              <ExternalLink className="size-3" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>

      {pending ? (
        rejecting ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-sunken p-3">
            <label htmlFor={`note-${performer.id}`} className="text-caption font-medium">
              Why is this being sent back? The performer sees this exact text.
            </label>
            <Textarea
              id={`note-${performer.id}`}
              ref={noteRef}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. The photos look like stock images — please upload pictures of the act itself."
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
                  <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                  A reason is required — the server refuses a rejection without one.
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              loading={busy}
              onClick={() => onDecide(true, '')}
              leftIcon={<Check className="size-3.5" aria-hidden />}
            >
              Approve and list
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
        )
      ) : performer.status === 'live' ? (
        // Featuring is promotion, not acceptability — its own control, on an
        // already-approved act, and never the filled pill.
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onFeature(!performer.is_featured)}
            leftIcon={
              <Star
                className={cn('size-3.5', performer.is_featured && 'fill-current text-primary')}
                aria-hidden
              />
            }
          >
            {performer.is_featured ? 'Remove from the landing page' : 'Feature on the landing page'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
