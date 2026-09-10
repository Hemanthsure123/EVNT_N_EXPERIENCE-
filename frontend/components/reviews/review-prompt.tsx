'use client';

import * as React from 'react';
import Image from 'next/image';
import { OpenEventLink } from '@/components/event/open-event-link';
import { useQuery } from '@tanstack/react-query';
import { Star, X } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-provider';
import { fetchPendingReviews, type PendingReview } from '@/lib/api/reviews';
import { Modal, ModalContent } from '@/components/ui/modal';
import { cn } from '@/lib/utils/cn';
import { PosterThumb } from '@/components/ticketing/primitives';
import { ReviewForm } from './review-form';

/**
 * ── ASKING ONCE, AND NEVER AGAIN ──────────────────────────────────────────
 *
 * A prompt for feedback is the easiest thing in a product to get wrong: every
 * platform researched can ask, and the ones people resent are the ones that
 * ask twice. Two rules follow from that, and they are the whole design.
 *
 * **1. One dismissal is final, per event.** Pressing Not now writes the event
 * id to `localStorage` and this component never raises it again. Not a
 * snooze, not "we'll ask again next week" — an answer.
 *
 * **2. Dismissing costs you nothing.** The opportunity does not disappear with
 * the modal: the tickets page's "Yet to Rate" view (`PendingReviewRow`) lists
 * the same events, quietly, for as long as the window is open. That is what makes the
 * dismissal safe to honour permanently — the brief's own suggestion, and the
 * reason this is not a nag.
 *
 * ── WHY DISMISSAL IS LOCAL AND NOT A DATABASE ROW ─────────────────────────
 *
 * A `dismissed_at` column would need a table, an endpoint, a write on a
 * decision worth nothing, and a migration — to remember a preference whose
 * worst failure is showing a card once on a second device. The pending list
 * itself is server-derived and authoritative; this only decides whether to
 * interrupt. Storage is the right weight for it.
 *
 * ── AND IT WAITS ──────────────────────────────────────────────────────────
 *
 * Not on first paint. Somebody who opens the app is going somewhere, and a
 * modal in front of that is the interruption people are describing when they
 * say a product nags. The server has already held the prompt back for two
 * hours after the doors closed; this adds a beat after arrival.
 */

const DISMISSED_KEY = 'ee-review-dismissed';
const APPEAR_AFTER_MS = 2500;

function dismissedIds(): string[] {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    // A corrupt or blocked store must not stop the app rendering. The cost of
    // failing here is one extra prompt, ever.
    return [];
  }
}

function dismiss(eventId: string): void {
  try {
    const next = [...new Set([...dismissedIds(), eventId])].slice(-50);
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  } catch {
    /* see above */
  }
}

/** The pending list, shared by the modal and the card so one fetch serves both. */
export function usePendingReviews() {
  const { status } = useAuth();
  return useQuery({
    queryKey: ['pending-reviews'],
    queryFn: fetchPendingReviews,
    // Signed out there is nothing to ask about, and the endpoint would 401.
    enabled: status === 'authenticated',
    staleTime: 60_000,
  });
}

