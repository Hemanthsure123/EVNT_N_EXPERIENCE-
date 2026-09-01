'use client';

import * as React from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import { PhaseBadge, PhaseNotes } from '@/components/pricing/sale-phase';
import type { TicketTier } from '@/lib/api/types';
import { formatFromPrice } from '@/lib/discovery/format';
import { unitPriceFor } from '@/lib/discovery/tiers';
import { cn } from '@/lib/utils/cn';
import { useBooking } from './booking-context';

/**
 * Choosing tickets.
 *
 * ── ONE CARD OF ROWS, NOT A STACK OF CARDS ────────────────────────────────
 *
 * Every tier used to be its own bordered card with its own padding, shadow rung
 * and internal divider — four tiers filled a phone screen and a half, so
 * comparing the second against the fourth meant scrolling between them. They
 * are rows in one card now, separated by hairlines: name and price on the left,
 * the control on the right, four of them visible at once.
 *
 * That is a density change, not a content one. Everything a row EARNED is still
 * on it and still earned:
 *
 * BADGES ARE EARNED, NOT ASSIGNED. "Best value" goes to the tier with the
 * lowest price per ticket that is actually buyable — arithmetic, not marketing
 * — and "Selling fast" only appears when a tier is genuinely near the end of
 * its stock. Neither is decorative, because the moment one of them is, none of
 * them are believed.
 *
 * A LIVE SALE PHASE PRICES THE ROW. The price shown is `effective_price` — what
 * the reserve will actually be billed — with the face price struck through
 * beside it and the phase's own name on a pill, so a total lower than the list
 * price explains itself.
 *
 * SOLD-OUT TIERS STAY VISIBLE and disabled. Knowing the ₹499 tier is gone is
 * what makes the ₹1,099 one make sense; hiding it just makes the event look
 * expensive. The row is dimmed by TEXT TOKEN rather than by `opacity` on the
 * whole row — compositing `--muted-foreground` down lands around 2.9:1 on
 * white, a contrast failure that dark theme happens to hide.
 *
 * ── ADD, THEN A STEPPER ───────────────────────────────────────────────────
 *
 * A minus that cannot go below zero is a control doing nothing beside a number
 * it cannot change, on every tier the buyer has not chosen. One `Add` pill says
 * what the row is FOR; the stepper replaces it once there is a quantity to
 * step, at the same height, so the touch target does not move under the thumb.
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
      <p className="rounded-2xl border border-dashed border-border p-card-lg text-body-sm text-muted-foreground">
        Ticket tiers for this event haven&apos;t been published yet.
      </p>
    );
  }

  return (
    <ul
      aria-label="Ticket types"
      className={cn(
        'flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface',
        className,
      )}
    >
      {tiers.map((tier) => (
        <li key={tier.id}>
          <TierRow
            tier={tier}
            bestValue={tier.id === bestValueId}
            quantity={selection.find((line) => line.tierId === tier.id)?.quantity ?? 0}
            onChange={(update) => setQuantity(tier.id, update)}
          />
        </li>
      ))}
    </ul>
  );
}

function TierRow({
  tier,
  bestValue,
  quantity,
  onChange,
}: {
  tier: TicketTier;
  bestValue: boolean;
  quantity: number;
  onChange: (next: (current: number) => number) => void;
}) {
  const soldOut = tier.available <= 0;
  const disabled = soldOut || !tier.is_on_sale;
  const selected = quantity > 0;
  const max = Math.max(Math.min(tier.max_per_order, tier.available), 0);
  const sellingFast = !soldOut && tier.available <= SELLING_FAST_AT;
  const groupId = `tier-${tier.id}`;
  const phase = tier.current_phase;
  const unitPrice = unitPriceFor(tier);

  // Every secondary fact about the row, so the common case — a name, a price
  // and a button, which is what most tiers are — stays two lines tall.
  const badges = (
    <>
      {phase ? <PhaseBadge name={phase.name} /> : null}
      {bestValue ? (
        <span className="rounded-full bg-nav-active px-2 py-0.5 text-caption text-nav-active-foreground">
          Best value
        </span>
      ) : null}
      {sellingFast ? (
        <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-caption text-warning-subtle-foreground">
          Selling fast
        </span>
      ) : null}
      {soldOut ? (
        <span className="rounded-full bg-destructive-subtle px-2 py-0.5 text-caption text-destructive-subtle-foreground">
          Sold out
        </span>
      ) : null}
    </>
  );

  return (
    <div
      role="group"
      aria-labelledby={`${groupId}-name`}
      className={cn('flex items-start gap-4 p-card', disabled && 'bg-sunken')}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3
            id={`${groupId}-name`}
            className={cn(
              'text-body font-semibold text-foreground',
              // Dimmed by TOKEN, never by opacity on the row — see the note above.
              soldOut && 'text-muted-foreground',
            )}
          >
            {tier.name}
          </h3>
          {badges}
        </div>

        <p className="flex flex-wrap items-baseline gap-2">
          <span
            className={cn(
              'text-body font-semibold tabular-nums text-foreground',
              soldOut && 'text-muted-foreground line-through',
            )}
          >
            {formatFromPrice(unitPrice)}
          </span>
          {/* The face price, struck, only while a phase is actually off it. A
              sold-out tier already strikes the price for a different reason, so
              this would be two strikes saying two different things. */}
          {phase && !soldOut ? (
            <span className="text-caption tabular-nums text-muted-foreground line-through">
              {formatFromPrice(tier.price)}
            </span>
          ) : null}
          {/* Only once there is arithmetic worth showing. At quantity 1 the
              subtotal IS the price already on this line, so printing it again
              is a row that repeats itself. */}
          {quantity > 1 ? (
            <span className="text-caption tabular-nums text-muted-foreground">
              × {quantity} = {formatFromPrice(unitPrice * quantity)}
            </span>
          ) : null}
        </p>

        {/* ── EVERYTHING BELOW IS CONDITIONAL, AND USUALLY ABSENT ──────────
            A tier that is on sale, in stock and self-describing renders none of
            it, which is what keeps the list four rows to a screen. */}
        {disabled || tier.available <= SELLING_FAST_AT || tier.max_per_order < tier.available ? (
          <p className="text-caption text-muted-foreground">
            {soldOut
              ? 'No tickets left in this tier'
              : !tier.is_on_sale
                ? 'Not on sale yet'
                : tier.available <= SELLING_FAST_AT
                  ? `Only ${tier.available} left · up to ${tier.max_per_order} per order`
                  : `Up to ${tier.max_per_order} per order`}
          </p>
        ) : null}

        {/* Not on a tier nobody can buy: `remaining` counts seats inside the
            phase's threshold and `available` counts stock, so a sold-out tier
            can still have phase seats left — and "Only 3 left at this price"
            under "No tickets left in this tier" is a contradiction. */}
        {phase && !disabled ? <PhaseNotes phase={phase} nextPrice={tier.next_price} /> : null}

        {/* ── WHAT THE TIER IS ────────────────────────────────────────────
            The organiser writes `description` and `perks`. A ticket here is not
            exchangeable, so buying the wrong tier is the most expensive mistake
            available on this platform, and "Male Entry" against "Meet and
            Greet" is not enough to tell two apart. Blank is the norm and stays
            absent — an empty line under every row is worse than none. */}
        {tier.description ? (
          <p className="text-caption text-muted-foreground">{tier.description}</p>
        ) : null}
        {tier.perks.length ? (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
            {tier.perks.map((perk) => (
              <li
                key={perk}
                className="inline-flex items-center gap-1 text-caption text-muted-foreground"
              >
                <Check className="size-3 shrink-0 text-success-subtle-foreground" aria-hidden />
                {perk}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="shrink-0 pt-0.5">
        {selected ? (
          <Stepper
            label={tier.name}
            value={quantity}
            max={max}
            disabled={disabled}
            onChange={onChange}
          />
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(() => 1)}
            // NOT "Add one X ticket" — that is the stepper's plus button, and
            // two different controls answering to one name is how a screen
            // reader user, or a test, presses the wrong one.
            aria-label={`Add ${tier.name}`}
            className={cn(
              'inline-flex h-11 min-w-24 items-center justify-center rounded-xl border border-border-strong px-5',
              'text-body-sm font-semibold text-foreground transition-colors duration-fast',
              'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
            )}
          >
            Add
          </button>
        )}
      </div>
    </div>
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
  // it would both write the same number and the second would be lost — which is
  // a bug this funnel actually shipped once, on the money path.
  return (
    // The one filled control in the list, and the reason it is filled: a chosen
    // tier has to be identifiable at a glance in a list of rows that otherwise
    // look identical. It is the ink of the CTA, not a brand colour on a state.
    <div className="flex h-11 items-center gap-1 rounded-xl bg-cta px-1 text-cta-foreground">
      <StepButton
        label={`Remove one ${label} ticket`}
        disabled={disabled || value <= 0}
        onClick={() => onChange((current) => Math.max(current - 1, 0))}
      >
        <Minus className="size-4" aria-hidden />
      </StepButton>
      <output
        aria-label={`${label} quantity`}
        className="min-w-7 text-center text-body font-semibold tabular-nums"
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
      className={cn(
        'inline-flex size-9 items-center justify-center rounded-lg transition-colors duration-fast',
        'hover:bg-cta-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta-foreground/60',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
      )}
    >
      {children}
    </button>
  );
}
