'use client';

import * as React from 'react';
import { PawPrint } from 'lucide-react';
import { formatFromPrice } from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';

/**
 * Add a meal for a street dog to this order.
 *
 * ── WHAT THIS SAYS IS WHAT ACTUALLY HAPPENS ───────────────────────────────
 *
 * The amount is added to the booking's total, charged with the ticket, retained
 * by the platform and excluded from the organizer's payout. That is the whole
 * mechanism, and the copy here does not claim anything beyond it: no registered
 * charity, no tax receipt, no running total of meals served. Every one of those
 * would be a number or a status with nothing behind it, on the screen where
 * somebody is being asked for money.
 *
 * `₹15 = one meal` is the one claim, and it is the operator's to stand behind.
 * It is a constant here rather than prose so the chip's badge and the
 * explanatory line can never drift apart.
 *
 * ── THE AMOUNTS ARE OPT-IN AND UN-PRESELECTED ─────────────────────────────
 *
 * Nothing is chosen by default. A donation pre-added to a total is the pattern
 * that gets called out as a dark pattern, and rightly — the money is taken from
 * people who did not notice. Pressing a selected chip again clears it, so the
 * control that adds is also the control that removes, with no hunting for an X.
 *
 * ── AND IT IS NOT REFUNDED ────────────────────────────────────────────────
 *
 * Stated on the card, before the press, in the same size as everything else.
 * A gift that quietly does not come back with a refund is exactly the kind of
 * thing a checkout should say out loud rather than bury in terms.
 */

/** What the operator undertakes one meal to cost. */
const MEAL_MINOR = 1_500;
const PRESET_MINOR = [500, 1_000, MEAL_MINOR] as const;

export function DonationCard({
  value,
  onChange,
  disabled,
  maxMinor,
  className,
}: {
  /** Currently chosen amount in minor units; 0 means none. */
  value: number;
  onChange: (minor: number) => void;
  disabled?: boolean;
  /** Mirrors the backend's `DONATION_MAX_MINOR`. */
  maxMinor: number;
  className?: string;
}) {
  const [customOpen, setCustomOpen] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const customActive = value > 0 && !PRESET_MINOR.includes(value as (typeof PRESET_MINOR)[number]);

  // A chip that is already chosen clears the donation. One control, both ways.
  const choose = (minor: number) => {
    setCustomOpen(false);
    onChange(value === minor ? 0 : minor);
  };

  const commitCustom = () => {
    // Rupees in the box, paise on the wire — the whole codebase is integer
    // minor units and this is the one place a person types a major one.
    const rupees = Number(draft.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(rupees) || rupees <= 0) {
      onChange(0);
      setCustomOpen(false);
      return;
    }
    onChange(Math.min(Math.round(rupees * 100), maxMinor));
    setCustomOpen(false);
  };

  return (
    <section aria-labelledby="donation-heading" className={cn('flex flex-col gap-3', className)}>
      <RuleHeading id="donation-heading">Feed a street dog</RuleHeading>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        {/* The band the reference fills with a licensed illustration. Ours is
            drawn from tokens: a photograph we do not have the rights to would
            be a worse answer than a shape we do. */}
        <div className="flex items-center gap-3 bg-gradient-to-r from-primary/12 via-primary/5 to-transparent px-card py-4">
          <span
            aria-hidden
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-primary shadow-sm"
          >
            <PawPrint className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col">
            <p className="text-body font-semibold text-foreground">
              Add a meal for a street dog
            </p>
            <p className="text-caption text-muted-foreground">
              {formatFromPrice(MEAL_MINOR)} feeds one dog for a day. Added to this order and
              passed on by us.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-border px-card py-card">
          <p className="text-body-sm text-foreground">
            Donate with{' '}
            <span className="underline decoration-dotted underline-offset-4">this order</span>
          </p>

          <div className="flex gap-2" role="group" aria-label="Donation amount">
            {PRESET_MINOR.map((minor) => (
              <Chip
                key={minor}
                selected={value === minor}
                disabled={disabled}
                badge={minor === MEAL_MINOR ? '1 meal' : undefined}
                onClick={() => choose(minor)}
              >
                {formatFromPrice(minor)}
              </Chip>
            ))}
            <Chip
              selected={customActive || customOpen}
              disabled={disabled}
              onClick={() => {
                setDraft(customActive ? String(value / 100) : '');
                setCustomOpen((open) => !open);
              }}
            >
              {customActive ? formatFromPrice(value) : 'Custom'}
            </Chip>
          </div>

          {customOpen ? (
            <div className="flex items-center gap-2">
              <label htmlFor="donation-custom" className="sr-only">
                Custom donation amount in rupees
              </label>
              <div className="flex h-11 flex-1 items-center gap-1 rounded-xl border border-input bg-surface px-3">
                <span aria-hidden className="text-body text-muted-foreground">
                  ₹
                </span>
                <input
                  id="donation-custom"
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitCustom();
                    }
                  }}
                  placeholder="50"
                  className="w-full bg-transparent text-body tabular-nums text-foreground outline-none placeholder:text-foreground-subtle"
                />
              </div>
              <button
                type="button"
                onClick={commitCustom}
                className="inline-flex h-11 items-center rounded-xl border border-border-strong px-4 text-body-sm font-semibold text-foreground transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Add
              </button>
            </div>
          ) : null}

          {/* Said before the press, not after. */}
          <p className="text-caption text-muted-foreground">
            A donation is not refunded if you cancel — unless the booking never
            issues a ticket, in which case everything comes back.
          </p>
        </div>
      </div>
    </section>
  );
}

function Chip({
  selected,
  disabled,
  badge,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  badge?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        // No `min-w`: four chips plus their gaps have to fit one row on a
        // 390px screen, and a floor wide enough for "Custom" made "₹5" the same
        // width and wrapped the fourth onto a line of its own.
        'relative inline-flex h-11 flex-1 items-center justify-center rounded-xl border px-3',
        'text-body-sm font-semibold transition-colors duration-fast',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-transparent bg-cta text-cta-foreground'
          : 'border-border-strong text-foreground hover:bg-muted',
      )}
    >
      {badge ? (
        <span
          className={cn(
            'absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide',
            selected ? 'bg-cta-foreground text-cta' : 'bg-primary text-primary-foreground',
          )}
        >
          {badge}
        </span>
      ) : null}
      {children}
    </button>
  );
}

/**
 * The reference's centred `— SECTION —` rule.
 *
 * Exported because the review screen uses the same treatment for its payment
 * summary and invoice blocks, and three hand-built copies of a rule with a
 * label in it is three chances for the hairlines to sit at different heights.
 */
export function RuleHeading({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="h-px flex-1 bg-border" aria-hidden />
      <h2 id={id} className="text-caption uppercase tracking-[0.14em] text-muted-foreground">
        {children}
      </h2>
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}
