'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * The search box's rolling hint.
 *
 * The trending searches used to be a chip strip under the hero and a group
 * inside the panel — two lists of the same six links, in two places, for
 * somebody who has not decided what to look for. They are one thing now, and it
 * lives where that person is already looking: inside the search field.
 *
 * ── IT IS NOT THE PLACEHOLDER ATTRIBUTE ──────────────────────────────────
 *
 * A real `<input placeholder>` stays on the field, stable and meaningful,
 * because on a field with no visible label the placeholder is part of what
 * assistive technology has to work with — and an accessible name that changes
 * every three seconds is unusable. The moving text is an `aria-hidden` overlay
 * painted over it. Screen readers get one sentence; everyone else gets the
 * suggestions.
 *
 * ── ONE CLOCK FOR THE WHOLE APP ──────────────────────────────────────────
 *
 * The tick is module-level rather than per-component, for two reasons. Two
 * hints on screen (the hero bar and the palette opened from it) ticking on
 * their own intervals would drift apart within seconds and read as a bug. And
 * because the tick is shared, the panel can FREEZE on whatever the bar was
 * showing when it was pressed — which is what makes the suggestion continuous
 * rather than two unrelated animations.
 *
 * ── SSR ──────────────────────────────────────────────────────────────────
 *
 * Tick 0 on the server and on the first client render, always. The interval is
 * started by an effect, so hydration compares identical markup.
 *
 * ── NO KEYFRAMES, NO LIBRARY ─────────────────────────────────────────────
 *
 * Every term is stacked in the same box and positioned by its distance from
 * the active one — the active term at rest, the one before it a line above,
 * everything else a line below. Advancing the tick therefore rolls the current
 * term up and out while the next rolls up into its place, using nothing but a
 * transition on `transform`/`opacity`. framer-motion is confined to the
 * booking funnel for LCP reasons and this is the hero.
 */

const ROLL_INTERVAL_MS = 3200;

type Listener = (tick: number) => void;

let tick = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<Listener>();

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function start() {
  // Under reduced motion the clock never runs, so every consumer stays on the
  // first term. That is the requirement — a static hint, not a slower one.
  if (timer || prefersReducedMotion()) return;
  timer = setInterval(() => {
    tick += 1;
    listeners.forEach((listener) => listener(tick));
  }, ROLL_INTERVAL_MS);
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  // Sync immediately: a hint mounted late (the header on a route change) joins
  // the cycle already in progress rather than restarting it.
  listener(tick);
  start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/**
 * The shared tick, or the last one seen while `enabled` was false.
 *
 * Passing `false` FREEZES rather than resets — the palette stops the roll the
 * moment it takes focus (nobody should watch words move while they type) and
 * keeps showing the term the user was looking at when they pressed.
 */
export function useRollTick(enabled: boolean): number {
  const [value, setValue] = React.useState(0);
  React.useEffect(() => {
    if (!enabled) return;
    return subscribe(setValue);
  }, [enabled]);
  return value;
}

/**
 * The term the shared clock is currently on, plus its index.
 *
 * The modulo is applied at read time so a list that changes length underneath
 * the clock (the bundled fallback being replaced by the operator's list) can
 * never index past its end.
 */
export function useRollingTerm<T>(items: T[], enabled: boolean): { index: number; item?: T } {
  const current = useRollTick(enabled);
  const index = items.length ? current % items.length : 0;
  return { index, item: items[index] };
}

/**
 * Reset the shared clock. Test seam only — the tick is module state, so one
 * test's advance would otherwise leak into the next.
 */
export function __resetRollClock() {
  tick = 0;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  listeners.clear();
}

export type RollingHintProps = {
  /** Rendered in order; the clock walks them. */
  terms: string[];
  /** Which one is showing — from `useRollingTerm`, so a press can use it too. */
  index: number;
  /** Shown when there are no terms at all. Never animated. */
  fallback?: string;
  className?: string;
};

/**
 * The visual roll. Decorative by construction: `aria-hidden`, no tab stop, no
 * pointer events — whatever sits behind it owns the semantics.
 */
export function RollingHint({ terms, index, fallback, className }: RollingHintProps) {
  // Two terms would roll the second one DOWN into place on the wrap (it is
  // simultaneously "the one before" and "the one after"), so the list is
  // doubled to give the cycle a direction. One term does not move at all.
  const track = terms.length === 2 ? [...terms, ...terms] : terms;
  const count = track.length;

  if (!count) {
    return (
      <span className={cn('block truncate', className)} aria-hidden>
        {fallback}
      </span>
    );
  }

  const active = index % count;

  return (
    <span
      aria-hidden
      className={cn(
        // `h-6`/`leading-6` matches `text-body`'s 24px line box, so the clip is
        // exactly one line high and a descender is never sheared off. Both are
        // overridable together from `className` (tailwind-merge resolves the
        // conflict) for a field set at another size.
        'pointer-events-none relative block h-6 overflow-hidden leading-6',
        className,
      )}
    >
      {track.map((term, position) => {
        // Distance from the active term, walking forwards: 0 is showing,
        // count - 1 is the one that just left (above), the rest wait below.
        const offset = (position - active + count) % count;
        return (
          <span
            key={`${term}-${position}`}
            className={cn(
              // `leading-[inherit]` so the container's line box is the single
              // place the height is set (no px, so the no-raw-values rule is
              // satisfied — it forbids arbitrary PIXEL values, not keywords).
              'absolute inset-x-0 top-0 block truncate leading-[inherit] transition duration-slow ease-out',
              'motion-reduce:transition-none',
              offset === 0
                ? 'translate-y-0 opacity-100'
                : offset === count - 1
                  ? '-translate-y-full opacity-0'
                  : 'translate-y-full opacity-0',
            )}
          >
            {term}
          </span>
        );
      })}
    </span>
  );
}
