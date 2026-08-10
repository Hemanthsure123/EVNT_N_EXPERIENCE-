'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * The one-shot flourish that plays when tickets are issued.
 *
 * ── WHY THIS MOMENT GETS ANYTHING AT ALL ──────────────────────────────────
 *
 * Everything else in this product is deliberately undramatic: no urgency
 * badges nothing measures, no confetti on a form validating. This is the one
 * screen where a celebration is honest — somebody paid, and the thing they
 * bought exists. BookMyShow and District both mark it, and they mark it the
 * same way: a brief burst, then stillness. The screen has work to do after the
 * flourish (a booking reference, a QR code, a link to the wallet), so the
 * animation has to get out of the way rather than loop.
 *
 * ── IT IS CSS, ONE SHOT, AND IT REMOVES ITSELF ────────────────────────────
 *
 * No canvas and no confetti library. Twenty spans on a keyframe cost one paint
 * and nothing on the critical path — this screen is reached after a payment
 * round trip, and adding a bundle to it would delay the first thing somebody
 * wants to see. `fill-mode: forwards` leaves every piece at `opacity: 0`, and
 * the whole layer unmounts once the animation is over, so nothing is left
 * compositing behind a page people keep open until they reach the gate.
 *
 * ── AND IT IS DECORATION, MARKED AS SUCH ──────────────────────────────────
 *
 * `aria-hidden`, `pointer-events-none`, and absolutely positioned so it cannot
 * shift a single element of the layout it plays over. The good news is
 * announced by the heading and the `role="status"` line beneath it, both of
 * which are real text — a screen reader user is told they are going by the
 * words, not by an effect they cannot perceive.
 *
 * Under `prefers-reduced-motion` it renders NOTHING. Not a slower version: a
 * burst of moving objects is exactly what that preference is about, and the
 * screen is complete without it.
 */

/** Deterministic, so the server and the first client render agree. */
const PIECES = Array.from({ length: 22 }, (_, index) => {
  // A fixed pseudo-random spread. `Math.random()` here would produce different
  // markup on the server and the client and trip hydration.
  const spread = ((index * 37) % 100) - 50;
  return {
    left: `${((index * 53) % 96) + 2}%`,
    delay: `${((index * 11) % 260)}ms`,
    drift: `${spread}px`,
    rotate: `${((index * 71) % 360) - 180}deg`,
    duration: `${1100 + ((index * 97) % 700)}ms`,
    // Cycles the three brand-safe tokens rather than inventing colours.
    tone: ['bg-primary', 'bg-accent', 'bg-warning-subtle-foreground'][index % 3],
    tall: index % 3 === 0,
  };
});

const TOTAL_MS = 2200;

export function Celebration({ className }: { className?: string }) {
  const [done, setDone] = React.useState(false);
  const [allowed, setAllowed] = React.useState(false);

  // Read in an effect, never during render: `matchMedia` does not exist on the
  // server, and branching on it while rendering is a hydration mismatch.
  React.useEffect(() => {
    setAllowed(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }, []);

  React.useEffect(() => {
    if (!allowed) return;
    const timer = window.setTimeout(() => setDone(true), TOTAL_MS);
    return () => window.clearTimeout(timer);
  }, [allowed]);

  if (!allowed || done) return null;

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 -z-0 h-64 overflow-hidden',
        className,
      )}
    >
      {PIECES.map((piece, index) => (
        <span
          key={index}
          className={cn('confetti-piece', piece.tone, piece.tall ? 'h-3 w-1.5' : 'size-2')}
          style={
            {
              left: piece.left,
              animationDelay: piece.delay,
              animationDuration: piece.duration,
              '--confetti-drift': piece.drift,
              '--confetti-rotate': piece.rotate,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
