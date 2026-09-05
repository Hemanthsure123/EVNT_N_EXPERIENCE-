'use client';

import * as React from 'react';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * A VERTICAL TIMELINE OF THINGS THAT ACTUALLY HAPPENED.
 *
 * ── THE ONE RULE ──────────────────────────────────────────────────────────
 *
 * A step is `done` only when the platform holds a TIMESTAMP for it. Everything
 * else is `waiting` — drawn as an open ring with no date beside it — or, where
 * the platform is structurally incapable of ever learning the outcome,
 * `unknowable`, which says so in words.
 *
 * That last state exists because of a specific fact about refunds. The
 * reference this was built from ends with "Credited to Bank Account · Settled ·
 * Funds available immediately in your account" and a precise time. Razorpay's
 * webhook set does not include a bank-credit event, `reconcile_pending` polls
 * only for CAPTURES, and no bank tells a merchant when a credit landed. So the
 * final step CANNOT be stamped, and stamping it would be the single most
 * damaging lie on this screen: somebody whose money has not arrived would be
 * looking at a screen telling them it did, and would stop chasing it.
 *
 * A tick with no date under it is worse than an honest "we will not know". So
 * the step says what is true — the bank posts it, typically in a stated window
 * — and the screen keeps the shape without keeping the claim.
 *
 * ── THE LINE IS DRAWN, NOT BORDERED ───────────────────────────────────────
 *
 * The connector is an absolutely-positioned `<span>` between the markers
 * rather than a `border-l` on the list item, so it stops at the last marker
 * instead of running past it into the padding — the classic timeline defect,
 * visible only when the last row is short.
 */

export type TrailState = 'done' | 'active' | 'waiting' | 'unknowable';

export type TrailStep = {
  title: string;
  /** ISO. Rendered only for `done`/`active`; a waiting step has no date. */
  at?: string | null;
  /** One line under the title, saying what the step means. */
  body?: string;
  state: TrailState;
  /** Optional trailing pill, e.g. "Settled". */
  badge?: string;
};

function stamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function AuditTrail({ steps, className }: { steps: TrailStep[]; className?: string }) {
  const doneCount = steps.filter((step) => step.state === 'done').length;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <ol className="relative flex flex-col gap-5">
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          const settled = step.state === 'done';
          return (
            <li key={step.title} className="relative flex gap-3">
              {/* The connector. Drawn from this marker to the next one only —
                  never on the last row, which is what stops the line
                  overshooting into the container's padding. */}
              {!last ? (
                <span
                  aria-hidden
                  className={cn(
                    // `-bottom-5` matches the `gap-5` between rows exactly, so
                    // the line meets the next marker rather than stopping short
                    // of it or running past the last one.
                    'absolute left-3 top-7 -bottom-5 -ml-px w-0.5',
                    settled ? 'bg-primary' : 'bg-border',
                  )}
                />
              ) : null}

              <span
                aria-hidden
                className={cn(
                  'relative z-10 mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full',
                  settled && 'bg-primary text-primary-foreground',
                  step.state === 'active' && 'bg-primary/15 text-primary ring-2 ring-inset ring-primary',
                  step.state === 'waiting' && 'border-2 border-dashed border-border-strong bg-surface text-foreground-subtle',
                  step.state === 'unknowable' && 'border-2 border-border-strong bg-surface text-foreground-subtle',
                )}
              >
                {settled ? (
                  <Check className="size-3.5" strokeWidth={3} />
                ) : step.state === 'active' ? (
                  <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                ) : null}
              </span>

              <div className="min-w-0 flex-1 pb-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p
                    className={cn(
                      'text-body-sm font-semibold',
                      settled || step.state === 'active' ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {step.title}
                  </p>
                  {step.badge ? (
                    <span className="rounded-full bg-success-subtle px-2 py-0.5 text-caption font-semibold text-success-subtle-foreground">
                      {step.badge}
                    </span>
                  ) : null}
                </div>
                {/* A date ONLY where one was recorded. See the rule at the top:
                    a waiting step never gets a time, invented or estimated. */}
                {step.at ? (
                  <time dateTime={step.at} className="mt-0.5 block text-caption text-foreground-subtle">
                    {stamp(step.at)}
                  </time>
                ) : null}
                {step.body ? (
                  <p className="mt-1 text-caption text-muted-foreground">{step.body}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {/* The counter says how many are DONE out of how many exist. It used to
          be tempting to write "4 of 4" whatever the state; that is the same
          lie the unknowable step exists to avoid. */}
      <p className="sr-only">
        {doneCount} of {steps.length} steps completed.
      </p>
    </div>
  );
}

/** The counter chip the header renders — exported so the heading and the list
 *  can never disagree about the count. */
export function trailProgress(steps: TrailStep[]): string {
  const done = steps.filter((step) => step.state === 'done').length;
  return `${done} of ${steps.length} completed`;
}
