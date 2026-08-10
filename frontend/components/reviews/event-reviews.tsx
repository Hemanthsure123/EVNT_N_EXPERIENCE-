'use client';

import * as React from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { BadgeCheck, Loader2, Star } from 'lucide-react';
import { cursorFromNextLink } from '@/lib/api/events';
import {
  fetchEligibility,
  fetchMyReview,
  fetchReviewSummary,
  fetchReviews,
  type Review,
} from '@/lib/api/reviews';
import { useAuth } from '@/lib/auth/auth-provider';
import { ErrorState, Skeleton } from '@/components/organizer/primitives';
import { cn } from '@/lib/utils/cn';
import { ReviewForm } from './review-form';
import { StarRatingDisplay } from './star-rating';

/**
 * The event page's reviews section: a summary, a way in, and the reviews.
 *
 * ── IT SCALES BOTH WAYS ───────────────────────────────────────────────────
 *
 * At zero reviews the section is a single line and a rating row — no
 * distribution chart of five empty bars, no "be the first!" banner shouting at
 * somebody who cannot review anyway. At two thousand it is the same component
 * with a cursor-paginated list; nothing here ever renders an unbounded number
 * of rows.
 *
 * ── AN UNRATED EVENT SHOWS NO SCORE, NOT A ZERO ───────────────────────────
 *
 * `average` is null until somebody rates. A 0.0 in a star row renders as a
 * real and terrible score, which is the single most damaging thing a review
 * section can do to an event that has simply not been reviewed yet.
 *
 * ── THE WRITE AFFORDANCE IS ONLY EVER SHOWN TO SOMEBODY WHO CAN USE IT ────
 *
 * Eligibility comes from the server. Everyone else sees the reviews and no
 * form — a "Write a review" button that produces a refusal is worse than no
 * button, and it is the one place a client-side guess would be visible as a
 * bug rather than a security hole (the server refuses either way).
 */

