'use client';

import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Minus, Plus } from 'lucide-react';
import { PhaseBadge, PhaseNotes } from '@/components/pricing/sale-phase';
import type { TicketTier } from '@/lib/api/types';
import { formatFromPrice } from '@/lib/discovery/format';
import { tierRank, unitPriceFor } from '@/lib/discovery/tiers';
import { cn } from '@/lib/utils/cn';
import { EASE_OUT } from './motion';
import { useBooking } from './booking-context';

/**
 * Choosing tickets.
 *
 * BADGES ARE EARNED, NOT ASSIGNED. "Best value" goes to the tier with the lowest
 * price per ticket that is actually buyable — arithmetic, not marketing — and
 * "Selling fast" only appears when a tier is genuinely near the end of its
 * stock. Neither is decorative, because the moment one of them is, none of them
 * are believed.
 *
 * A LIVE SALE PHASE PRICES THE ROW. The big number is `effective_price` — what
 * the reserve will actually be billed — with the face price struck through under
 * it and the phase's own name on a pill, so a total lower than the list price
 * explains itself. The subtotal multiplies the same number, because a subtotal
 * that disagrees with the price above it is the funnel's worst possible bug.
 *
 * Sold-out tiers stay VISIBLE and disabled. Knowing the ₹499 tier is gone is
 * what makes the ₹1,099 one make sense; hiding it just makes the event look
 * expensive.
 *
 * Each row is a labelled group containing a radio-like selector and a stepper,
 * rather than one giant button: the quantity control has to be operable without
 * re-selecting the tier, and nesting a button inside a button is invalid anyway.
 *
 * ── SELECTION IS INK, NOT VIOLET ──────────────────────────────────────────
 *
 * A chosen tier is a near-black hairline plus a soft neutral ring and a lift —
 * the same ink the CTA is made of, so choosing and pressing read as one
 * decision. It was `border-primary` + a violet `shadow-glow`, which on a white
 * canvas tinted the page around the card and put brand colour on a state.
 * "Best value" moved to the butter/cream of the active-nav language for the
 * same reason: it is a quiet recommendation, not a promotion.
 *
 * ── RANK IS EXPRESSED IN THE MECHANISM EACH THEME ACTUALLY HAS ────────────
 *
 * `tierRank` gave the top tier `bg-elevated` — which is a real step in dark and
 * a NO-OP in light, where `--elevated`, `--surface` and the canvas are all pure
 * white. So the ladder simply did not exist in the theme that is now the
 * primary one. It is now carried by SHADOW in light (top `shadow-md`, mid
 * `shadow-sm`, entry flat — shadow is how light theme separates) and by VALUE
 * in dark (`bg-elevated` still applies, and is still a measurable rung there).
 * Both are on the card at once; each theme reads the one that works in it.
 *
 * ── SOLD OUT IS DIMMER TEXT, NOT A DIMMED CARD ────────────────────────────
 *
 * An unavailable tier was the whole card at `opacity-60`, which composites
 * `--muted-foreground` down to roughly 2.9:1 on white — a WCAG AA failure that
 * dark theme happened to hide. It is now a `bg-sunken` well with every text
 * token at full strength (7.1:1 and up) and the price struck through, so the
 * state is legible instead of just faint.
 */

/** At or below this many left, a tier is genuinely close to gone. */
const SELLING_FAST_AT = 10;

export function TierPicker({ className }: { className?: string }) {
  const { tiers, selection, setQuantity } = useBooking();

  const buyable = tiers.filter((tier) => tier.is_on_sale && tier.available > 0);
  // Compared on what a buyer would actually PAY, not on the face price — with a
  // phase running they are different numbers, and a "Best value" badge on the
  // tier that is not the cheapest one on the screen is the badge that stops all
  // of them being believed.
  const bestValueId =
    buyable.length > 1
      ? [...buyable].sort((a, b) => unitPriceFor(a) - unitPriceFor(b))[0]?.id
      : undefined;

  if (!tiers.length) {
    return (
      <p className="rounded-xl border border-dashed border-border p-card-lg text-body-sm text-muted-foreground">
        Ticket tiers for this event haven&apos;t been published yet.
      </p>
    );
  }

  return (
    <ul className={cn('flex flex-col gap-stack-lg', className)} aria-label="Ticket types">
      {tiers.map((tier, index) => (
        <li key={tier.id}>
          <TierCard
            tier={tier}
            rank={tierRank(index, tiers.length)}
            bestValue={tier.id === bestValueId}
            quantity={selection.find((line) => line.tierId === tier.id)?.quantity ?? 0}
            onChange={(update) => setQuantity(tier.id, update)}
          />
        </li>
      ))}
    </ul>
  );
}

