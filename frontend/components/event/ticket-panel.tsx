'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Check, Info, Loader2, Minus, Plus, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PhaseBadge, PhaseNotes } from '@/components/pricing/sale-phase';
import { fetchEventTiers } from '@/lib/api/events';
import type { TicketTier } from '@/lib/api/types';
import { formatFromPrice } from '@/lib/discovery/format';
import {
  type AvailabilityState,
  availabilityLabel,
  isUrgent,
  summariseTiers,
  tierRank,
  unitPriceFor,
} from '@/lib/discovery/tiers';
import { cn } from '@/lib/utils/cn';

/**
 * Choose a tier, choose a quantity, see the total.
 *
 * INVENTORY IS NEVER CACHED. The fetch is `no-store` (see `fetchEventTiers`),
 * `staleTime` is zero, and it refetches whenever the tab regains focus and once
 * a minute while it's open. Everything else public on this site rides a shared
 * 30-second clock; this is the one read where a stale number has a cost measured
 * in money — a cached "2 left" sells a ticket that doesn't exist, and a cached
 * "sold out" turns away someone who could have bought one.
 *
 * The server hands over the first response as `initialData`, so the panel paints
 * with real numbers instead of a spinner, and the client immediately verifies
 * them. No layout shift, no stale figure.
 *
 * A LIVE SALE PHASE IS THE PRICE, and the face price is struck through beside
 * it. `effective_price` comes from the same rule the locked reserve uses to
 * decide what to CHARGE, so the number here is the number the funnel quotes and
 * the lock bills; `price` is only what the phase is off. Everything else the
 * phase says — how many seats are left at it, when it lifts — is rendered by
 * `components/pricing/sale-phase.tsx` and only from fields the backend actually
 * sent (see its header): no count without `remaining`, no clock without
 * `ends_at`.
 *
 * TIERS ARE DISTINGUISHED BY ELEVATION AND RANK, not by colour. Rank comes from
 * PRICE ORDER, not from the tier's name — "Basic/Gold/Premium" is one
 * organiser's vocabulary and the next one will say "Early bird/Regular", so
 * anything keyed on the words would quietly stop working. The top tier gets a
 * ring and a raised surface; the entry tier stays flat. Sold-out tiers remain
 * visible and disabled, because knowing the ₹499 tier is gone is what makes the
 * ₹1,099 one make sense.
 *
 * ELEVATION IS EXPRESSED TWICE, ON PURPOSE — `bg-elevated` moves the top tier
 * up a rung of the dark theme's value ladder, and the paired shadow is what
 * carries the same step in light, where every surface is already white and
 * nothing can separate by value. Dropping either half makes the ranking
 * invisible in one of the two themes.
 *
 * ONE CTA PER VIEWPORT, AND IT IS THE BLACK PILL. "Book tickets" is the single
 * primary action on this page: near-black fill in light, near-white in dark
 * (`--cta`, which inverts — `--on-gradient` would be white in both and
 * invisible on the dark pill). Everything else here is a hairline control or
 * plain text, so nothing competes with it. The desktop rail is `hidden lg:flex`,
 * the mobile bar is `lg:hidden`, and the mobile bar's button scrolls to this
 * panel rather than being a second checkout entry point.
 */

const REFRESH_MS = 60_000;

