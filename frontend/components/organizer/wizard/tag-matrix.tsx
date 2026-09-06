'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import { MAX_TAGS, MIN_TAGS_TO_PUBLISH, TAG_DIMENSIONS } from '@/lib/events/taxonomy';
import { cn } from '@/lib/utils/cn';

/**
 * The tag matrix — seven dimensions, pick between seven and ten.
 *
 * ── WHY THIS IS NOT A MULTI-SELECT ────────────────────────────────────────
 *
 * Forty-two options in a dropdown is a scrolling list somebody reads once and
 * abandons. Drawn as seven labelled groups of chips, it is seven small
 * questions with obvious answers — and the grouping is the thing that makes a
 * minimum of seven reasonable rather than punitive, because it tells the
 * organiser where the next one should come from.
 *
 * ── THE COUNTER IS PROGRESS, NOT A GATE ───────────────────────────────────
 *
 * Nothing here refuses a save. The minimum is a PUBLISH blocker
 * (`publishBlockers`, mirroring the server's `_require_tags`), so this control
 * shows how far along somebody is and the review step is where it becomes a
 * requirement. Colouring the counter red on an untouched form would be telling
 * somebody they have made a mistake by arriving.
 *
 * The MAXIMUM does bite here, because it is the one the server refuses: past
 * ten, the remaining chips go disabled rather than silently ignoring a press.
 * A control that accepts a press and does nothing is worse than one that says
 * it is full.
 *
 * ── ORDER IS THE ORGANISER'S ──────────────────────────────────────────────
 *
 * A selected tag is appended and removal preserves the rest, so the stored
 * array keeps the order they were chosen in. Sorting would reshuffle the chips
 * on the event page every time somebody edited an unrelated field.
 */

export function TagMatrix({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const chosen = React.useMemo(() => new Set(value), [value]);
  const full = value.length >= MAX_TAGS;
  const remaining = MIN_TAGS_TO_PUBLISH - value.length;

  const toggle = (slug: string) => {
    if (chosen.has(slug)) {
      onChange(value.filter((tag) => tag !== slug));
      return;
    }
    if (full) return;
    onChange([...value, slug]);
  };

  return (
    <div className="flex flex-col gap-block">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p
          className="text-body-sm text-muted-foreground"
          // Announced as it changes, so a screen-reader user hears the count
          // without hunting for it after every press.
          role="status"
          aria-live="polite"
        >
          {remaining > 0 ? (
            <>
              <span className="font-medium text-foreground">
                {value.length} of {MIN_TAGS_TO_PUBLISH}
              </span>{' '}
              — pick {remaining} more to publish.
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{value.length} tags</span> — enough to
              publish. Up to {MAX_TAGS}.
            </>
          )}
        </p>
      </div>

      {TAG_DIMENSIONS.map((dimension) => (
        <fieldset key={dimension.key} className="flex flex-col gap-2">
          <legend className="text-body-sm font-semibold text-foreground">{dimension.label}</legend>
          <p className="text-caption text-muted-foreground">{dimension.help}</p>
          <ul className="flex flex-wrap gap-2">
            {dimension.tags.map((tag) => {
              const active = chosen.has(tag.value);
              // Disabled only when FULL and not already chosen — a selected
              // chip must always stay pressable, or somebody who picks ten
              // cannot change their mind about any of them.
              const locked = full && !active;
              return (
                <li key={tag.value}>
                  <button
                    type="button"
                    onClick={() => toggle(tag.value)}
                    disabled={locked}
                    aria-pressed={active}
                    title={locked ? `You have picked ${MAX_TAGS} tags. Remove one first.` : undefined}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-body-sm transition-colors duration-fast',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-border bg-background text-foreground hover:border-foreground/40',
                      locked && 'cursor-not-allowed opacity-40 hover:border-border',
                    )}
                  >
                    {active ? <Check className="size-3.5" aria-hidden /> : null}
                    {tag.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}