function TierCard({
  tier,
  rank,
  bestValue,
  quantity,
  onChange,
}: {
  tier: TicketTier;
  rank: ReturnType<typeof tierRank>;
  bestValue: boolean;
  quantity: number;
  onChange: (next: (current: number) => number) => void;
}) {
  const reduced = useReducedMotion();
  const soldOut = tier.available <= 0;
  const disabled = soldOut || !tier.is_on_sale;
  const selected = quantity > 0;
  const max = Math.max(Math.min(tier.max_per_order, tier.available), 0);
  const sellingFast = !soldOut && tier.available <= SELLING_FAST_AT;
  const groupId = `tier-${tier.id}`;
  // What one ticket costs right now. The face price is kept only to strike it
  // through beside the phase price — every arithmetic below uses this one.
  const phase = tier.current_phase;
  const unitPrice = unitPriceFor(tier);

  return (
    <motion.div
      layout={reduced ? false : 'position'}
      transition={EASE_OUT}
      whileHover={disabled || reduced ? undefined : { y: -2 }}
      aria-labelledby={`${groupId}-name`}
      role="group"
      className={cn(
        'relative flex flex-col gap-stack-lg rounded-xl border bg-surface p-card lg:p-card-lg',
        'transition-[border-color,box-shadow] duration-base ease-out',
        // Dark theme reads this rung; in light it resolves to the same white as
        // the card, which is why the shadows below exist.
        rank === 'top' && !disabled && 'bg-elevated',
        !selected && !disabled && (rank === 'top' ? 'shadow-md' : rank === 'mid' && 'shadow-sm'),
        selected
          ? 'border-foreground shadow-md ring-1 ring-foreground/10'
          : 'border-border hover:border-border-strong hover:shadow-md',
        disabled && 'border-border bg-sunken shadow-none hover:border-border hover:shadow-none',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`${groupId}-name`} className="text-body-lg font-semibold text-foreground">
              {tier.name}
            </h3>
            {phase ? <PhaseBadge name={phase.name} /> : null}
            {bestValue ? (
              <span className="rounded-full bg-nav-active px-2.5 py-0.5 text-caption text-nav-active-foreground">
                Best value
              </span>
            ) : null}
            {sellingFast ? (
              <span className="rounded-full bg-warning-subtle px-2.5 py-0.5 text-caption text-warning-subtle-foreground">
                Selling fast
              </span>
            ) : null}
            {soldOut ? (
              <span className="rounded-full bg-destructive-subtle px-2.5 py-0.5 text-caption text-destructive-subtle-foreground">
                Sold out
              </span>
            ) : null}
          </div>
          <p className="text-caption text-muted-foreground">
            {soldOut
              ? 'No tickets left in this tier'
              : !tier.is_on_sale
                ? 'Not on sale yet'
                : tier.available <= SELLING_FAST_AT
                  ? `Only ${tier.available} left · up to ${tier.max_per_order} per order`
                  : `Up to ${tier.max_per_order} per order`}
          </p>
          {/* Not on a tier nobody can buy: `remaining` counts seats inside the
              phase's threshold and `available` counts stock, so a sold-out tier
              can still have phase seats left — and "Only 3 left at this price"
              under "No tickets left in this tier" is a contradiction. */}
          {phase && !disabled ? <PhaseNotes phase={phase} nextPrice={tier.next_price} /> : null}
        </div>

        <p className="shrink-0 text-right">
          <span
            className={cn(
              'block text-h4 tabular-nums text-foreground',
              soldOut && 'text-muted-foreground line-through',
            )}
          >
            {formatFromPrice(unitPrice) === 'Free' ? 'Free' : formatFromPrice(unitPrice)}
          </span>
          {/* The face price, struck, only while a phase is actually off it. A
              sold-out tier already strikes the price above for a different
              reason, so this line would be two strikes saying two things. */}
          {phase && !soldOut ? (
            <span className="block text-caption tabular-nums text-muted-foreground line-through">
              {formatFromPrice(tier.price)}
            </span>
          ) : null}
          <span className="text-caption text-muted-foreground">per ticket</span>
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border pt-stack-lg">
        <span className="text-body-sm text-muted-foreground">
          {selected ? (
            <>
              Subtotal{' '}
              <span className="font-semibold tabular-nums text-foreground">
                {formatFromPrice(unitPrice * quantity)}
              </span>
            </>
          ) : (
            'Choose a quantity'
          )}
        </span>

        <Stepper
          label={tier.name}
          value={quantity}
          max={max}
          disabled={disabled}
          onChange={onChange}
        />
      </div>
    </motion.div>
  );
}

function Stepper({
  label,
  value,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  disabled: boolean;
  onChange: (next: (current: number) => number) => void;
}) {
  // Each press is expressed as a CHANGE to whatever the quantity is at the
  // moment it lands, never as "the number I last rendered, plus one". The
  // rendered value trails the URL by a render, so two quick taps computed from
  // it would both write the same number and the second would be lost.
  return (
    // `bg-sunken`, not `bg-background`: on a white canvas the page and the card
    // are the same value, so an inset control has to step DOWN to read as a
    // well. That is the one value move the light theme has.
    <div className="flex items-center gap-1 rounded-full border border-border bg-sunken p-1">
      <StepButton
        label={`Remove one ${label} ticket`}
        disabled={disabled || value <= 0}
        onClick={() => onChange((current) => Math.max(current - 1, 0))}
      >
        <Minus className="size-4" aria-hidden />
      </StepButton>
      <output
        aria-label={`${label} quantity`}
        className="min-w-10 text-center text-body font-semibold tabular-nums text-foreground"
      >
        {value}
      </output>
      <StepButton
        label={`Add one ${label} ticket`}
        disabled={disabled || value >= max}
        onClick={() => onChange((current) => Math.min(current + 1, max))}
      >
        <Plus className="size-4" aria-hidden />
      </StepButton>
    </div>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      // 44px, the brief's minimum touch target — and the reason the stepper is
      // the tallest thing in the row rather than an afterthought beside a price.
      className={cn(
        'inline-flex size-11 items-center justify-center rounded-full text-foreground',
        'transition duration-fast ease-out hover:bg-muted active:scale-95',
        'disabled:pointer-events-none disabled:opacity-40',
        'motion-reduce:transition-none motion-reduce:active:scale-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      {children}
    </button>
  );
}
