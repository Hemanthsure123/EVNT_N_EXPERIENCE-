'use client';

import * as React from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { PublicOffer } from '@/lib/api/types';
import { offerBadge, type OfferOutcome } from '@/lib/booking/coupons';
import { formatEventDate, formatMoney } from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';

/**
 * The perforated edge — a column of half-circle notches punched out of the
 * coloured strip's outer side.
 *
 * A MASK rather than a row of background-coloured dots: a dot has to guess the
 * colour of whatever the card sits on, and guesses wrong the moment it sits on
 * anything else. A mask cuts real holes, so the page shows through them in
 * either theme and on any surface.
 */
const PERFORATION = 'radial-gradient(circle at 0 50%, transparent 4px, black 4.5px)';
const PERFORATED_EDGE: React.CSSProperties = {
  WebkitMaskImage: PERFORATION,
  maskImage: PERFORATION,
  WebkitMaskSize: '100% 12px',
  maskSize: '100% 12px',
  WebkitMaskRepeat: 'repeat-y',
  maskRepeat: 'repeat-y',
};

/**
 * One advertised coupon, drawn as a ticket stub.
 *
 * ── DARK IN BOTH THEMES, ON PURPOSE ────────────────────────────────────────
 *
 * Like the issued ticket and the pass card, this is an OBJECT rather than a
 * page, and an object does not invert when a theme toggle flips. Its colours
 * come from theme-independent ramps — `ink` for the stub, `orange` for its edge,
 * the `success` primitives for the saving — because a semantic token swaps
 * places between themes and would vanish on one of them.
 *
 * ── EVERY LINE ON IT IS DERIVED ────────────────────────────────────────────
 *
 * The badge is the organiser's own terms. The green line is `offerOutcome` —
 * the server's rounding and caps, mirrored and tested — for THIS order, so it
 * is the number the total will actually move by. The description is the terms
 * again in words, with the ceiling and the end date. Nothing is written for
 * effect: there is no "limited time!" on a code with no end date, and no
 * "X people used this", because nothing counts that for a customer to see.
 */
export function CouponTicket({
  offer,
  outcome,
  applied,
  pending,
  disabled,
  onApply,
}: {
  offer: PublicOffer;
  outcome: OfferOutcome;
  /** This is the code on the booking now. */
  applied: boolean;
  /** This card's own apply is in flight. */
  pending: boolean;
  /** Another write is in flight, or there is no hold to apply it to. */
  disabled: boolean;
  onApply: (code: string) => void;
}) {
  const usable = outcome.kind === 'saves';
  const blocked = disabled || pending || applied || !usable;

  return (
    <article
      aria-label={`${offer.code}, ${offerBadge(offer)}`}
      className={cn(
        'flex overflow-hidden rounded-2xl bg-ink-900 ring-1 ring-inset ring-ink-800',
        !usable && !applied ? 'opacity-70' : null,
      )}
    >
      <div
        aria-hidden
        style={PERFORATED_EDGE}
        className="flex w-14 shrink-0 items-center justify-center bg-orange-500 text-ink-950"
      >
        {/* Read bottom-to-top, the way a ticket stub's edge is printed. */}
        <span className="rotate-180 whitespace-nowrap text-body-sm font-extrabold uppercase tracking-widest [writing-mode:vertical-rl]">
          {offerBadge(offer)}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 truncate text-body-lg font-extrabold uppercase tracking-wide text-ink-25">
            {offer.code}
          </p>
          <button
            type="button"
            onClick={() => onApply(offer.code)}
            disabled={blocked}
            aria-label={applied ? `${offer.code} applied` : `Apply ${offer.code}`}
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-body-sm font-extrabold uppercase tracking-wide transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900',
              applied
                ? 'text-success-500'
                : blocked
                  ? 'cursor-not-allowed text-ink-500'
                  : 'text-orange-400 hover:bg-ink-800 active:bg-ink-800',
            )}
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {applied ? (
              <>
                <Check className="size-4" aria-hidden />
                Applied
              </>
            ) : pending ? (
              'Applying'
            ) : (
              'Apply'
            )}
          </button>
        </div>

        <OutcomeLine outcome={outcome} />

        <p className="border-t border-dashed border-ink-700 pt-2 text-caption text-ink-300">
          {describeOffer(offer)}
        </p>
      </div>
    </article>
  );
}

function OutcomeLine({ outcome }: { outcome: OfferOutcome }) {
  if (outcome.kind === 'saves') {
    return (
      <p className="text-body-sm font-semibold text-success-500">
        Save {formatMoney(outcome.amount)} on this order!
      </p>
    );
  }
  // Neutral, never red: the code is fine, it simply does nothing for THIS
  // order — and saying why is worth more than a disabled button alone.
  return (
    <p className="text-body-sm text-ink-400">
      {outcome.kind === 'leaves_nothing'
        ? 'Covers more than this order, so it cannot be applied.'
        : 'Nothing on this order for it to take off.'}
    </p>
  );
}

/**
 * The terms in a sentence, with the ceiling and the end date.
 *
 * The ceiling travels WITH the percentage — "15% off" silently becoming ₹200
 * on a large order is the surprise `max_discount_minor` exists to let an
 * organiser set, and a customer who reads only the first half reads the total
 * as an error.
 */
export function describeOffer(
  offer: Pick<PublicOffer, 'kind' | 'value' | 'max_discount_minor' | 'expires_at'>,
): string {
  const terms =
    offer.kind === 'percent'
      ? `Get ${Math.trunc(offer.value)}% off your tickets${
          offer.max_discount_minor ? `, up to ${formatMoney(offer.max_discount_minor)}` : ''
        }.`
      : `Get ${formatMoney(Math.trunc(offer.value))} off your tickets.`;
  return offer.expires_at ? `${terms} Valid until ${formatEventDate(offer.expires_at)}.` : terms;
}
