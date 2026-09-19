'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import {
  PROVIDER_BLURBS,
  PROVIDER_LABELS,
  type PaymentProvider,
} from '@/lib/booking/payment-provider';
import { cn } from '@/lib/utils/cn';
import { GatewayLogo } from './gateway-logo';

/**
 * "Pay using — Cashfree ⌄". The one control on the checkout that chooses a
 * payment gateway.
 *
 * ── THIS FILE REVERSES A DELIBERATE DECISION, SO HERE IS THE HISTORY ──────
 *
 * `PayUsing` used to be plain text, and its comment said why: the reference
 * design put a method picker here (`Pay Using ⌄ / Jupiter UPI`), we had no
 * second thing to pick, and "a chevron on this origin promising a choice we
 * cannot honour is a control that lies about what pressing it does — on the
 * last screen before money moves, of all places."
 *
 * That rule is INTACT. What changed is the fact underneath it: there are two
 * gateways now, the server says which are on offer, and pressing this really
 * does move the order. The chevron appears only when
 * `selectableProviders()` returns more than one — so on a single-gateway
 * deployment this renders as exactly the text it always did, with no
 * affordance at all. It is the same rule the coupon field followed: the input
 * exists BECAUSE something is behind it.
 *
 * ── A BOTTOM SHEET ON A PHONE, A POPOVER ON A POINTER ─────────────────────
 *
 * Built on Radix's Dialog — the same base as `DetailSheet` — so the focus
 * trap, Escape, the inert background and `aria-modal` are the library's rather
 * than a re-implementation. Two hand-rolled dropdowns on a checkout is two
 * sets of focus bugs on the money path.
 *
 * The shape differs by viewport because the ergonomics do: this control lives
 * in a sticky bar at the BOTTOM of a phone, so a menu hanging below it has
 * nowhere to go and a centred dialog puts its rows where a thumb cannot reach.
 * Below `sm` it is a bottom sheet that rises from the same edge the trigger
 * sits on. From `sm` up it is a compact card anchored above the bar, which is
 * what a pointer expects of a `⌄`.
 *
 * ── WHY IT DOES NOT USE `@radix-ui/react-select` ──────────────────────────
 *
 * That primitive renders a native-shaped listbox whose rows are a line of text
 * each. These rows carry a logo, a name and a sentence, at a 56px touch
 * target — and the mobile presentation is a sheet, not a listbox. Radix's
 * Select would fight all three.
 */

export type PaymentSelectorProps = {
  /** What the checkout is currently set to pay with. */
  value: PaymentProvider;
  /**
   * The gateways on offer, from the server. One entry (or none) renders plain
   * text and no chevron — see the note above.
   */
  options: readonly PaymentProvider[];
  /**
   * Called with the chosen gateway. The caller re-issues the payment order
   * against it and only then is the choice real; this component never claims
   * the switch succeeded on its own.
   */
  onSelect: (provider: PaymentProvider) => void;
  /**
   * A switch is in flight. The trigger keeps showing the PENDING selection
   * with a spinner rather than reverting — reverting mid-request reads as the
   * press having been ignored, and somebody presses again.
   */
  busy?: boolean;
  /** Blocks opening the menu — e.g. while the order is being re-issued. */
  disabled?: boolean;
  className?: string;
};