export function EventReviews({ eventId }: { eventId: string }) {
  const summary = useQuery({
    queryKey: ['review-summary', eventId],
    queryFn: () => fetchReviewSummary(eventId),
    staleTime: 60_000,
  });

  const reviews = useInfiniteQuery({
    queryKey: ['reviews', eventId],
    queryFn: ({ pageParam }) => fetchReviews(eventId, pageParam as string | null),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
  });

  const rows = reviews.data?.pages.flatMap((page) => page.data) ?? [];
  const count = summary.data?.count ?? 0;

  return (
    <div className="flex flex-col gap-block">
      <RatingSummary
        average={count ? (summary.data?.average ?? 0) : null}
        count={count}
        distribution={summary.data?.distribution}
        loading={summary.isPending}
      />

      <WriteSlot eventId={eventId} />

      {reviews.isPending ? (
        <ul className="flex flex-col gap-4" aria-hidden>
          {[0, 1].map((n) => (
            <li key={n}>
              <Skeleton className="h-24 w-full rounded-xl" />
            </li>
          ))}
        </ul>
      ) : reviews.isError ? (
        <ErrorState
          message="Could not load reviews."
          onRetry={() => void reviews.refetch()}
          className="rounded-xl border border-border bg-surface"
        />
      ) : rows.length === 0 ? (
        // Quiet. Nothing to apologise for and nobody to prompt — most people
        // reading this could not review even if asked.
        <p className="text-body-sm text-muted-foreground">
          No reviews yet. Ratings appear once people who attended have left one.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {rows.map((review) => (
              <li key={review.id}>
                <ReviewCard review={review} />
              </li>
            ))}
          </ul>
          {reviews.hasNextPage ? (
            <button
              type="button"
              onClick={() => void reviews.fetchNextPage()}
              disabled={reviews.isFetchingNextPage}
              className="mx-auto inline-flex h-control items-center gap-2 rounded-full border border-border bg-surface px-pill text-label transition-colors hover:bg-muted disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {reviews.isFetchingNextPage ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              More reviews
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function RatingSummary({
  average,
  count,
  distribution,
  loading,
}: {
  average: number | null;
  count: number;
  distribution?: Record<string, number>;
  loading: boolean;
}) {
  if (loading) return <Skeleton className="h-24 w-full rounded-xl" />;

  if (average === null) {
    return (
      <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
        <Star className="size-4 text-border-strong" aria-hidden />
        Not rated yet
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-stack rounded-xl border border-border bg-surface p-card sm:flex-row sm:items-center sm:gap-block">
      <div className="flex items-center gap-3 sm:flex-col sm:items-start">
        <p className="text-h2 tabular-nums leading-none">{average.toFixed(1)}</p>
        <div className="flex flex-col gap-1">
          <StarRatingDisplay value={average} size="lg" />
          <p className="text-caption text-muted-foreground">
            {count === 1 ? '1 review' : `${count} reviews`}
          </p>
        </div>
      </div>

      {/* The distribution is progressive disclosure: it explains the average
          for anybody who wants to know whether 4.2 is "consistently good" or
          "half loved it". Hidden below `sm` — five bars on a 390px screen is
          five lines of decoration above the reviews somebody came to read. */}
      {distribution ? (
        <ul className="hidden min-w-0 flex-1 flex-col gap-1 sm:flex" aria-label="Rating breakdown">
          {[5, 4, 3, 2, 1].map((star) => {
            const value = distribution[String(star)] ?? 0;
            const share = count ? (value / count) * 100 : 0;
            return (
              <li key={star} className="flex items-center gap-2 text-caption">
                <span className="w-3 shrink-0 tabular-nums text-muted-foreground">{star}</span>
                <Star className="size-3 shrink-0 fill-warning text-warning" aria-hidden />
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-warning"
                    // A percentage of a container, so no arbitrary pixel value
                    // and nothing to keep in step with a breakpoint.
                    style={{ width: `${share}%` }}
                  />
                </span>
                <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">
                  {value}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The write path, which is four different things depending on who is asking.
 *
 * Signed out: nothing at all — a sign-in prompt here would be asking a
 * stranger to make an account for a form they still could not use.
 */
function WriteSlot({ eventId }: { eventId: string }) {
  const { status } = useAuth();
  const enabled = status === 'authenticated';

  const eligibility = useQuery({
    queryKey: ['review-eligibility', eventId],
    queryFn: () => fetchEligibility(eventId),
    enabled,
  });
  const mine = useQuery({
    queryKey: ['my-review', eventId],
    queryFn: () => fetchMyReview(eventId),
    enabled,
  });
  const [editing, setEditing] = React.useState(false);

  if (!enabled || eligibility.isPending) return null;

  if (mine.data) {
    return (
      <div className="flex flex-col gap-stack rounded-xl border border-border bg-sunken p-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-label">Your review</p>
          <button
            type="button"
            onClick={() => setEditing((current) => !current)}
            className="text-caption text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
        </div>
        {editing ? (
          <ReviewForm
            eventId={eventId}
            existing={mine.data}
            onDone={() => setEditing(false)}
          />
        ) : (
          <>
            <StarRatingDisplay value={mine.data.rating} />
            {mine.data.body ? (
              <p className="whitespace-pre-wrap text-body-sm text-foreground">{mine.data.body}</p>
            ) : null}
          </>
        )}
      </div>
    );
  }

  if (eligibility.data?.allowed) {
    return (
      <div className="flex flex-col gap-stack rounded-xl border border-border bg-sunken p-card">
        <p className="text-label">You went to this — how was it?</p>
        <ReviewForm eventId={eventId} />
      </div>
    );
  }

  // Everything else is silence, with ONE exception: somebody who attended but
  // arrived after the window closed gets told why, because they have a real
  // expectation to correct. "You did not book this" needs no announcement.
  if (eligibility.data?.reason === 'window_closed') {
    return (
      <p className="text-body-sm text-muted-foreground">Reviews for this event have closed.</p>
    );
  }
  return null;
}

function ReviewCard({ review }: { review: Review }) {
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StarRatingDisplay value={review.rating} />
        <span className="text-body-sm font-medium text-foreground">{review.author}</span>
        {review.verified_attendee ? (
          // Earned, not claimed: this only appears when a ticket on the
          // booking was actually scanned at the gate.
          <span
            className="inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-caption text-success-subtle-foreground"
            title="A ticket on this booking was scanned at the gate"
          >
            <BadgeCheck className="size-3.5" aria-hidden />
            Attended
          </span>
        ) : null}
        <time
          dateTime={review.created_at}
          className="ml-auto text-caption text-foreground-subtle"
        >
          {new Date(review.created_at).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
          {review.edited ? ' · edited' : ''}
        </time>
      </div>
      {review.body ? (
        <p className={cn('whitespace-pre-wrap text-body-sm text-foreground')}>{review.body}</p>
      ) : null}
    </article>
  );
}
