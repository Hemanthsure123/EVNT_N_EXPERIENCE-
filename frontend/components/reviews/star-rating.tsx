'use client';

import * as React from 'react';
import { Star } from 'lucide-react';
import { RATING_LABELS } from '@/lib/api/reviews';
import { cn } from '@/lib/utils/cn';

/**
 * Stars, in two shapes: one you read and one you set.
 *
 * ── THE INPUT IS A RADIO GROUP, NOT FIVE BUTTONS ──────────────────────────
 *
 * Five buttons is what a star row usually is, and it is wrong in a way that
 * only shows up with a keyboard: five tab stops for one question, no notion of
 * a selected value, and nothing announced when the value changes. A rating is
 * one choice from five — which is a radio group, and the WAI-ARIA pattern for
 * it gives roving tabindex (one tab stop), arrow keys between options, and a
 * `checked` state a screen reader can report.
 *
 * ── HOVER PREVIEWS, BUT NEVER LIES ────────────────────────────────────────
 *
 * Hovering shows what you would get; leaving restores what you chose. The
 * preview never becomes the value — a rating set by a mouse passing over the
 * control on the way somewhere else is the classic dark pattern here.
 *
 * ── EVERY STAR HAS A WORD ─────────────────────────────────────────────────
 *
 * "3 of 5" says nothing about whether 3 is a complaint. Each option is named
 * ("Fine — 3 out of 5") and the chosen word is echoed under the row, so the
 * scale is legible before you commit to a point on it.
 */

const STARS = [1, 2, 3, 4, 5];

export function StarRatingInput({
  value,
  onChange,
  disabled = false,
  id,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const [preview, setPreview] = React.useState(0);
  const shown = preview || value;

  const move = (delta: number) => {
    // Clamped, not wrapped: arrowing right off 5 landing on 1 turns the best
    // rating into the worst with one keypress.
    const next = Math.min(5, Math.max(1, (value || 0) + delta));
    onChange(next);
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div
        role="radiogroup"
        aria-label="Your rating"
        id={id}
        className="flex items-center gap-1"
        onMouseLeave={() => setPreview(0)}
      >
        {STARS.map((star) => {
          const active = star <= shown;
          const checked = star === value;
          return (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${RATING_LABELS[star]} — ${star} out of 5`}
              disabled={disabled}
              // Roving: exactly one star is in the tab order, so a rating is
              // one Tab away rather than five.
              tabIndex={checked || (!value && star === 1) ? 0 : -1}
              onClick={() => onChange(star)}
              onMouseEnter={() => !disabled && setPreview(star)}
              onFocus={() => !disabled && setPreview(star)}
              onBlur={() => setPreview(0)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  move(1);
                } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  move(-1);
                }
              }}
              className={cn(
                // 44px touch target with a 28px glyph inside it. A star row is
                // the one control people tap in a hurry on a phone.
                'inline-flex size-11 items-center justify-center rounded-full transition-transform duration-fast',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                !disabled && 'hover:scale-110 active:scale-95',
                'motion-reduce:transition-none motion-reduce:hover:scale-100',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <Star
                className={cn(
                  'size-7 transition-colors duration-fast',
                  active ? 'fill-warning text-warning' : 'fill-transparent text-border-strong',
                )}
                aria-hidden
              />
            </button>
          );
        })}
      </div>
      {/* `aria-live` so the meaning is announced as the value changes, not
          only discoverable by hovering. */}
      <p aria-live="polite" className="min-h-[1.25rem] text-caption text-muted-foreground">
        {shown ? RATING_LABELS[shown] : 'Tap a star to rate'}
      </p>
    </div>
  );
}

/**
 * The read-only version. A row of stars, and nothing interactive.
 *
 * `aria-hidden` on the stars with a single text label beside them: five
 * decorative glyphs announced one by one is noise, and "4 out of 5" is the
 * whole content.
 */
export function StarRatingDisplay({
  value,
  size = 'sm',
  className,
}: {
  value: number;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      <span className="sr-only">{value} out of 5</span>
      {STARS.map((star) => (
        <Star
          key={star}
          aria-hidden
          className={cn(
            size === 'lg' ? 'size-5' : 'size-3.5',
            // `Math.round` so a 4.5 average shows five lit stars rather than
            // four and a half of one — a partial star needs a clip path and
            // reads as a rendering bug at 14px.
            star <= Math.round(value)
              ? 'fill-warning text-warning'
              : 'fill-transparent text-border-strong',
          )}
        />
      ))}
    </span>
  );
}
