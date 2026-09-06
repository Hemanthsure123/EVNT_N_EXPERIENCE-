'use client';

import * as React from 'react';
import { BadgePercent, Check, Loader2, X } from 'lucide-react';
import { formatMoney } from '@/lib/discovery/format';
import type { PublicOffer } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import { RuleHeading } from './donation-card';

/**
 * The promo-code field on the review screen.
 *
 * ── THIS USED TO BE DELIBERATELY ABSENT ───────────────────────────────────
 *
 * `summary-card.tsx` carried the reason for years: "There is no coupon
 * endpoint. An input that always answers 'invalid code' is worse than no input
 * — it implies discounts exist and that you failed to find one." That was
 * right, and it stopped being true when `apps/coupons` shipped. The rule it
 * came from is intact: the field is here BECAUSE something is behind it.
 *
 * ── WHAT A REFUSAL IS ALLOWED TO SAY ──────────────────────────────────────
 *
 * The server's own sentence, verbatim. Every refusal carries a distinct code —
 * expired, fully claimed, already used, wrong event, covers more than this
 * order — and each sends somebody somewhere different. Collapsing them into
 * "Invalid code" sends them nowhere, which is the state this whole control
 * exists to avoid.
 *
 * ── APPLYING IS THE PREVIEW ───────────────────────────────────────────────
 *
 * There is no "check this code" step. Applying is reversible in one press and
 * the total updates in place, so a separate quote would be a second source of
 * truth for a number the booking already carries — and a quote that disagreed
 * with the charge is the specific failure the money path is built to prevent.
 *
 * ── OFFERS ARE ABSENT, NOT EMPTY ──────────────────────────────────────────
 *
 * Most events run no advertised codes. The list below the field is drawn only
 * when the organizer published one; a blank "Available offers" heading reads as
 * an organizer who forgot. Exhausted, expired and scheduled codes never reach
 * here — the server excludes them, because advertising a discount the checkout
 * will then refuse is worse than showing nothing.
 */
export function CouponCard({
  appliedCode,
  discount,
  offers,
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
  /** Codes the organizer chose to advertise. Empty renders no list. */
  offers: PublicOffer[];
  pending: boolean;
  /** The server's sentence for the last refusal, shown verbatim. */
  error: string | null;
  onApply: (code: string) => void;
  onClear: () => void;
  /** True while the hold is dead or no booking exists yet. */
  disabled?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = React.useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const code = draft.trim();
    if (!code || pending || disabled) return;
    onApply(code);
  };

  // Nothing to type into and nothing to advertise — so nothing to draw. The
  // section is absent rather than an empty card, exactly like the gallery and
  // the disclosure rows on the event page.
  if (disabled && !appliedCode && offers.length === 0) return null;

  return (
    <section aria-labelledby="coupon-heading" className={cn('flex flex-col gap-3', className)}>
      <RuleHeading id="coupon-heading">Offers</RuleHeading>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        {appliedCode ? (
          <AppliedRow
            code={appliedCode}
            discount={discount}
            pending={pending}
            onClear={onClear}
          />
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-2 px-card py-card">
            <label htmlFor="coupon-code" className="text-body-sm text-foreground">
              Have a promo code?
            </label>
            <div className="flex gap-2">
              <Input
                id="coupon-code"
                name="coupon-code"
                value={draft}
                /* Upper-cased as it is typed, because that is how it is stored
                   and how it is printed on the poster it was copied from. The
                   server normalises anyway; this is so the field never looks
                   like it disagreed with what came back. */
                onChange={(changed) => setDraft(changed.target.value.toUpperCase())}
                placeholder="SUMMER20"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                invalid={Boolean(error)}
                aria-describedby={error ? 'coupon-error' : undefined}
                disabled={pending || disabled}
                className="flex-1 font-medium tracking-wide"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={!draft.trim() || pending || disabled}
                className="shrink-0"
              >
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Applying
                  </>
                ) : (
                  'Apply'
                )}
              </Button>
            </div>

            {error ? (
              /* The SERVER's sentence. `role="alert"` because the field looks
                 identical either way — without it, somebody using a screen
                 reader presses Apply and is told nothing at all. */
              <p id="coupon-error" role="alert" className="text-caption text-destructive">
                {error}
              </p>
            ) : null}
          </form>
        )}

        {offers.length ? (
          <OfferList
            offers={offers}
            appliedCode={appliedCode}
            disabled={pending || Boolean(disabled)}
            onUse={(code) => {
              setDraft(code);
              onApply(code);
            }}
          />
        ) : null}
      </div>
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

function OfferList({
  offers,
  appliedCode,
  disabled,
  onUse,
}: {
  offers: PublicOffer[];
  appliedCode: string | null;
  disabled: boolean;
  onUse: (code: string) => void;
}) {
  return (
    <ul className="flex flex-col border-t border-border">
      {offers.map((offer) => {
        const isApplied = appliedCode === offer.code;
        return (
          <li key={offer.id} className="border-b border-border last:border-b-0">
            <div className="flex items-center gap-3 px-card py-3">
              <span
                aria-hidden
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
              >
                <BadgePercent className="size-4" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="truncate text-body-sm font-semibold text-foreground">
                  {offer.code}
                </p>
                <p className="text-caption text-muted-foreground">{offerTerms(offer)}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || isApplied}
                onClick={() => onUse(offer.code)}
                className="shrink-0"
              >
                {isApplied ? 'Applied' : 'Use'}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
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