export function ReviewPrompt() {
  const { data } = usePendingReviews();
  const [open, setOpen] = React.useState(false);
  const [target, setTarget] = React.useState<PendingReview | null>(null);

  React.useEffect(() => {
    const pending = data?.data ?? [];
    if (!pending.length) return;
    const skip = new Set(dismissedIds());
    // The most recent event they attended, not the oldest: it is the one they
    // remember, and asking about a month-old night first is how the prompt
    // gets dismissed on principle.
    const next = pending.find((row) => !skip.has(row.event_id));
    if (!next) return;

    const timer = window.setTimeout(() => {
      setTarget(next);
      setOpen(true);
    }, APPEAR_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [data]);

  const close = () => {
    if (target) dismiss(target.event_id);
    setOpen(false);
  };

  if (!target) return null;

  return (
    <Modal open={open} onOpenChange={(next: boolean) => !next && close()}>
      <ModalContent hideClose className="sm:max-w-md">
        <div className="flex flex-col gap-stack">
          <div className="flex items-start gap-3">
            <EventThumb event={target} />
            <div className="min-w-0 flex-1">
              <p className="text-caption uppercase tracking-wide text-foreground-subtle">
                You went to
              </p>
              <h2 className="truncate text-body-lg font-semibold text-foreground">
                {target.title}
              </h2>
              <p className="truncate text-caption text-muted-foreground">
                {formatAttended(target.ended_at)} · {target.venue}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Not now"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          {/* One line on why, and it is a true one: the rating is what the next
              person sees. No "help us improve", which is about us. */}
          <p className="text-body-sm text-muted-foreground">
            A rating takes a second and tells the next person whether to go.
          </p>

          <ReviewForm eventId={target.event_id} onDone={() => dismiss(target.event_id)} />

          <button
            type="button"
            onClick={close}
            className="w-fit text-caption text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Not now
          </button>
        </div>
      </ModalContent>
    </Modal>
  );
}

/**
 * The events still waiting for a rating, one per event, most recent first.
 *
 * Several bookings for one night produce several pending rows; a person rates
 * the NIGHT once, so the list is folded to one entry per event.
 */
export function uniquePendingReviews(pending: readonly PendingReview[]): PendingReview[] {
  const seen = new Set<string>();
  const list: PendingReview[] = [];
  for (const item of pending) {
    if (seen.has(item.event_id)) continue;
    seen.add(item.event_id);
    list.push(item);
  }
  return list;
}

/**
 * One event waiting for a rating — a row in the tickets screen's "Yet to Rate"
 * view.
 *
 * This is what makes the modal's permanent dismissal honest: the chance to
 * review does not vanish because somebody was busy the first time. It used to
 * be a separate "Rate your recent experiences" card stacked above the bookings;
 * it is a VIEW of that list now, with the same card shape as a booking, so
 * rating is somewhere you go rather than something the page pushes at you.
 *
 * The Rate button is BLACK — the page's primary-action colour — not violet.
 */
export function PendingReviewRow({ row }: { row: PendingReview }) {
  const [open, setOpen] = React.useState(false);

  return (
    <article className="flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-3.5">
        <PosterThumb src={row.poster_url} alt="" className="size-16" />
        <div className="min-w-0 flex-1">
          <OpenEventLink
            event={{ id: row.event_id, title: row.title, poster_url: row.poster_url ?? '' }}
            className="max-w-full truncate text-body font-bold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {row.title}
          </OpenEventLink>
          <p className="mt-0.5 truncate text-caption text-muted-foreground">
            {formatAttended(row.ended_at)} · {[row.venue, row.city].filter(Boolean).join(', ')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className={cn(
            'inline-flex h-control-sm shrink-0 items-center gap-1.5 rounded-full px-4 text-label transition-colors duration-fast',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            'motion-reduce:transition-none',
            open
              ? 'border border-border bg-surface text-foreground hover:bg-muted'
              : 'bg-cta text-cta-foreground shadow-sm hover:bg-cta-hover active:bg-cta-active',
          )}
        >
          <Star className="size-3.5" aria-hidden />
          {open ? 'Close' : 'Rate'}
        </button>
      </div>

      {open ? (
        <div className="mt-4 border-t border-border pt-4">
          <ReviewForm
            eventId={row.event_id}
            onDone={() => {
              setOpen(false);
              dismiss(row.event_id);
            }}
          />
        </div>
      ) : null}
    </article>
  );
}

function EventThumb({ event }: { event: PendingReview }) {
  if (!event.poster_url) {
    return <div className="size-14 shrink-0 rounded-lg bg-muted" aria-hidden />;
  }
  return (
    <div className="relative size-14 shrink-0 overflow-hidden rounded-lg border border-border">
      {/* Empty alt: the title is right beside it. */}
      <Image src={event.poster_url} alt="" fill sizes="56px" className="object-cover" />
    </div>
  );
}

function formatAttended(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