export function TicketPanel({
  eventId,
  initialTiers,
  className,
  preview = false,
}: {
  eventId: string;
  /** The server's first response — real numbers on first paint. */
  initialTiers: TicketTier[];
  className?: string;
  /**
   * Rendered inside the Studio's preview of an unpublished draft.
   *
   * Two things have to stop: the live availability poll (a draft's tiers may
   * not exist on the server at all, so the request would 404 in a loop), and
   * the buy action (there is nothing to buy yet). Everything else — the tier
   * rows, prices, phase badges, the sold-out and urgency states — renders
   * exactly as a visitor will see it, which is the whole point of the preview.
   */
  preview?: boolean;
}) {
  const query = useQuery({
    queryKey: ['event-tiers', eventId],
    queryFn: () => fetchEventTiers(eventId),
    initialData: { data: initialTiers },
    staleTime: 0,
    // A preview holds the draft's own tiers and must never ask the server for
    // them: `enabled: false` keeps `initialData` as the answer forever.
    enabled: !preview,
    refetchOnWindowFocus: !preview,
    refetchInterval: preview ? false : REFRESH_MS,
  });

  const summary = summariseTiers(query.data?.data);
  const { tiers, state } = summary;

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [quantity, setQuantity] = React.useState(1);

  // Default to the cheapest tier that can actually be bought. Re-runs when
  // inventory changes, so a tier selling out under the reader moves the
  // selection on rather than leaving them on a dead option.
  const firstSellable = tiers.find((tier) => tier.is_on_sale && tier.available > 0) ?? null;
  const selected = tiers.find((tier) => tier.id === selectedId) ?? firstSellable;

  React.useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  const maxQuantity = selected
    ? Math.max(Math.min(selected.max_per_order, selected.available), 1)
    : 1;
  React.useEffect(() => {
    setQuantity((current) => Math.min(current, maxQuantity));
  }, [maxQuantity]);

  // The EFFECTIVE price, so the total on this panel is the total the funnel will
  // quote and the lock will charge. `price` here is the face price a phase is
  // off, and multiplying it would overstate a discounted order by the discount.
  const total = selected ? unitPriceFor(selected) * quantity : 0;

  return (
    <section
      id="tickets"
      aria-label="Tickets"
      className={cn(
        // On a white canvas a white card cannot separate by value: the hairline
        // and the shadow are the elevation. Both are required together.
        'flex flex-col gap-5 rounded-xl border border-border bg-surface p-card shadow-md lg:p-card-lg',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-h4">Tickets</h2>
          <AvailabilityLine state={state} refreshing={query.isFetching} />
        </div>
        {summary.sold > 0 ? (
          // Real bookings, summed from the tiers' own `sold` column. No
          // "interested" count and no rating: nothing on this platform records
          // either, so there is nothing to show.
          <p className="shrink-0 text-right text-caption text-muted-foreground">
            <span className="block text-body font-semibold tabular-nums text-foreground">
              {summary.sold.toLocaleString('en-IN')}
            </span>
            booked
          </p>
        ) : null}
      </div>

      {tiers.length ? (
        <ul className="flex flex-col gap-3">
          {tiers.map((tier, index) => (
            <li key={tier.id}>
              <TierOption
                tier={tier}
                rank={tierRank(index, tiers.length)}
                selected={selected?.id === tier.id}
                onSelect={() => {
                  setSelectedId(tier.id);
                  setQuantity(1);
                }}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-border bg-sunken p-card text-body-sm text-muted-foreground">
          Ticket tiers for this event haven&apos;t been published yet. Check back closer to the
          date.
        </p>
      )}

      {selected ? (
        <>
          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <div className="flex flex-col">
              <span className="text-body-sm text-muted-foreground">Quantity</span>
              <span className="text-caption text-foreground-subtle">
                Up to {maxQuantity} per order
              </span>
            </div>
            <Stepper value={quantity} max={maxQuantity} onChange={setQuantity} />
          </div>

          {/* The total is the last number read before the press, so it steps up
              to h3 — the CTA below it and this line are the only two things in
              the panel competing for the eye. */}
          <div className="flex items-end justify-between gap-4">
            <span className="text-body-sm text-muted-foreground">Total</span>
            <span className="text-h3 tabular-nums text-foreground">
              {formatFromPrice(total) ?? '—'}
            </span>
          </div>
        </>
      ) : null}

      {/*
        The way into checkout. The chosen tier and quantity ride along in the
        query string, so the funnel opens on exactly what was picked here rather
        than making someone choose twice.
      */}
      <div className="flex flex-col gap-2">
        {preview ? (
          // The real control, inert. Rendering the live pill would offer a
          // checkout for an event that does not exist yet; hiding it would
          // misrepresent the page being previewed. So it keeps its size and
          // position — the thing the preview exists to show — and says why it
          // cannot be pressed.
          <Button
            size="lg"
            disabled
            className="h-control-lg w-full rounded-full bg-cta px-pill-lg text-cta-foreground"
          >
            Book tickets
          </Button>
        ) : state.kind === 'sold_out' || !selected ? (
          <Button
            size="lg"
            variant="outline"
            disabled
            className="h-control-lg w-full rounded-full px-pill-lg"
          >
            {state.kind === 'sold_out' ? 'Sold out' : 'Book tickets'}
          </Button>
        ) : (
          // The black pill, spelled out here rather than inherited: `--cta` is
          // the primary-action token and it INVERTS per theme, where the shared
          // Button's `primary` variant is the wayfinding violet.
          <Button
            size="lg"
            asChild
            className={cn(
              'h-control-lg w-full rounded-full px-pill-lg',
              'bg-cta text-cta-foreground hover:bg-cta-hover active:bg-cta-active',
            )}
          >
            <Link href={`/booking/${eventId}?tickets=${selected.id}:${quantity}`}>
              Book tickets
            </Link>
          </Button>
        )}
        <p className="flex items-start gap-2 text-caption text-foreground-subtle">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {preview
            ? 'Preview — this is how the panel will look once the event is live.'
            : 'Availability is re-checked when you book — nothing is held until then.'}
        </p>
      </div>

      <p className="flex items-center gap-2 border-t border-border pt-4 text-caption text-foreground-subtle">
        <ShieldCheck className="size-4 shrink-0" aria-hidden />
        Every ticket is a signed QR code, scanned once at the gate.
      </p>
    </section>
  );
}

function AvailabilityLine({
  state,
  refreshing,
}: {
  state: AvailabilityState;
  refreshing: boolean;
}) {
  const label = availabilityLabel(state);
  if (!label) return null;
  return (
    <p
      className={cn(
        'inline-flex items-center gap-1.5 text-body-sm',
        state.kind === 'sold_out'
          ? 'text-destructive-subtle-foreground'
          : isUrgent(state)
            ? 'text-warning-subtle-foreground'
            : 'text-muted-foreground',
      )}
      // Polite, so someone hearing the page learns a tier sold out without
      // having the announcement interrupt what they were reading.
      role="status"
      aria-live="polite"
    >
      {label}
      {refreshing ? <Loader2 className="size-3 animate-spin opacity-60" aria-hidden /> : null}
    </p>
  );
}

function TierOption({
  tier,
  rank,
  selected,
  onSelect,
}: {
  tier: TicketTier;
  rank: ReturnType<typeof tierRank>;
  selected: boolean;
  onSelect: () => void;
}) {
  const soldOut = tier.available <= 0;
  const disabled = soldOut || !tier.is_on_sale;
  // The live phase price is THE price; the face price is only shown alongside it,
  // struck through, so the discount is visible as a discount. With no phase
  // running there is one number and nothing to strike.
  const phase = tier.current_phase;
  const price = formatFromPrice(unitPriceFor(tier));
  const facePrice = phase ? formatFromPrice(tier.price) : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        // A tier sits INSIDE the panel, so its radius is one rung below the
        // card's — nesting the same radius twice reads as a rendering mistake.
        'flex min-h-control w-full items-center justify-between gap-4 rounded-lg border p-4 text-left',
        'transition duration-fast ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        // Elevation carries the hierarchy, not colour: the top tier sits on a
        // raised surface (a value step in dark, a shadow in light — light has
        // nowhere lighter than white to go), the entry tier stays flat.
        rank === 'top' && !disabled && 'bg-elevated shadow-md',
        rank === 'mid' && !disabled && 'bg-surface shadow-sm',
        // A selected hairline is a sanctioned use of the wayfinding violet; the
        // black pill stays reserved for the one primary ACTION below.
        selected && !disabled
          ? 'border-primary ring-2 ring-primary/30'
          : 'border-border hover:border-border-strong',
        disabled && 'cursor-not-allowed opacity-55',
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-body font-semibold text-foreground">{tier.name}</span>
          {phase ? <PhaseBadge name={phase.name} /> : null}
          {selected && !disabled ? (
            <Check className="size-4 shrink-0 text-primary" aria-hidden />
          ) : null}
        </span>
        <span className="text-caption text-muted-foreground">
          {soldOut
            ? 'Sold out'
            : !tier.is_on_sale
              ? 'Not on sale'
              : tier.available <= 10
                ? `Only ${tier.available} left`
                : 'Available'}
        </span>
        {/* Not on a tier nobody can buy: `remaining` counts seats inside the
            phase's threshold and `available` counts stock, so a sold-out tier
            can still have phase seats left — and "Only 3 left at this price"
            under the word "Sold out" is a contradiction, not a nudge. */}
        {phase && !disabled ? <PhaseNotes phase={phase} nextPrice={tier.next_price} /> : null}
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-body font-semibold tabular-nums text-foreground">
          {price === 'Free' ? 'Free' : price}
        </span>
        {facePrice ? (
          <span className="block text-caption tabular-nums text-muted-foreground line-through">
            {facePrice}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function Stepper({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    // `border-input`, not `border-border`: a stepper is a control, and a
    // control's boundary is its only affordance, so it clears 3:1 rather than
    // the 1.27:1 a decorative hairline gets away with.
    <div className="flex items-center gap-1 rounded-full border border-input p-1">
      <StepButton
        label="Decrease quantity"
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <Minus className="size-4" aria-hidden />
      </StepButton>
      <output className="min-w-8 text-center text-body font-semibold tabular-nums">{value}</output>
      <StepButton
        label="Increase quantity"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
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
        // 44px: the touch-target floor. It was 32px, which is a miss on a
        // phone and this is the control immediately above the money.
        'inline-flex size-11 items-center justify-center rounded-full text-foreground',
        'transition-colors duration-fast hover:bg-muted',
        'disabled:pointer-events-none disabled:opacity-40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      {children}
    </button>
  );
}
