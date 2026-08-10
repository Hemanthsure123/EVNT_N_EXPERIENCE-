'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { GENDER_OPTIONS } from '@/lib/account/profile-form';
import type { Gender } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';

/**
 * Fields shared by the welcome flow and the settings screen.
 *
 * Two surfaces ask the same questions, and a field that validates one way in
 * onboarding and another in settings is how somebody ends up with a value they
 * cannot save from the screen they are on. So the input lives here once.
 */

/**
 * How somebody describes themselves.
 *
 * ── RADIOS, NOT A SELECT ──────────────────────────────────────────────────
 *
 * Five options, and two of them mean something a person needs to READ before
 * choosing — "prefer to self-describe" and "prefer not to say" are the
 * difference between a form that includes people and one that does not. A
 * collapsed select hides both behind a tap.
 *
 * ── AND IT INCLUDES A WAY TO DECLINE ──────────────────────────────────────
 *
 * "Prefer not to say" is a real stored answer, not an absence: choosing it
 * records that the question was asked and answered, which is what stops the
 * welcome flow asking again. Leaving the whole field alone is the different
 * state, and both are supported because they are different things.
 *
 * ── THE PLATFORM DOES NOT USE THIS FOR ANYTHING ───────────────────────────
 *
 * Nothing prices, targets or recommends by it, and the hint says as much
 * rather than implying a benefit that does not exist. If that ever changes,
 * this is the string that has to change with it — collecting a field and
 * silently finding a use for it later is the pattern this note exists against.
 */
export function GenderField({
  value,
  selfDescribed,
  error,
  onChange,
  onSelfDescribedChange,
  className,
}: {
  value: Gender | '';
  selfDescribed: string;
  error?: string;
  onChange: (value: Gender | '') => void;
  onSelfDescribedChange: (value: string) => void;
  className?: string;
}) {
  const selfId = React.useId();

  return (
    <fieldset className={cn('flex flex-col gap-2', className)}>
      <legend className="text-body-sm font-medium">
        Gender <span className="font-normal text-muted-foreground">— optional</span>
      </legend>

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {GENDER_OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                'flex min-h-control cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2',
                'text-body-sm transition-colors duration-fast',
                'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
                selected
                  ? 'border-primary bg-primary-subtle text-primary-subtle-foreground'
                  : 'border-border text-muted-foreground hover:border-border-strong hover:text-foreground',
                // "Prefer not to say" spans the row: it is not a fifth option
                // among four, it is the way out of the question, and pairing it
                // beside one of the answers reads as equivalent to them.
                option.value === 'prefer_not_to_say' && 'sm:col-span-2',
              )}
            >
              <input
                type="radio"
                name="gender"
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="size-4 shrink-0 accent-[rgb(var(--primary))]"
              />
              <span className="min-w-0">{option.label}</span>
            </label>
          );
        })}
      </div>

      {value === 'self_described' ? (
        <div className="flex flex-col gap-1.5 pt-1">
          <label htmlFor={selfId} className="sr-only">
            How you would like to be described
          </label>
          <Input
            id={selfId}
            value={selfDescribed}
            maxLength={60}
            autoFocus
            onChange={(event) => onSelfDescribedChange(event.target.value)}
            placeholder="In your own words"
          />
          {error ? (
            <p role="alert" className="text-caption text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="w-fit rounded-full text-caption text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Clear this answer
        </button>
      ) : null}    </fieldset>
  );
}
