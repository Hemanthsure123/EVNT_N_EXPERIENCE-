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
 * the modal: `PendingReviewCard` renders the same thing, quietly, on the
 * tickets page, for as long as the window is open. That is what makes the
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
 * The quiet half. Lives on the tickets page and never interrupts anything.
 *
 * This is what makes the modal's permanent dismissal honest: the chance to
 * review does not vanish because somebody was busy the first time.
 */
export function PendingReviewCard({ className }: { className?: string }) {
  const { data, isPending } = usePendingReviews();
  const [openId, setOpenId] = React.useState<string | null>(null);
  const pending = data?.data ?? [];

  const uniquePending = React.useMemo(() => {
    const seen = new Set<string>();
    const list: PendingReview[] = [];
    for (const item of pending) {
      if (!seen.has(item.event_id)) {
        seen.add(item.event_id);
        list.push(item);
      }
    }
    return list;
  }, [pending]);

  // No skeleton and no empty state: an absent section is correct when there is
  // nothing to review, and a placeholder for a thing most people never have is
  // clutter on the page they came to for their tickets.
  if (isPending || uniquePending.length === 0) return null;

  return (
    <section
      className={cn('flex flex-col gap-3 rounded-2xl border border-border/80 bg-surface/50 p-4', className)}
      aria-label="Rate your recent experiences"
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Star className="size-3.5 fill-amber-500 text-amber-500" />
          </span>
          <h2 className="text-body font-bold text-foreground">
            Rate your recent experiences
          </h2>
        </div>
        <p className="pl-8 text-caption text-muted-foreground">
          Help fellow attendees by sharing how your event went.
        </p>
      </div>

      <ul className="flex flex-col gap-2.5 pt-1">
        {uniquePending.map((row) => {
          const isOpen = openId === row.event_id;
          return (
            <li key={row.event_id}>
              <article className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-sm transition-all">
                <div className="flex items-center gap-3">
                  <EventThumb event={row} />
                  <div className="min-w-0 flex-1">
                    <OpenEventLink
                      event={{ id: row.event_id, title: row.title, poster_url: row.poster_url ?? '' }}
                      className="block truncate text-body-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {row.title}
                    </OpenEventLink>
                    <p className="mt-0.5 truncate text-caption text-muted-foreground">
                      {formatAttended(row.ended_at)} · {row.venue}, {row.city}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpenId(isOpen ? null : row.event_id)}
                    className={cn(
                      'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-caption font-medium transition-colors duration-fast',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isOpen
                        ? 'bg-muted text-muted-foreground hover:bg-muted/80'
                        : 'bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm',
                    )}
                  >
                    <Star className="size-3.5" />
                    {isOpen ? 'Close' : 'Rate'}
                  </button>
                </div>

                {isOpen ? (
                  <div className="border-t border-border pt-3">
                    <ReviewForm
                      eventId={row.event_id}
                      onDone={() => {
                        setOpenId(null);
                        dismiss(row.event_id);
                      }}
                    />
                  </div>
                ) : null}
              </article>
            </li>
          );
        })}
      </ul>
    </section>
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
