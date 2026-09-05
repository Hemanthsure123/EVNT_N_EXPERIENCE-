'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * SegmentedControl — a compact pill group for switching between a few mutually
 * exclusive views (All / Live / Past / Drafts; Standard / Advanced pricing).
 *
 * ── IT IS A RADIOGROUP, NOT A ROW OF BUTTONS ─────────────────────────────
 *
 * Drawn as buttons this looks identical and behaves quite differently: arrow
 * keys do nothing, every option is its own tab stop, and a screen reader
 * announces four unrelated controls instead of "Live, radio button, 2 of 4".
 * The count is the part that matters — it tells somebody who cannot see the
 * pill row how many views there are and which one they are on, which is the
 * entire content of this control.
 *
 * Roving tabindex is what makes that real: exactly ONE option is in the tab
 * order (the selected one, or the first when nothing is selected), and the
 * arrows move both focus and selection inside the group, as the radio pattern
 * requires.
 *
 * ── THE WIDTH IS FIXED BY THE GRID ───────────────────────────────────────
 *
 * Equal columns (`repeat(n, minmax(0, 1fr))`), so the control cannot resize
 * when the selection moves — a bar that reflows under the finger that pressed
 * it is how a second tap lands on the wrong view. It is also what lets the
 * indicator slide by exactly `100%` of its own width per column with nothing
 * measured: no `getBoundingClientRect`, so it is correct on first paint,
 * before fonts load, and after a resize, none of which a measured indicator is
 * without extra machinery.
 *
 * The trade is deliberate: a long label and a short one get the same width.
 * That is right for a handful of view names and wrong for prose, which is what
 * `Tabs` is for.
 */

export interface SegmentedControlOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
  options: readonly SegmentedControlOption<T>[];
  /** `null` for "nothing chosen yet" — the indicator is then not drawn. */
  value: T | null;
  onValueChange: (value: T) => void;
  /**
   * REQUIRED. A radiogroup with no name announces as an unlabelled group, and
   * "2 of 4" is useless without knowing 4 of what.
   */
  'aria-label': string;
  size?: 'sm' | 'md';
  className?: string;
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onValueChange,
  'aria-label': ariaLabel,
  size = 'md',
  className,
}: SegmentedControlProps<T>) {
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  // A section nothing backs is absent, not empty — and `repeat(0, ...)` is not
  // a valid grid template, so an empty group would also draw a stray pill.
  if (options.length === 0) return null;

  const activeIndex = options.findIndex((option) => option.value === value);
  const firstEnabled = options.findIndex((option) => !option.disabled);
  // Exactly one stop in the tab order. When nothing is selected the group is
  // still reachable, otherwise a fresh filter bar cannot be tabbed to at all.
  const tabbableIndex = activeIndex >= 0 ? activeIndex : firstEnabled;

  const move = (from: number, step: number) => {
    // Skips disabled options and wraps, so the arrows never dead-end on one.
    for (let i = 1; i <= options.length; i += 1) {
      const index = (from + step * i + options.length * i) % options.length;
      const option = options[index];
      if (option && !option.disabled) return index;
    }
    return -1;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = move(index, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = move(index, -1);
        break;
      case 'Home':
        next = move(-1, 1);
        break;
      case 'End':
        next = move(0, -1);
        break;
      default:
        return;
    }
    if (next < 0) return;

    event.preventDefault();
    itemRefs.current[next]?.focus();
    // Arrows SELECT as well as move, which is what separates a radiogroup from
    // a tablist. Space and Enter still work — they are a real button's own.
    const option = options[next];
    if (option) onValueChange(option.value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('inline-grid rounded-full bg-muted p-0.5 align-middle', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {/* A grid item in column 1, translated one column per step. Because every
          column is the same width, `100%` of the indicator IS one column, so
          this needs no measurement and no `calc` against the padding. */}
      <span
        aria-hidden
        className={cn(
          'col-start-1 row-start-1 rounded-full bg-surface shadow-sm',
          'transition-transform duration-base ease-out motion-reduce:transition-none',
          activeIndex < 0 && 'invisible',
        )}
        style={{ transform: `translateX(${Math.max(activeIndex, 0) * 100}%)` }}
      />

      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === tabbableIndex ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'row-start-1 inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-label',
              'transition-colors duration-fast ease-out motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:pointer-events-none disabled:opacity-60',
              size === 'sm' ? 'h-8' : 'h-control-sm',
              // Colour only. A weight change on selection would reflow the
              // label inside its column, which is the jitter this control is
              // built to avoid at the row level.
              selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
            style={{ gridColumnStart: index + 1 }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
