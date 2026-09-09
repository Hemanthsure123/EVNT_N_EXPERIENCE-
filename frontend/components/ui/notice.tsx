import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * HOW THIS PLATFORM REPORTS A FAILURE: IN WORDS, NOT IN RED.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 *
 * Nothing that tells somebody their input was rejected, or that the action they
 * just took failed, is coloured red. Validation messages, submit failures,
 * upload failures, "could not load" panels and the checkout's own failure
 * screens all render in the neutral vocabulary below.
 *
 * ── WHAT IS STILL RED, AND WHY THE DISTINCTION IS THE WHOLE RULE ───────────
 *
 * Two things keep the destructive tokens, because neither is a failure message:
 *
 *   1. CONTROLS THAT DESTROY SOMETHING. Delete, Remove, Cancel event, Suspend
 *      user. Red is the last warning before an irreversible press, and greying
 *      those out to satisfy a rule about error TEXT would be a safety
 *      regression wearing a design fix's clothes.
 *
 *   2. INDICATORS THAT REPORT A FACT. "Sold out", a denied check-in scan, a
 *      payout that failed in an operations list, a health probe that is down,
 *      an unread count, a negative trend. These are DATA. A scan that says DO
 *      NOT ADMIT is read across a dark doorway in one glance by somebody with
 *      a queue behind them, and the colour is doing real work there.
 *
 * The test in `notice.test.ts` pins the first half: no element carrying
 * `role="alert"` may also carry a red text class. It is a source scan rather
 * than a render test, because the guarantee is about the whole tree and there
 * is no single screen that renders all of it.
 *
 * ── WHY NOT RED ───────────────────────────────────────────────────────────
 *
 * Red is the loudest thing a screen can say, and it was being spent on the
 * cheapest events: a code typed one character short, a field not yet filled
 * in, a request that will succeed on the retry. Somebody choosing tickets met
 * it before they had done anything wrong. Spent everywhere it stops meaning
 * anything anywhere — which is exactly the argument for keeping it on the two
 * cases above.
 *
 * The sentence is what carries the meaning. `role="alert"` is what carries it
 * to anybody not looking at the colour, and that has not changed.
 */

/** Inline note under a control: a length hint, a server's refusal, a reason. */
export const NOTICE_TEXT = 'text-caption text-muted-foreground';

/** A block that reports a failed action — a submit, an upload, a load. */
export const NOTICE_PANEL =
  'rounded-xl border border-border bg-muted px-card py-3 text-body-sm text-foreground';

export function FieldNotice({
  id,
  /**
   * True when this note is the answer to a PRESS — a rejected submit — rather
   * than a description of the field. Only the former is announced: a hint that
   * re-announces on every keystroke interrupts the person typing.
   */
  alert = false,
  className,
  children,
}: {
  id?: string;
  alert?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  if (!children) return null;
  return (
    <p id={id} role={alert ? 'alert' : undefined} className={cn(NOTICE_TEXT, className)}>
      {children}
    </p>
  );
}

export function NoticePanel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  if (!children) return null;
  return (
    <p role="alert" className={cn(NOTICE_PANEL, className)}>
      {children}
    </p>
  );
}