export function PaymentSelector({
  value,
  options,
  onSelect,
  busy = false,
  disabled = false,
  className,
}: PaymentSelectorProps) {
  const [open, setOpen] = React.useState(false);

  const label = PROVIDER_LABELS[value] ?? value;
  const isDemo = value === 'fake';
  const caption = isDemo ? 'No provider connected' : 'Pay using';

  // ── NOTHING TO CHOOSE: THE ORIGINAL CONTROL, UNCHANGED ─────────────────
  //
  // Not a disabled button. A disabled control still says "there is a choice
  // here and you may not make it", which is a different and wronger claim than
  // "this is who handles the payment".
  if (options.length < 2) {
    return (
      <div className={cn('flex min-w-0 flex-col', className)}>
        <span className="text-caption text-muted-foreground">{caption}</span>
        <span className="truncate text-body-sm font-semibold text-foreground">{label}</span>
      </div>
    );
  }

  const trigger = (
    <DialogPrimitive.Trigger
      disabled={disabled}
      aria-label={`Pay using ${label}. Change payment method`}
      className={cn(
        'group flex min-w-0 items-center gap-2.5 rounded-xl px-2 py-1.5 -mx-2 text-left',
        // A real touch target. `min-h-control` IS the 44px floor, named in
        // tokens so it cannot drift; the padding above takes the pressable box
        // there without moving the layout.
        'min-h-control touch-manipulation',
        'transition-colors duration-200',
        'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
    >
      <GatewayLogo provider={value} size={28} className="rounded-lg" />
      <span className="flex min-w-0 flex-col">
        <span className="text-caption text-muted-foreground">{caption}</span>
        <span className="flex items-center gap-1">
          <span className="truncate text-body-sm font-semibold text-foreground">{label}</span>
          {busy ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <ChevronDown
              aria-hidden
              className={cn(
                'size-4 shrink-0 text-muted-foreground',
                // The chevron turns with the menu. 200ms, the same curve as
                // the sheet, so the two read as one movement.
                'transition-transform duration-200 ease-out',
                'group-data-[state=open]:rotate-180',
              )}
            />
          )}
        </span>
      </span>
    </DialogPrimitive.Trigger>
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
      {trigger}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-modal bg-overlay/60 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            'duration-200',
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed z-modal flex flex-col gap-1 bg-elevated text-foreground shadow-xl',
            'focus:outline-none',
            // ── PHONE: a sheet from the bottom edge ──────────────────────
            // It rises from the same edge the trigger sits on, so the menu
            // and the control that opened it are never on opposite sides of
            // the screen. It clears the gesture inset itself.
            'inset-x-0 bottom-0 rounded-t-3xl border-t border-border p-2 pb-[calc(0.5rem_+_env(safe-area-inset-bottom))]',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom',
            'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom',
            // ── POINTER: a compact card, still anchored to the bar ───────
            'sm:inset-x-auto sm:bottom-payment-menu',
            'sm:left-1/2 sm:w-[min(22rem,calc(100vw-2rem))] sm:-translate-x-1/2',
            'sm:rounded-2xl sm:border',
            'sm:data-[state=open]:slide-in-from-bottom-2 sm:data-[state=closed]:slide-out-to-bottom-2',
            'duration-200 ease-out',
          )}
        >
          {/* The grab handle is decoration on a sheet nobody drags — it is the
              affordance that says "this came from the bottom", and it is
              hidden from assistive tech and from pointer widths where the
              shape is a card instead. */}
          <div
            aria-hidden
            className="mx-auto mb-1 mt-1.5 h-1 w-10 rounded-full bg-border-strong sm:hidden"
          />

          <DialogPrimitive.Title className="px-3 pb-1 pt-1 text-caption font-medium uppercase tracking-wide text-muted-foreground">
            Pay using
          </DialogPrimitive.Title>
          {/* Radix warns without one, and a sheet on a checkout should say what
              choosing does — the instrument itself is picked inside the
              provider's own modal, and that is worth stating here rather than
              letting somebody expect a card form on the next press. */}
          <DialogPrimitive.Description className="px-3 pb-1 text-caption text-muted-foreground">
            You&rsquo;ll choose UPI, card or netbanking inside their secure checkout.
          </DialogPrimitive.Description>

          <div role="radiogroup" aria-label="Payment gateway" className="flex flex-col">
            {options.map((option) => {
              const active = option === value;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setOpen(false);
                    // Re-selecting the current gateway is a no-op for the
                    // caller, which is right: the server treats an unchanged
                    // gateway as the REPAIR for a hold whose order call
                    // failed, so the press must still reach it.
                    onSelect(option);
                  }}
                  className={cn(
                    'flex w-full items-center gap-3.5 rounded-2xl px-3 text-left',
                    // Generous by intent. `py-3` around a 34px mark lands the
                    // row near 58px — comfortably past the touch floor, which
                    // `min-h-control-lg` then guarantees even for a row whose
                    // blurb is missing. This is a control somebody presses once
                    // while holding a phone in one hand, on a train.
                    'min-h-control-lg py-3 touch-manipulation',
                    'transition-colors duration-150',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'bg-muted' : 'hover:bg-muted/60',
                  )}
                >
                  <GatewayLogo provider={option} size={34} className="rounded-xl" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body-sm font-semibold text-foreground">
                      {PROVIDER_LABELS[option] ?? option}
                    </span>
                    <span className="truncate text-caption text-muted-foreground">
                      {PROVIDER_BLURBS[option]}
                    </span>
                  </span>
                  {/* The tick carries the state, not colour alone — the two
                      rows are otherwise distinguished only by a background
                      tint, which is exactly what a low-contrast screen in
                      daylight loses first. */}
                  <span
                    className={cn(
                      'ml-auto flex size-6 shrink-0 items-center justify-center rounded-full',
                      'transition-all duration-200',
                      active
                        ? 'bg-foreground text-background scale-100'
                        : 'border border-border-strong scale-90 opacity-0',
                    )}
                  >
                    {active ? <Check className="size-3.5" aria-hidden strokeWidth={3} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
