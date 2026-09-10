'use client';

import * as React from 'react';
import { BadgePercent, Check, ChevronRight, Loader2, X } from 'lucide-react';
import { formatMoney } from '@/lib/discovery/format';
import type { PublicOffer } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { ApplyCouponSheet } from './apply-coupon-sheet';
import { RuleHeading } from './donation-card';

/**
 * The Offers section on the review screen: one row that opens APPLY COUPON.
 *
 * ── THIS USED TO BE DELIBERATELY ABSENT ───────────────────────────────────
 *
 * `summary-card.tsx` carried the reason for years: "There is no coupon
 * endpoint. An input that always answers 'invalid code' is worse than no input
 * — it implies discounts exist and that you failed to find one." That was
 * right, and it stopped being true when `apps/coupons` shipped. The rule it
 * came from is intact: the control is here BECAUSE something is behind it.
 *
 * ── ONE ROW, AND THE CHOOSING HAPPENS ON ITS OWN SCREEN ───────────────────
 *
 * It was an inline field with the offers listed under it, which put a form and
 * a list inside the payment summary of the screen where somebody is checking
 * a total. The row says what is available and opens a full-screen chooser —
 * the field, and every advertised code drawn as a coupon with what it saves
 * on THIS order — and the review screen stays a review.
 *
 * ── "COUPON & OFFERS", NOT "COUPON & BANK OFFERS" ─────────────────────────
 *
 * The reference this follows says bank offers. This platform has none: Razorpay
 * Checkout is a hosted modal, the instrument is picked inside it, and nothing
 * here knows which bank somebody pays with or holds an offer tied to one. A
 * label promising them would be a promise with nothing behind it — the rule
 * this section began with.
 *
 * ── APPLYING IS THE PREVIEW ───────────────────────────────────────────────
 *
 * There is no "check this code" step. Applying is reversible in one press and
 * the total updates in place, so a separate quote would be a second source of
 * truth for a number the booking already carries. What the chooser shows
 * BEFORE the press ("Save ₹531 on this order!") is the same rule the server
 * applies, mirrored and tested in `lib/booking/coupons.ts` — and the total
 * still moves to whatever the server decided, never to that estimate.
 */
export function CouponCard({
  appliedCode,
  discount,
  offers,
  subtotal,
  donation,
  pending,
  error,
  onApply,
  onClear,
  disabled,
  className,
}: {
  /** The code currently on the booking, or null. */
  appliedCode: string | null;
  /** What it took off, in minor units. */
  discount: number;
  /** Codes the organizer chose to advertise. */
  offers: PublicOffer[];
  /** The TICKET subtotal a code is priced against, in minor units. */
  subtotal: number;
  /** The donation on the booking — it counts toward the ₹1 floor. */
  donation: number;
  pending: boolean;
  /** The server's sentence for the last refusal, shown verbatim. */
  error: string | null;
  onApply: (code: string) => void;
  onClear: () => void;
  /** True while there is no live hold to attach a code to. */
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);

  // Nothing to apply a code to and nothing to advertise — so nothing to draw.
  // The section is absent rather than an empty card, exactly like the gallery
  // and the disclosure rows on the event page.
  if (disabled && !appliedCode && offers.length === 0) return null;

  const count = offers.length;
  const hint = appliedCode
    ? count > 1
      ? `${count} offers for this event`
      : 'Try a different code'
    : count > 0
      ? `${count} ${count === 1 ? 'offer' : 'offers'} available`
      : 'Have a promo code? Enter it here';

  return (
    <section aria-labelledby="coupon-heading" className={cn('flex flex-col gap-3', className)}>
      <RuleHeading id="coupon-heading">Offers</RuleHeading>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        {appliedCode ? (
          <AppliedRow code={appliedCode} discount={discount} pending={pending} onClear={onClear} />
        ) : null}

        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          aria-haspopup="dialog"
          className={cn(
            'flex w-full items-center gap-3 px-card py-card text-left transition-colors',
            'hover:bg-muted/60 active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent',
            appliedCode ? 'border-t border-border' : null,
          )}
        >
          <span
            aria-hidden
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <BadgePercent className="size-5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body font-semibold text-foreground">
              {appliedCode ? 'View all coupons' : 'Apply coupon & offers'}
            </span>
            <span className="truncate text-caption text-muted-foreground">{hint}</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </div>

      {/* A refusal from the chooser is also said HERE, once it has closed —
          otherwise backing out of the sheet after a refused code leaves
          nothing on the review screen saying the discount did not apply. */}
      {error && !open ? (
        <p role="status" className="text-caption text-muted-foreground">
          {error}
        </p>
      ) : null}

      <ApplyCouponSheet
        open={open}
        onOpenChange={setOpen}
        offers={offers}
        appliedCode={appliedCode}
        subtotal={subtotal}
        donation={donation}
        pending={pending}
        error={error}
        disabled={Boolean(disabled)}
        onApply={onApply}
      />
    </section>
  );
}

function AppliedRow({
  code,
  discount,
  pending,
  onClear,
}: {
  code: string;
  discount: number;
  pending: boolean;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-3 bg-success-subtle px-card py-card">
      <span
        aria-hidden
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-success-subtle-foreground shadow-sm"
      >
        <Check className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate text-body font-semibold text-foreground">{code} applied</p>
        {/* The amount, not the terms. "20% off" is what the coupon says; this
            is what it did to THIS order, which is the number the total moved
            by and the only one worth checking against it. */}
        <p className="text-caption text-success-subtle-foreground">
          You saved {formatMoney(discount)}
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        disabled={pending}
        className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-caption font-medium text-muted-foreground transition duration-fast ease-out hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <X className="size-3.5" aria-hidden />
        )}
        Remove
      </button>
    </div>
  );
}

/**
 * What the coupon promises, in one line.
 *
 * The CEILING is stated in the same breath as the percentage, because "20% off"
 * on a large order silently becoming ₹50 is precisely the surprise
 * `max_discount_minor` exists to let an organizer set — and a customer who
 * reads only the first half will read the total as an error.
 */
export function offerTerms(offer: PublicOffer): string {
  if (offer.kind === 'percent') {
    const capped = offer.max_discount_minor
      ? `, up to ${formatMoney(offer.max_discount_minor)}`
      : '';
    return `${offer.value}% off${capped}`;
  }
  return `${formatMoney(offer.value)} off`;
}
