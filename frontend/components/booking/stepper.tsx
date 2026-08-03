'use client';

import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-provider';
import { type StepId, stepsFor } from '@/lib/booking/steps';
import { cn } from '@/lib/utils/cn';
import { EASE_OUT } from './motion';
import { useBooking } from './booking-context';

/**
 * Where you are, and how much is left.
 *
 * THE STEP LIST DEPENDS ON AUTH. A signed-in person is shown three steps, not
 * four with one greyed out: a step you will never see is noise, and worse, it
 * makes the journey look longer than it is on the screen where people decide
 * whether to continue.
 *
 * It's a `<nav>` with an ordered list and `aria-current="step"`, so the position
 * is available to a screen reader without relying on colour or a check mark.
 * The connector's fill is the only animated part — the circles change state
 * instantly, because a control that lags behind the navigation reads as broken.
 *
 * ── THE THREE STATES, IN INK ──────────────────────────────────────────────
 *
 * The current step used to be a violet→pink gradient disc wearing a coloured
 * glow. In the light-first language the funnel has exactly one saturated fill —
 * the black CTA pill — and progress chrome is not it. So:
 *
 *   current   filled `bg-cta` disc, `--cta-foreground` numeral. The darkest
 *             (in dark theme, the brightest) mark on the row, which is what
 *             "you are here" should be.
 *   done      the quiet neutral tint (`--secondary`) carrying a check. Legible
 *             at 9.76:1, and unmistakably behind you rather than ahead.
 *   upcoming  hairline ring on the canvas, tertiary ink numeral.
 *
 * The connector fills with `--cta` too, so the completed run of the row reads
 * as one continuous mark rather than as circles joined by a different colour.
 *
 * THE CURRENT STEP'S LABEL IS VISIBLE AT EVERY WIDTH. The others stay hidden
 * below `sm` (four labels do not fit on a 390px screen), but hiding all four
 * left a phone showing bare numbered discs — "3" is not an answer to "where am
 * I in this purchase". One label costs ~60px and the row still fits at 360px.
 */
export function Stepper({ className }: { className?: string }) {
  const { step } = useBooking();
  const { status } = useAuth();
  const reduced = useReducedMotion();

  // While auth is unknown, assume the longer list. Rendering three steps and
  // then inserting a fourth would shift the whole header under the reader.
  const steps = stepsFor(status === 'authenticated');
  const currentIndex = Math.max(
    steps.findIndex((entry) => entry.id === step),
    0,
  );

  return (
    <nav aria-label="Booking progress" className={cn('w-full', className)}>
      <ol className="flex items-center justify-center gap-1 sm:gap-2">
        {steps.map((entry, index) => {
          const state: 'done' | 'current' | 'upcoming' =
            index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming';
          return (
            <li key={entry.id} className="flex min-w-0 items-center gap-1 sm:gap-2">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex size-8 shrink-0 items-center justify-center rounded-full border text-caption font-semibold transition-colors duration-base',
                    state === 'done' && 'border-transparent bg-secondary text-secondary-foreground',
                    state === 'current' &&
                      'border-transparent bg-cta text-cta-foreground shadow-sm',
                    state === 'upcoming' && 'border-border bg-surface text-foreground-subtle',
                  )}
                >
                  {state === 'done' ? <Check className="size-4" /> : index + 1}
                </span>
                <span
                  aria-current={state === 'current' ? 'step' : undefined}
                  className={cn(
                    'min-w-0 truncate text-label transition-colors duration-base sm:block',
                    state === 'current' ? 'block text-foreground' : 'hidden',
                    state === 'upcoming' ? 'text-foreground-subtle' : 'text-foreground',
                  )}
                >
                  {entry.label}
                  <span className="sr-only">
                    {state === 'done' ? ' (completed)' : state === 'current' ? ' (current)' : ''}
                  </span>
                </span>
              </div>

              {index < steps.length - 1 ? (
                <span
                  aria-hidden
                  className="mx-1 h-0.5 w-5 shrink-0 overflow-hidden rounded-full bg-border sm:w-12"
                >
                  <motion.span
                    className="block h-full bg-cta"
                    initial={false}
                    animate={{ scaleX: index < currentIndex ? 1 : 0 }}
                    transition={reduced ? { duration: 0 } : EASE_OUT}
                    style={{ transformOrigin: 'left' }}
                  />
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The step a route declares it is on, for pages that render outside the nav. */
export const isBeyond = (step: StepId, than: StepId, authenticated: boolean) => {
  const order = stepsFor(authenticated).map((entry) => entry.id);
  return order.indexOf(step) > order.indexOf(than);
};
