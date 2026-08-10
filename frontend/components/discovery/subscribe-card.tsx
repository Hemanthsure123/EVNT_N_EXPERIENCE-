'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {BellOff, Loader2 } from 'lucide-react';
import { SpotSubscribe } from '@/components/illustrations/spots';
import { Button } from '@/components/ui/button';
import { usePush } from '@/lib/push/use-push';
import { cn } from '@/lib/utils/cn';

/**
 * A quiet prompt in the results grid, offering event reminders.
 *
 * ── WHAT THIS CARD USED TO DO, AND WHY IT WAS THE WORST KIND OF FAKE ──────
 *
 * It called `Notification.requestPermission()` and, on success, said
 * "Notifications are on for this device". The permission was real. Everything
 * the sentence implied was not: nothing subscribed to push, nothing was
 * stored server-side, and no code path could ever send anything. Somebody who
 * granted it would wait for a reminder that had never been built.
 *
 * That is worse than an obviously missing feature, because the user takes an
 * action, sees it confirmed, and changes their behaviour — they stop checking
 * the page, trusting they will be told.
 *
 * It is now real end to end: `usePush` asks the SERVER whether push is
 * configured before touching the browser, registers a service worker,
 * requests permission only on a press, subscribes, and stores the
 * subscription. `on` is reached only after the server has it. The backend
 * sends event reminders to it through the same exactly-once notification
 * ledger that owns email and SMS.
 *
 * ── EVERY STATE SAYS SOMETHING TRUE, INCLUDING THE UNHAPPY ONES ───────────
 *
 * Push can be unavailable for five unrelated reasons, and they need five
 * different sentences: this deployment has no VAPID keys; this browser has no
 * push; the page is not on https; you are not signed in; you blocked it. A
 * single greyed-out button would be a shrug at all five.
 *
 * The card renders in all of them rather than hiding. `denied` is also what
 * every headless browser reports, and somebody who blocked notifications is
 * exactly the person who benefits from being told that is why they hear
 * nothing.
 *
 * ── IT IS A GRID CELL, NOT A BANNER ───────────────────────────────────────
 *
 * It renders its own `<li>`, so returning null leaves no empty cell behind —
 * the grid closes the gap and the following cards move up. (Returning null
 * from inside an `<li>` the grid supplied leaves a hole; that shipped once
 * and was caught by counting cells.) Placed at the start of the third row:
 * below the fold at every supported width, so its insertion cannot shift what
 * the reader is looking at.
 *
 * ── THE MARK IS `SpotSubscribe`, EXCEPT WHEN IT IS BLOCKED ────────────────
 *
 * A drawn spot carries the friendly, opt-in reading the default and `on`
 * states want, and matches the illustration language the rest of discovery
 * now uses. `blocked` keeps the lucide `BellOff`, because that state is the
 * one where the card is explaining a REFUSAL, and putting a warm illustration
 * on "your browser will not let us do this" is the sort of cheerfulness that
 * makes an interface feel like it is not listening.
 *
 * It sits BESIDE the heading on a phone rather than above it — the card is a
 * cell in a grid of compact rows there, and a stacked 44px mark on its own
 * line made this one cell twice the height of the cards around it.
 */
export function SubscribeCard({
  className,
  asListItem = false,
}: {
  className?: string;
  /** True only where the parent is a real `<ul>` — the results grid. */
  asListItem?: boolean;
}) {
  const { state, busy, error, enable } = usePush();
  const pathname = usePathname() ?? '/';

  // Nothing at all while resolving, and nothing where push could never work.
  // An unsupported browser gets silence rather than an explanation of a
  // feature it cannot have — that is a different card from "you blocked it".
  if (state === 'loading' || state === 'unavailable' || state === 'unsupported') return null;

  // ── AND NOTHING ONCE THEY ARE ON ────────────────────────────────────────
  //
  // The card used to stay, switching to "Reminders are on" with a Turn off
  // button. That makes a browse page carry a settings control forever: it is
  // an offer, and once accepted an offer has nothing left to say. Somebody who
  // wants to turn them off goes to Settings, which is where every other
  // preference on this account lives and where this one is already listed.
  //
  // So the card is an ASK, shown only while there is something to ask for.
  if (state === 'on') return null;

  // THE WRAPPER IS THE CALLER'S CHOICE, because this card lives in two places
  // with different parents. Inside the results grid it is one cell of a `<ul>`
  // and must be an `<li>`; on the homepage it sits alone in a `<Section>`,
  // where an `<li>` with no list around it is a SERIOUS axe violation
  // (`listitem`) and has been failing the homepage a11y scan silently.
  // Defaulting to a plain `<div>` makes the standalone case correct and the
  // grid case explicit.
  const Wrapper = asListItem ? 'li' : 'div';

  return (
    <Wrapper className={cn('h-full', className)}>
      <section
        aria-label="Event reminders"
        className="flex h-full flex-col justify-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-md sm:gap-4 sm:p-card lg:p-card-lg"
      >
        <div className="flex items-start gap-3 sm:flex-col sm:gap-4">
          <span className="shrink-0" aria-hidden>
            {state === 'blocked' ? (
              <span className="inline-flex size-10 items-center justify-center rounded-lg bg-nav-active text-nav-active-foreground sm:size-11">
                <BellOff className="size-5" />
              </span>
            ) : (
              <SpotSubscribe className="size-10 sm:size-11" />
            )}
          </span>

          <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-none sm:gap-2">
            <h3 className="text-body font-semibold leading-tight text-foreground sm:text-body-lg sm:leading-normal">
              Get a reminder before the doors open
            </h3>
          </div>
        </div>

        {state === 'signed-out' ? (
          <p className="text-caption text-muted-foreground">
            <Link
              href={`/sign-in?next=${encodeURIComponent(pathname)}`}
              className="font-medium text-foreground underline underline-offset-2"
            >
              Sign in
            </Link>{' '}
            to turn these on — a reminder is tied to the tickets on your account.
          </p>
        ) : state === 'insecure' ? (
          <p className="text-caption text-muted-foreground">
            Notifications need a secure (https) connection, and this page is not on one.
          </p>
        ) : state === 'blocked' ? (
          <p className="text-caption text-muted-foreground">
            Notifications are blocked for this site. Allow them in your browser settings to
            switch this back on.
          </p>
        ) : (
          /* No `state === 'on'` branch: the card returns null in that state
             now, so a "This device is subscribed / Turn off" block here would
             be unreachable. Turning them off lives in Settings. */
          <Button variant="outline" className="w-fit" onClick={() => void enable()} loading={busy}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Setting up
              </>
            ) : (
              'Turn on reminders'
            )}
          </Button>
        )}

        {error ? (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        ) : null}
      </section>
    </Wrapper>
  );
}
