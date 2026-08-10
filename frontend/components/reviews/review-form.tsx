'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { errorMessage } from '@/lib/api/errors';
import { submitReview, updateMyReview, type Review } from '@/lib/api/reviews';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils/cn';
import { StarRatingInput } from './star-rating';

/**
 * Rate, optionally write, submit. Three steps, and the second is skippable.
 *
 * ── THE TEXT IS OPTIONAL, AND THAT IS THE CONVERSION DECISION ─────────────
 *
 * A required textarea is how a five-star night becomes no review at all: the
 * person taps four stars, sees an empty box with a red border, and leaves. The
 * rating alone is a complete, useful review — it moves the average, which is
 * the number that actually helps the next person decide. The server agrees;
 * `body` is optional there too.
 *
 * ── SUBMIT IS DISABLED UNTIL A STAR IS CHOSEN ─────────────────────────────
 *
 * Not because validation is hard, but because a "Submit" that produces an
 * error message for a form somebody has not touched is a worse first response
 * than a button that is visibly not ready yet.
 *
 * ── THE SUCCESS STATE REPLACES THE FORM ───────────────────────────────────
 *
 * A toast over a still-editable form leaves somebody wondering whether it
 * saved. Swapping the form for a confirmation is unambiguous, and it is where
 * the one piece of onward engagement sits — a link to more events like it,
 * offered once, after the value has been given rather than in exchange for it.
 */

const BODY_MAX = 2000;

export function ReviewForm({
  eventId,
  existing = null,
  onDone,
  className,
}: {
  eventId: string;
  /** When present the form edits rather than creates. */
  existing?: Review | null;
  onDone?: (review: Review) => void;
  className?: string;
}) {
  const client = useQueryClient();
  const [rating, setRating] = React.useState(existing?.rating ?? 0);
  const [body, setBody] = React.useState(existing?.body ?? '');

  const save = useMutation({
    mutationFn: () =>
      existing
        ? updateMyReview(eventId, rating, body.trim())
        : submitReview(eventId, rating, body.trim()),
    onSuccess: (review) => {
      // Everything that displays a rating is now stale: the list, the summary,
      // this person's own review, and the pending prompt that should stop
      // asking.
      void client.invalidateQueries({ queryKey: ['reviews', eventId] });
      void client.invalidateQueries({ queryKey: ['review-summary', eventId] });
      void client.invalidateQueries({ queryKey: ['my-review', eventId] });
      void client.invalidateQueries({ queryKey: ['pending-reviews'] });
      onDone?.(review);
    },
  });

  if (save.isSuccess) {
    return (
      <div
        className={cn(
          'flex flex-col items-start gap-stack rounded-xl border border-border bg-sunken p-card',
          className,
        )}
      >
        <p className="flex items-center gap-2 text-body font-semibold text-foreground">
          <CheckCircle2 className="size-5 text-success" aria-hidden />
          Thanks — that helps.
        </p>
        <p className="text-body-sm text-muted-foreground">
          Your review is on the event page now.
        </p>
      </div>
    );
  }

  const tooLong = body.length > BODY_MAX;

  return (
    <div className={cn('flex flex-col gap-stack', className)}>
      <div className="flex flex-col gap-1">
        <span id="review-rating-label" className="text-label">
          How was it?
        </span>
        <StarRatingInput
          value={rating}
          onChange={setRating}
          disabled={save.isPending}
          id="review-rating"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="review-body" className="text-label">
          Anything you would tell a friend?{' '}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea
          id="review-body"
          rows={4}
          value={body}
          maxLength={BODY_MAX}
          disabled={save.isPending}
          onChange={(event) => setBody(event.target.value)}
          placeholder="The sound, the venue, whether you would go again…"
        />
        {/* Only near the limit. A counter from character one is a word budget
            nobody asked for. */}
        {body.length > BODY_MAX - 200 ? (
          <p className={cn('text-caption', tooLong ? 'text-destructive' : 'text-muted-foreground')}>
            {BODY_MAX - body.length} characters left
          </p>
        ) : null}
      </div>

      {save.isError ? (
        <p role="alert" className="text-body-sm text-destructive">
          {errorMessage(save.error)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={rating === 0 || tooLong || save.isPending}
          onClick={() => save.mutate()}
          className={cn(
            'inline-flex h-control items-center gap-2 rounded-full bg-cta px-pill text-label text-cta-foreground',
            'transition-opacity disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          {save.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {existing ? 'Update review' : 'Post review'}
        </button>
        {rating === 0 ? (
          <span className="text-caption text-muted-foreground">Pick a rating to continue</span>
        ) : null}
      </div>
    </div>
  );
}
