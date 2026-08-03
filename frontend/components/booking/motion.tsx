'use client';

import * as React from 'react';
import { type Transition, motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils/cn';
import { useBooking } from './booking-context';

/**
 * The funnel's motion vocabulary, defined once.
 *
 * Framer Motion is used HERE and nowhere else in the app, for the two things
 * CSS genuinely can't do well: animating to an unknown height (the summary card
 * changes content on every step) and interpolating a number. Everything else on
 * this site animates with the design system's own `duration-*` / `ease-spring`
 * utilities, and that stays true inside the funnel too — reaching for a library
 * to fade a button would put ~35KB on the highest-intent route to replace one
 * line of CSS.
 *
 * The brief's rules, encoded: 200–300ms, easeOut, never a bounce. A checkout
 * that springs and overshoots reads as playful, and playful is not what someone
 * wants from the screen where they type a card number.
 *
 * Every component here collapses to no motion under `prefers-reduced-motion`,
 * via Framer's own hook rather than a media query, so the same instant applies
 * to layout animations that CSS can't reach.
 *
 * NOTHING ANIMATES ON ARRIVAL. Entrance transitions run only after a step
 * change, never on the first screen of a session — an element that starts at
 * `opacity: 0` is not eligible to be the Largest Contentful Paint, so fading the
 * first step in deferred the whole page's LCP until hydration had finished.
 * Measured: 4.9s versus content that actually painted at 1.7s. The same rule is
 * already documented for the discovery layer's `Reveal`; this is the funnel
 * paying attention to it.
 */

export const EASE_OUT: Transition = { duration: 0.24, ease: [0.16, 1, 0.3, 1] };
export const EASE_OUT_SLOW: Transition = { duration: 0.3, ease: [0.16, 1, 0.3, 1] };

/** Fade + 12px rise, for cards entering. Staggered by `index` within a group. */
export function Rise({
  children,
  index = 0,
  className,
}: {
  children: React.ReactNode;
  index?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const { hasNavigated } = useBooking();
  const still = reduced || !hasNavigated;
  return (
    <motion.div
      initial={still ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...EASE_OUT, delay: still ? 0 : Math.min(index, 4) * 0.04 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Fade + 20px slide, for a whole step arriving. Keyed on the step id. */
export function StepTransition({
  stepKey,
  children,
  className,
}: {
  stepKey: string;
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const { hasNavigated } = useBooking();
  return (
    <motion.div
      key={stepKey}
      initial={reduced || !hasNavigated ? false : { opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={EASE_OUT_SLOW}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * A number that counts to its new value instead of jumping.
 *
 * `format` runs on every frame, so the caller controls rounding and currency —
 * this never invents a display format for money.
 *
 * `tabular-nums` is not optional here: without it, digits change width mid-count
 * and the total jitters horizontally while it animates, which reads as the price
 * being unstable at the exact moment it must not.
 */
export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number;
  format: (value: number) => string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = React.useState(value);
  const from = React.useRef(value);

  React.useEffect(() => {
    if (reduced) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    const delta = value - origin;
    if (delta === 0) return;

    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / 260, 1);
      // Cubic ease-out — the same curve as EASE_OUT, sampled per frame.
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(origin + delta * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);

  React.useEffect(() => {
    if (reduced) from.current = value;
  }, [value, reduced]);

  return (
    <span className={cn('tabular-nums', className)}>
      {/* The live region carries the SETTLED value, so a screen reader hears
          the price once rather than every frame of the count. */}
      <span aria-hidden>{format(display)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}

/** A container that animates its own height as content changes. */
export function AutoHeight({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div layout={reduced ? false : 'size'} transition={EASE_OUT} className={className}>
      {children}
    </motion.div>
  );
}
